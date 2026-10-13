# Plan: Lokalisierungs-Pipeline radikal vereinfachen (16 → 4 Schritte)

## Ziel
Aus einer deutschen Fressnapf-URL entsteht für einen Markt ein **strukturtreues Markdown-Dokument**:
- gleiche Überschriften und Ebenen,
- Absätze bleiben Absätze, Listen bleiben Listen (ul/ol), Tabellen bleiben Tabellen,
- übersetzt und an DE-spezifischen Stellen lokalisiert.

Interne Verlinkung, Zielseiten-Erkennung, SERP und Stilprofil fallen komplett weg.

## Warum der Ist-Stand scheitert (Befund)
- 16 Schritte, davon 9 nur für Links und die Zielseiten-Suche (S2–S4, S7a–S9).
  - Das Ergebnis von S4 nutzt kein späterer Schritt.
  - Wenn S7 oder S8 blockiert, stoppt die ganze Textgenerierung (`deps.ts`).
- Die Struktur geht schon beim Extrahieren verloren (`extract.server.ts:146-220`):
  - h4–h6 werden ignoriert, `<ol>` wird zu `-`.
  - Fett/kursiv verschwinden.
  - `li` mit innerem `p` wird doppelt erfasst.
  - `aside`-Karussells und die Datum/Lesedauer-Zeile landen im Text.
  - Bei Tabellen ohne `<th>` wird immer Zeile 1 zum Header; colspan wird ignoriert.
- S11 lässt das Modell pro Abschnitt frei Markdown **neu schreiben**.
  - Die Struktur wird nur über Zähl-Guards (±1) erzwungen; Link-Einbau und Tabellen-Platzhalter kommen dazu.
  - Das ist die Quelle für zusätzliche Stichpunkte und inhaltliche Drift.
- S12 meldet nur, es repariert nichts.

## Grundprinzip des neuen Workflows
**Der Code besitzt die Struktur, das Modell nur den Text.**
- Die Quelle wird in eine typisierte Blockliste mit stabilen IDs zerlegt.
- Das Modell gibt für jede Block-ID nur den neuen Inhalt zurück (Text, Listenpunkte, Tabellenzellen).
- Markdown rendert ausschließlich der Code.
- Das Modell kann deshalb keine Liste, Tabelle oder Überschrift erfinden oder zerstören.

## Neue Pipeline (4 Schritte)

| # | StepKey | Art | Ergebnis im `jobs.context` |
|---|---|---|---|
| 1 | `extract` | Code | `source: { url, title, metaDescription, blocks: Block[] }` |
| 2 | `scan` | LLM `localization_scan` | `findings: Finding[]` |
| 3 | `localize` | LLM `localize_document` (+ gezielter Retry) | `localized: { meta, blocks }` |
| 4 | `review` | Code-Checks + LLM `localization_review` + Render | `review: { issues, applied }`, `exportMarkdown` |

`runFromStepFn` läuft weiter sequenziell in einem Request. Bei 3–4 LLM-Aufrufen ist das unkritisch. Keine Queue.

### Datenmodell (neu in `types.ts`)
```ts
type Inline = string; // Inline-Markdown nur: **fett**, *kursiv*. Links -> nur Ankertext.
type Block =
  | { id: string; type: "heading"; level: 1|2|3|4|5|6; text: Inline }
  | { id: string; type: "paragraph"; text: Inline }
  | { id: string; type: "list"; ordered: boolean; items: ListItem[] }
  | { id: string; type: "table"; hasHeader: boolean; rows: Inline[][] }
  | { id: string; type: "quote"; text: Inline };
type ListItem = { text: Inline; children?: ListItem[] }; // verschachtelte Listen erhalten
type Finding = {
  id: string; block_ids: string[]; de_reference: string;
  category: "behoerde"|"gesetz"|"organisation"|"service"|"zahl_einheit"|"waehrung"|"angebot"|"quelle"|"sonstiges";
  decision: "ersetzen"|"neutral"|"streichen";
  target_equivalent: string | null; instruction: string;
};
```
IDs: `b1`, `b2`, … in Dokumentreihenfolge.

### Schritt 1 – `extract` (Neuschreiben von `extract.server.ts`)
- **Inhaltsbereich:** `main` → `article` → sonst der kleinste Vorfahre der `h1`, der den Großteil der `p` enthält.
  - Grund: Die Barbet-Seite hat weder `main` noch `article`.
- **Entfernen:** `script, style, noscript, nav, header, footer, aside, form, button, figure img, iframe, svg`, Breadcrumbs, `.ai-metrics` (Datum/Lesedauer).
  - Noise-Selektoren als konstante Liste, damit sie leicht erweiterbar sind.
- **Rekursiver DOM-Walk in Dokumentreihenfolge** statt `querySelectorAll`-Flatten. Dadurch werden Elemente nicht doppelt erfasst.
  - `h1–h6` → heading mit Original-Level. Leere Überschriften bleiben erhalten.
  - `p`, Text-`div` mit Inline-Inhalt → paragraph.
  - `ul/ol` → list, mit Verschachtelung.
  - `table` → table:
    - `hasHeader` = es gibt `thead` oder `th` in Zeile 1.
    - `colspan` wird zu leeren Zellen aufgefüllt, damit alle Zeilen gleich viele Spalten haben.
    - Listen in Zellen werden mit `<br>` verbunden.
  - `blockquote` → quote.
- **Inline:** `strong/b` → `**…**`, `em/i` → `*…*`, `a` → nur Text, `br` → Leerzeichen.
- **Meta:** title, meta description. Kein hreflang, keine contentLinks mehr.
- **Fehler:** HTTP ≠ 200 oder 0 Blöcke → Step `error` mit klarer Meldung.

### Schritt 2 – `scan` (LLM, ein Aufruf)
- **Input:**
  - ganzes Dokument als nummerierte Blöcke (kompakte JSON-Form),
  - Marktprofil: `country`, `language`, `language_variant`, `brand`, `address_form`,
  - `institutions` als verbindliche Zuordnung,
  - `forbidden_claims`,
  - neu: `localization_notes`.
- **Prompt-Regeln (Vorgabe des Users):**
  1. Jede DE-spezifische Stelle finden: Behörden, Gesetze/Verordnungen, Verbände, Services, Hotlines, Preise/Währung, Einheiten, deutsche Quellen/Studien, Fressnapf-DE-Angebote.
  2. Gibt es im Zielland ein **passendes Gegenstück** → `ersetzen` mit `target_equivalent`. Eine Zuordnung aus `institutions` hat Vorrang.
  3. Gibt es **kein Gegenstück** → `neutral`: Die Aussage bleibt allgemein und ohne Verweis auf die Institution.
  4. Ist die Aussage für das Land **nicht relevant** → `streichen`.
  5. Im Zweifel nicht erfinden. Lieber `neutral`.
- **Output:** `{ findings: Finding[] }`, mit zod validiert. `block_ids` müssen existieren; unbekannte IDs werden verworfen.
- **UI:** Die Findings werden als Tabelle im Step-Output angezeigt (DE-Verweis → Entscheidung → Ersatz). Keine manuelle Freigabe.

### Schritt 3 – `localize` (LLM)
- **Input:** Blöcke (ohne `id`-Änderungsrecht), Findings, Marktprofil und Meta (title, meta description).
- **Prompt:**
  - Vollständig und treu übersetzen. Nichts zusammenfassen, keine neuen Absätze, Listen oder Überschriften.
  - Findings exakt anwenden.
  - Inline-`**`/`*` an den entsprechenden Stellen erhalten.
  - Anrede gemäß `address_form`.
- **Output:**
  ```json
  { "meta": { "title": "", "meta_description": "", "slug": "" },
    "blocks": [ { "id": "b1", "text": "..." }, { "id": "b7", "items": [...] },
                { "id": "b9", "rows": [[...]] }, { "id": "b12", "removed": true } ] }
  ```
  - `removed: true` ist nur erlaubt, wenn der Block in einem `streichen`-Finding vorkommt.
  - Listenpunkte dürfen nur bei `streichen` entfallen.
- **Code-Validierung pro Block:**
  - ID vorhanden und Typ passend.
  - Tabelle: gleiche Zeilen- und Spaltenzahl.
  - Liste: gleiche Item-Struktur (außer bei `streichen`).
  - Kein Markdown-Blocksyntax im Text (`#`, `|`, `- ` am Zeilenanfang).
  - Nicht leer.
  - Bei Zielsprache ≠ DE ist der Text nicht identisch mit der Quelle. Ausnahme: Kurztexte und Eigennamen unter 4 Wörtern.
- **Retry:** Fehlerhafte oder fehlende Blöcke werden **nur diese** erneut angefragt, mit Fehlerliste, max. 2×. Danach bleibt der Step `error` mit Liste der Block-IDs.
- **Lange Artikel:** über ca. 2.500 Wörter Quelltext werden H2-Gruppen in mehreren Aufrufen verarbeitet.
  - Jeder Aufruf bekommt die volle Gliederung und alle Findings als Kontext.
  - Danach führt der Code die Ergebnisse zusammen.

### Schritt 4 – `review` (Code + LLM, korrigierend, nicht blockierend)
- **Deterministisch:**
  - Struktur-Identität Quelle ↔ Ziel (Typen, Heading-Level, Tabellenformen).
  - `forbidden_claims`- und Marken-Schreibweise.
  - Restbestand: kommt `de_reference` eines Findings mit `ersetzen`/`neutral`/`streichen` noch im Zieltext vor (case-insensitive)?
  - CH-de: kein `ß`.
- **LLM `localization_review`:**
  - Input: Quellblöcke, Zielblöcke, Findings, Marktprofil und die deterministischen Treffer.
  - Output: `{ issues: [{ block_id, problem, fix: {text|items|rows} | null }] }`.
- **Fixes:** Der Code wendet sie nur an, wenn sie dieselbe Validierung wie in Schritt 3 bestehen. Abgelehnte oder fehlende Fixes erscheinen als Warnung.
- **Render (Code)** von `exportMarkdown`:
  - Meta-Kopf (Title, Meta-Description, Slug-Vorschlag), dann `---`.
  - Heading `#`×level.
  - Absätze durch Leerzeile getrennt.
  - ul `- `, ol `1. `, Verschachtelung mit 2 Spaces Einrückung.
  - GFM-Tabelle: Bei `hasHeader=false` wird Zeile 1 als Header genutzt (GFM-Pflicht), `|` wird escaped.
  - Quote `> `.
  - Kein Link-, Quellen- oder Metadaten-Anhang im Dokument. `closing_note` des Markts bleibt am Ende.
- **Job-Status:** `done` bzw. `done_with_errors`, wenn Warnungen offen sind (vorhandene Statuswerte).

## Umsetzungsschritte (Reihenfolge)
1. **Typen & Steps:** `src/lib/pipeline/types.ts`
   - `StepKey`/`PIPELINE` auf die 4 Schritte reduzieren.
   - `Block`, `Finding` und einen neuen `JobContext` definieren.
   - Alle Link-, Pool- und Topic-Typen entfernen.
2. **Extraktion:** `extract.server.ts` neu.
   - Nur noch `fetchHtml` + `extractBlocks`.
   - `collectContentLinks`, `verifyUrl`, `verifyAndExtract` und die Soft-404-Logik löschen.
3. **Rendering:** neues Modul `src/lib/pipeline/render.ts`: `renderMarkdown(blocks, meta, market)`, rein und testbar.
4. **Validierung:** neues Modul `src/lib/pipeline/validate.ts`: Block-Vergleich, Tabellen- und Listenform, Blocksyntax-Check. Ersetzt `tables.ts`, `content-guards.ts` und `plan.ts`.
5. **Schemas:** `schemas.ts` durch zod-Schemas für scan, localize und review ersetzen.
6. **Engine:** `engine.server.ts`
   - `runStep` auf 4 Cases neu schreiben.
   - `executeStep`, `upsertStep`, `syncJobStatus` und `loadTemplate` behalten.
   - `describeStepInput` an die neuen Inputs anpassen.
   - `deps.ts`: linear (Schritt n braucht n−1 `done`).
7. **Löschen** (DB bleibt unangetastet):
   - Dateien `pool.ts`, `hub.server.ts`, `hreflang.server.ts`, `serp.server.ts`, `topic.ts`, `paths.ts`, `plan.ts`, `tables.ts`, `content-guards.ts`.
   - `market-paths.server.ts` sowie der `MarketPaths`-Admin-Teil und `importMarketPaths`. Sie hängen nur an Zielseiten und Links.
   - `previewLinkPool` in `pipeline.functions.ts`.
   - Link-Abschnitte in `report.server.ts`.
   - Admin-Seite „Link-Pool“ (`admin/index.tsx`): `/admin` leitet auf `/admin/markets` um; Tab in `admin/route.tsx` entfernen.
   - Texte in `jobs/index.tsx` („14 Schritte“, `index_last_run`, Hinweis auf verified links im Lösch-Dialog).
   - Env-Abhängigkeiten DataForSEO und Firecrawl aus Code und README.
8. **Migration** `drizzle/migrations/0010_simplified_pipeline.sql` (nur additiv):
   - `ALTER TABLE markets ADD COLUMN IF NOT EXISTS localization_notes text`.
   - Insert/Upsert der Prompts `localization_scan`, `localize_document`, `localization_review` (Model `gpt-4o`, `response_format` JSON) inkl. Eintrag in `prompt_versions`.
   - Alte Prompt-Zeilen bleiben, werden aber nicht mehr referenziert.
   - `src/integrations/supabase/types.ts` um die Spalte ergänzen.
   - `db-export/setup.sql` entsprechend ergänzen.
9. **Admin Märkte:** `admin/markets.tsx` um ein Textarea „Lokalisierungshinweise“ und ein Feld `language_variant` erweitern.
10. **Job-Detail-UI:** `jobs/$jobId.tsx`
    - Step-Karten kommen automatisch aus `PIPELINE`.
    - Findings-Tabelle beim Scan-Step und Warnungsliste beim Review-Step ergänzen.
    - Export-Vorschau: gerendertes Markdown (vorhandene Markdown-Komponente nutzen, falls vorhanden, sonst `<pre>`), dazu Copy- und `.md`-Download.
11. **Alte Jobs:** Jobs, deren `context` kein `source.blocks` hat, sind „Legacy“.
    - Vorhandenes `exportMarkdown` bleibt anzeigbar.
    - „Komplett ausführen“ startet die neue Pipeline ab `extract` und überschreibt den Kontext.
    - Alte `job_steps`-Zeilen mit unbekannten Keys werden in der UI ignoriert.
12. **Exporte:**
    - `report.server.ts`, `prompt-vars.server.ts`, `prompts-export.server.ts` und `full-export.server.ts` auf die 4 Schritte anpassen.
    - `docs/pipeline/pipeline.md` und `docs/pipeline/prompts.md` neu schreiben (kurz).
    - `URL-ANALYSE-PIPELINE.md` löschen oder als veraltet markieren.
13. **Tests:** `tests/pipeline-regression.test.ts` ersetzen (siehe Validierung).

## Validierung
- **Unit-Tests (`bun test`) mit HTML-Fixtures** in `tests/fixtures/`. Barbet-Seite einmal speichern und ein synthetisches Fixture anlegen mit:
  - h2 direkt gefolgt von h3,
  - h4,
  - `ol`, verschachtelter `ul`,
  - `li > p`,
  - Tabelle ohne `th` und mit `colspan`,
  - `aside`-Karussell,
  - `.ai-metrics`,
  - `**fett**`.
- **Extraktion:** erwartete Blockliste (Typen, Level, Reihenfolge), keine Duplikate, Noise entfernt.
- **Render:** Snapshot-Markdown, ol nummeriert, Tabelle mit korrekter Spaltenzahl.
- **Validate:** abweichende Tabellenform, zusätzliche Listen-Items, `#` im Text, `removed` ohne Finding → Fehler.
- **Engine-Retry:** mit gemocktem `runPrompt`. Erste Antwort mit kaputtem Block → nur dieser Block wird nachgefragt → Merge korrekt.
- **Typecheck/Build:** `tsc --noEmit` bzw. `bun run build` grün. Keine Imports der gelöschten Module mehr (`rg "pool|hreflang|serp|hub\.server"`).
- **Manuell:** Barbet → PL und → CH-de.
  - Struktur identisch zur Quelle.
  - Keine deutschen Institutionen im PL-Text (z. B. VDH → ZKwP).
  - Kein `ß` bei CH-de.
  - Keine zusätzlichen Stichpunkte.

## Risiken / Hinweise
- **Modell-Halluzination bei „Gegenstücken“:** Gegenmittel sind die Regel „im Zweifel neutral“, die Vorrang-Zuordnung über `institutions`/`localization_notes` und der Review-Schritt. Eine Faktengarantie gibt es nicht.
- **Längere Artikel:** Chunking nach H2 hält die Output-Token im Rahmen. Zielwerte für den Chunk-Schwellwert vorerst als Konstante.
- **Lovable:** Nur normale Commits auf dem verbundenen Branch, kein Force-Push. Die Migration ist additiv. Den Branch nach jedem Schritt lauffähig halten.
- **Nicht im Scope:** interne Verlinkung, Zielseiten-Erkennung/Abgleich, Stilprofile, DOCX/HTML-Export, DB-Cleanup alter Tabellen.
