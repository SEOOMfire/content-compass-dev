# Lokalisierungs-Pipeline (5 Schritte)

Aus einer deutschen Fressnapf-URL entsteht für einen Zielmarkt ein **strukturtreues
Markdown-Dokument**: gleiche Überschriften und Ebenen, Absätze bleiben Absätze, Listen
bleiben Listen (nummeriert/unnummeriert, verschachtelt), Tabellen bleiben Tabellen –
übersetzt und an deutschlandspezifischen Stellen lokalisiert.

**Grundprinzip:** Der Code besitzt die Struktur, das Modell nur den Text. Die Quelle wird
in eine typisierte Blockliste mit stabilen IDs (`b1`, `b2`, …) zerlegt. Das Modell liefert
je Block-ID nur den neuen Inhalt. Markdown rendert ausschließlich der Code – das Modell kann
keine Liste, Tabelle oder Überschrift erfinden oder zerstören.

| # | Step-Key | Art | Ergebnis in `jobs.context` |
|---|---|---|---|
| 1 | `extract` | Code | `source: { url, title, metaDescription, blocks, wordCount, links }` |
| 2 | `scan` | KI `localization_scan` | `findings: Finding[]` |
| 3 | `localize` | KI `localize_document` + gezielte Nachfrage | `localized: { meta, blocks }` |
| 4 | `review` | Code-Prüfungen + KI `localization_review` + Render | `review`, `exportMarkdown` |
| 5 | `links` | Code (hreflang) + KI `link_integration` + Render | `linking`, `exportMarkdown` (neu gerendert) |

Abhängigkeiten sind linear: Schritt n braucht das Ergebnis von Schritt n−1. Läuft ein
Schritt neu, werden die Ergebnisse aller späteren Schritte verworfen und ihre Karten auf
`pending` gesetzt. „Komplett ausführen“ läuft alle Schritte nacheinander, **je Schritt ein
eigener Request** (je Schritt bis zu 3 automatische Wiederholungen bei Fehlern). So bleibt
jeder Request unter dem Zeitlimit des Hostings (Vercel: 300 s); ein Gesamtlauf mit
Reasoning-Modellen dauert mehrere Minuten. Seitenabrufe brechen nach 20 s ab.

## Datenmodell

```ts
type Block =
  | { id; type: "heading"; level: 1–6; text }
  | { id; type: "paragraph"; text }
  | { id; type: "list"; ordered; items: { text; children?; childrenOrdered? }[] }
  | { id; type: "table"; hasHeader; rows: string[][] }
  | { id; type: "quote"; text };

type Finding = {
  id; block_ids; de_reference;
  category: "behoerde" | "gesetz" | "organisation" | "service" | "zahl_einheit"
          | "waehrung" | "angebot" | "quelle" | "sonstiges";
  decision: "ersetzen" | "neutral" | "streichen";
  target_equivalent: string | null; instruction;
};
```

Texte sind Inline-Markdown: nur `**fett**` und `*kursiv*`; Links werden zu reinem Ankertext.
Die internen Linkziele der Quelle stehen separat in `source.links` (`{ block_id, href, anchor }`).
Einzige Ausnahme im Text: Schritt 5 setzt höchstens einen Markdown-Link `[Anker](URL)`.

## 1 · `extract` – Quelle extrahieren (Code)

Datei: `src/lib/pipeline/extract.server.ts`

- **Inhaltsbereich:** `main` → `article` → kleinster Vorfahre der `h1`, der mindestens 60 %
  der Absätze enthält → `body`.
- **Störelemente** (Liste `NOISE_SELECTORS`): `script`, `style`, `nav`, `header`, `footer`,
  `aside` (z. B. Produktkarussell), `form`, `button`, Bilder, `iframe`, `svg`, Breadcrumbs,
  Datum/Lesedauer (`.ai-metrics`), Bildnachweis, Inhaltsverzeichnis, Teaser-Kacheln,
  „Weitere Themen“, CTA-Buttons.
- **Rekursiver DOM-Walk** in Dokumentreihenfolge – jedes Element wird genau einmal erfasst
  (kein doppeltes `li > p`):
  - `h1`–`h6` → `heading` mit Originalebene,
  - `p` und Text-`div` → `paragraph`,
  - `ul`/`ol` → `list` mit Verschachtelung,
  - `table` → `table`: `hasHeader` bei `thead` oder `th` in Zeile 1; `colspan` wird mit
    leeren Zellen aufgefüllt; Listen in Zellen werden mit `<br>` verbunden,
  - `blockquote` → `quote`.
- **Inline:** `strong`/`b` → `**…**`, `em`/`i` → `*…*`, `a` → Text, `br` → Leerzeichen.
- **Links:** jedes `a[href]` wird mit Block-ID und Ankertext erfasst. In `source.links` landen nur
  interne Links (gleicher Host wie die Quelle, http/https, ohne `#`-Fragment, nicht die Seite
  selbst) in Dokumentreihenfolge.
- Überschriften ohne folgenden Inhalt am Dokumentende (Teaser-Reste) entfallen.
- **Fehler:** HTTP ≠ 200 oder 0 Blöcke → Schritt `error` mit klarer Meldung.

## 2 · `scan` – DE-Bezüge finden (KI)

Ein Aufruf mit dem ganzen Dokument (eine JSON-Zeile pro Block) und dem Marktprofil
(`country`, `language`, `language_variant`, `brand`, `address_form`, `institutions`,
`forbidden_claims`, `localization_notes`).

Entscheidung je Fund:

1. **ersetzen** – es gibt ein passendes Gegenstück im Zielland (`target_equivalent`),
2. **neutral** – kein Gegenstück: Aussage bleibt allgemein, ohne die Institution,
3. **streichen** – für das Land nicht relevant,
4. im Zweifel **neutral** statt erfinden.

Der Code (`src/lib/pipeline/scan.ts`) validiert die Antwort (zod) und normalisiert:

- unbekannte Block-IDs werden verworfen (Fund ohne gültige ID entfällt),
- `ersetzen`/`neutral` gelten für alle Blöcke, in denen der DE-Verweis vorkommt
  (`streichen` bleibt auf die gemeldeten Blöcke beschränkt),
- `institutions` hat Vorrang: Wert → `ersetzen` mit diesem Wert, `null` → `neutral`,
- `ersetzen` ohne Gegenstück wird `neutral`,
- `institutions`-Begriffe, die im Text stehen, aber nicht gefunden wurden, werden ergänzt.

Die Funde erscheinen im Job als Tabelle (DE-Verweis → Entscheidung → Ersatz).

## 3 · `localize` – Lokalisieren (KI + Code-Validierung)

Datei: `src/lib/pipeline/localize.ts`

Das Modell bekommt Blöcke, Funde, Marktprofil, Gliederung und Meta und antwortet:

```json
{ "meta": { "title": "", "meta_description": "", "slug": "" },
  "blocks": [ { "id": "b1", "text": "…" }, { "id": "b7", "items": ["…"] },
              { "id": "b9", "rows": [["…"]] }, { "id": "b12", "removed": true } ] }
```

Validierung je Block (`src/lib/pipeline/validate.ts`):

- ID vorhanden, Typ passend (`text` / `items` / `rows`),
- Tabelle: gleiche Zeilen- und Spaltenzahl; Liste: gleiche Item-Struktur,
- `removed` bzw. weniger Listenpunkte nur bei Blöcken aus einem `streichen`-Fund,
- kein Markdown-Blocksyntax (`#`, `|`, `- `, `1. `, `>` am Zeilenanfang, keine Leerzeile),
- nicht leer; bei Zielsprache ≠ Deutsch nicht identisch mit der Quelle (ab 4 Wörtern).

**Gezielte Nachfrage:** fehlerhafte oder fehlende Blöcke werden **nur diese** mit Fehlerliste
erneut angefragt, höchstens 2×. Danach bleibt der Schritt `error` mit den Block-IDs.

**Lange Artikel:** ab 2.500 Wörtern (`CHUNK_WORD_LIMIT`) werden H2-Gruppen in mehreren
Aufrufen verarbeitet; jeder Aufruf bekommt die volle Gliederung und alle Funde. Der Code
führt die Ergebnisse zusammen.

## 4 · `review` – Prüfen & Export (Code + KI)

Datei: `src/lib/pipeline/review.ts`

- **Deterministisch:** Struktur-Identität (Typen, Ebenen, Tabellen-/Listenform), verbotene
  Begriffe (`forbidden_claims`), Marken-Schreibweise (Levenshtein), Restbestand (steht ein
  `de_reference` noch im Zieltext?), Schweiz-Deutsch ohne „ß“ (wird automatisch zu „ss“).
- **KI `localization_review`:** bekommt Quell- und Zielblöcke, Funde, Marktprofil und die
  Code-Befunde; liefert `{ issues: [{ block_id, problem, fix }] }`.
- **Korrekturen** werden nur übernommen, wenn sie dieselbe Validierung wie in Schritt 3
  bestehen. Abgelehnte oder fehlende Korrekturen erscheinen als Warnung. Der Schritt
  blockiert nie.
- **Render** (`src/lib/pipeline/render.ts`): Meta-Kopf (Title, Meta-Description,
  Slug-Vorschlag), `---`, dann die Blöcke: `#`×Ebene, Absätze mit Leerzeile, `- ` bzw.
  `1. ` mit 2 Leerzeichen Einrückung je Ebene, GFM-Tabellen (ohne `th` wird Zeile 1 zur
  Kopfzeile, `|` wird escaped), Zitate mit `> `. Am Ende nur die `closing_note` des Markts.

## 5 · `links` – Interner Link per hreflang (Code + KI)

Datei: `src/lib/pipeline/links.ts`

- **Kandidaten:** interne Links aus `source.links` in Dokumentreihenfolge, je Ziel-URL einmal.
  Nur Links in Absätzen, Listen und Zitaten, deren Block nicht gestrichen ist; höchstens 15
  verlinkte Seiten werden geprüft (`MAX_LINK_CHECKS`).
- **hreflang:** Die verlinkte DE-Seite wird geladen und ihre
  `<link rel="alternate" hreflang="…">`-Einträge werden gelesen. Treffer:
  1. `hreflang` = `locale` des Markts (z. B. `de-AT`), Host passt zur Marktdomain (`markets.domain`),
  2. sonst gleiche Sprache auf der Marktdomain (z. B. `pl` auf der polnischen Domain).
  `x-default` und reine Sprachcodes auf fremden Domains zählen nicht. Die Ziel-URL muss mit
  HTTP 200 antworten. Der erste Treffer gewinnt. Die Prüfung endet spätestens nach 90 s
  (`LINK_CHECK_BUDGET_MS`).
- **Einfügen (genau 1×):** KI `link_integration` setzt die URL als `[Anker](URL)` an die Stelle,
  die dem deutschen Ankertext entspricht. Der Code übernimmt die Antwort nur, wenn die Struktur
  gleich ist, genau ein neuer Link auf die vorgegebene URL entsteht und der Text ohne
  Link-Syntax unverändert ist (1 gezielte Nachfrage).
- **Export:** `exportMarkdown` wird aus `localized` plus dem geänderten Block neu gerendert;
  `localized` selbst bleibt unverändert, ein Neulauf startet also immer vom Stand nach Schritt 4.
- Der Schritt blockiert nie: Kein Treffer ist ein Hinweis; fehlgeschlagenes Einfügen, fehlende
  Vorlage oder Quellen ohne Linkdaten (vor Schritt 5 extrahiert → Schritt 1 neu ausführen)
  sind Warnungen.

## Job-Status

`done` nach Schritt 5, bzw. `done_with_errors`, wenn Warnungen aus Schritt 4 oder 5 offen sind.

## Marktprofil

Gepflegt unter *Administration → Märkte*: `language_variant`, `brand`, `address_form`,
`institutions` (JSON, `null` = existiert nicht → neutral), `forbidden_claims` (JSON-Liste),
`closing_note` und **Lokalisierungshinweise** (`localization_notes`, Freitext, verbindlich
für Scan, Lokalisierung und Review).

## Altjobs

Jobs aus der früheren 16-Schritt-Pipeline (Kontext ohne `source.blocks`) gelten als
Altjobs: ein vorhandener Export bleibt sichtbar, alte Schrittzeilen werden ignoriert.
„Komplett ausführen“ startet die neue Pipeline ab `extract` und ersetzt den Kontext.

## Tests

`bun test` – `tests/pipeline-regression.test.ts` mit den Fixtures
`tests/fixtures/synthetic.html` und `tests/fixtures/barbet.html` (Extraktion, Rendering,
Validierung, Scan-Normalisierung, gezielter Retry mit gemocktem Modell, Review).
