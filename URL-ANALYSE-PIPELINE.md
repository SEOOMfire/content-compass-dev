# URL-Analyse-Pipeline – Vollständige Dokumentation

> **VERALTET (Oktober 2026).** Dieses Dokument beschreibt die frühere 16-Schritt-Pipeline
> (S1–S13 inkl. Link-Pool, SERP, Stilprofil). Sie wurde durch die 4-Schritt-Pipeline
> `extract` → `scan` → `localize` → `review` ersetzt. Aktuelle Beschreibung:
> [`docs/pipeline/pipeline.md`](docs/pipeline/pipeline.md).

Dieses Dokument beschreibt die **komplette Pipeline**, die abläuft, wenn ein Nutzer eine
deutsche URL analysieren (lokalisieren) lässt. Es beantwortet für jeden Schritt:

1. **Was wird übergeben?** (Input)
2. **Was ist der Output?**
3. **Wie wird es umgesetzt?** (Code-Pfade, Algorithmen, Abrufregeln)
4. **Welche Prompts werden genutzt?** (Prompt-Schlüssel, Variablen, Modelle)

Die vollständigen Prompt-Texte stehen im Anhang (Abschnitt 8). Der Zustand „von Schritt zu
Schritt" wird über einen wachsenden **Kontext-Container** (`jobs.context`) weitergereicht.

---

## 1 · Technischer Rahmen

| Ebene | Technologie |
| --- | --- |
| Frontend | TanStack Start (React 19), TypeScript, TanStack Query |
| Backend-Logik | Server Functions (`createServerFn`), Node.js |
| Datenbank | Supabase / PostgreSQL (Tabellen `jobs`, `job_steps`, `markets`, `link_pool`, `verified_links`, `style_profiles`, `market_paths`, `prompt_templates`, `prompt_versions`, `user_roles`) |
| HTML-Extraktion | `node-html-parser` (serverseitig, kein Client-Fetch) |
| LLM | OpenAI-kompatibles Gateway (`OPENAI_BASE_URL`, `OPENAI_API_KEY`), Modell-Präfix `openai/` wird entfernt |
| SERP | DataForSEO (`serp/google/organic/live/advanced`), Credentials `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` |
| Websuche (optional) | Firecrawl (`FIRECRAWL_API_KEY`) als Fallback der Site-Suche in S7 |

**Zentrale Dateien** (alle unter `src/lib/pipeline/`):

| Datei | Aufgabe |
| --- | --- |
| `types.ts` | Schritt-Definitionen (`PIPELINE`), Kontext-Typen (`JobContext`) |
| `engine.server.ts` | Orchestrierung (`executeStep`, `runStep`), alle Schritt-Logiken |
| `pipeline.functions.ts` | Server-Function-Endpunkte (`createJob`, `runStepFn`, `runFromStepFn`, …) |
| `ai.server.ts` | LLM-Aufruf (`runPrompt`), Template-Rendering, JSON-Extraktion, Retry |
| `extract.server.ts` | HTML-Fetch, Extraktion, URL-Verifikation (`verifyUrl`) |
| `paths.ts` | Pfad-/hreflang-Logik (S2/S3) |
| `hreflang.server.ts` | hreflang-Ernte über Nachbarartikel |
| `hub.server.ts` | Link-Pool-Aufbau (Hub-Harvesting) + Site-Suche |
| `pool.ts` | Retrieval im Link-Pool (BM25-ähnlich + Trigramme) |
| `serp.server.ts` | DataForSEO-Abfragen (S7b/S7c) |
| `plan.ts` | Verdrahtung Plan (S6) → Schreibschritt (S11) |
| `tables.ts` | Tabellen-Prüfungen |
| `content-guards.ts` | Struktur-/Umfangs-Prüfungen, QA-Schweregrade |
| `deps.ts` | Abhängigkeitsprüfung vor jedem Schritt |
| `schemas.ts` | Zod-Schemata für LLM-Ausgaben |
| `market-paths.server.ts` | Pfadverzeichnis (`market_paths`) inkl. Sitemap-Import |

---

## 2 · Einstieg für den Nutzer (Frontend)

1. **Login** — Route `/_authenticated` prüft die Supabase-Session (`supabase.auth.getUser()`)
   und lädt die Rollen-Flags (`loadRoleFlags`). Ohne Session → Redirect auf `/auth`.
2. **Neuer Job** — Auf `/jobs` gibt der Nutzer ein:
   - `source_url` (deutsche Fressnapf-URL, Pflichtfeld, `type=url`)
   - `market_id` (Zielmarkt aus der `markets`-Tabelle, nur `active = true`)
3. **Job anlegen** — `createJob` (Server Function) fügt eine Zeile in `jobs` ein:
   ```ts
   { source_url, market_id, created_by, status: "idle", context: {} }
   ```
   Rückgabe: `{ id }`. Danach Navigation auf `/jobs/$jobId`.
4. **Ausführen** — Auf der Job-Detailseite stehen zwei Wege:
   - **„Komplett ausführen"** → `runFromStepFn` → iteriert `PIPELINE` und ruft für jeden
     Schritt `executeStep` auf; bricht beim ersten Fehler ab.
   - **Einzelschritt** „Ausführen"/„Erneut" → `runStepFn` → genau ein `executeStep`.
   - **„ab hier"** → `runFromStepFn({ fromStep })` ab einem bestimmten Schritt.
5. **Live-Ansicht** — `useQuery` pollt `jobs` und `job_steps` (3 s, nur bei laufenden Jobs).
   Jeder Schritt zeigt Status, `run_count`, Modell, Prompt-Snapshot und Output. Der finale
   Export (`context.exportMarkdown`) wird unten als Markdown angezeigt und kann kopiert
   werden.

> **Hinweis:** Die Server-Functions verlangen immer eine gültige Supabase-Session
> (`requireSupabaseAuth`-Middleware). Admin-Aktionen prüfen zusätzlich die Rolle per
> RPC `has_role`.

---

## 3 · Ausführungs-Engine (`executeStep`)

Für **jeden** Schritt läuft identisch ab (`engine.server.ts`):

1. **Job + Markt laden** — `jobs` (inkl. Join auf `markets`) und `jobs.context` lesen.
2. **Abhängigkeitsprüfung** — `dependencyBlocker(stepKey, context)` (`deps.ts`). Fehlt eine
   Voraussetzung, wird der Schritt mit Status `blocked` und Klartextgrund gespeichert
   (`job_steps`) und abgebrochen. **Es wird nie geraten.**
3. **Status `running`** — `job_steps` wird auf `running` gesetzt (`run_count` inkrementiert),
   `jobs.current_step` und `jobs.status = "running"` aktualisiert. Die kompakte
   Eingabebeschreibung (`describeStepInput`) wird als `input` gespeichert.
4. **Variable-Aufzeichnung starten** — `startVarRecording()` zeichnet alle Platzhalterwerte
   des Laufs für den „Platzhalter"-Report auf.
5. **Schritt ausführen** — `runStep(stepKey, job, market)` liefert `{ output, context,
   model, promptSnapshot, tokensIn, tokensOut }`.
6. **Kontext mergen** — `jobs.context = { ...context, ...result.context }` und speichern.
   Der Kontext **wächst** mit jedem Schritt.
7. **Status `done`** — Output, Dauer, Token, Modell, Prompt-Snapshot und aufgezeichnete
   Variablen in `job_steps` speichern.
8. **Fehler** — Status `error`. Eine `PipelineQualityError` (QA blockiert den Export)
   schreibt zusätzlich den Teil-Kontext zurück.
9. **Job-Status synchronisieren** (`syncJobStatus`):
   - `S13_export` = `done` und keine Fehler → `done`
   - `S13_export` = `done` mit Fehlern/Hinweisen → `done_with_errors`
   - mind. ein `error`/`blocked` → `error`
   - sonst → `idle`

### Der Kontext-Container (`jobs.context`)

Jeder Schritt liest aus `context` und schreibt sein Ergebnis zurück. Wichtige Schlüssel:

| Schlüssel | Erzeugt in | Inhalt |
| --- | --- | --- |
| `source` | S1 | extrahierte Quellseite (Abschnitte, Tabellen, Links, hreflang) |
| `slug` | S2 | `term_translated` + `slug_candidates` |
| `hreflangTargetUrl` | S2 | direktes hreflang-Ziel (falls vorhanden) |
| `target` | S3 | Zielstatus, URL, geprüfte Adressen, Extrakt, Methode, Evidence |
| `hreflangHarvest` / `derivedPathMap` | S3/S7a | hreflang-Ernte + abgeleitete Pfadübersetzung |
| `linkPool` | S7a/S7b/S7c | Link-Pool (Einträge, Geschwisterartikel, Abrufprotokoll) |
| `serpGap` / `serpOpportunities` | S7b / S7c | SERP-Ergebnisse |
| `styleProfile` | S5 | Stilprofil (gecacht) |
| `plan` | S6 | Lokalisierungsplan je Abschnitt |
| `linkCandidates` / `linkSearchLog` | S7 | Kandidaten je Anker + Suchprotokoll |
| `linkSelection` | S8 | gewählte Links je Anker |
| `verifiedLinks` / `brokenLinks` | S9 | geprüfte / verworfene Links |
| `tables` | S10 | lokalisierte Tabellen |
| `content` / `contentWarnings` | S11 | erzeugter Artikel je Abschnitt |
| `qa` | S12 | QA-Befunde |
| `exportMarkdown` | S13 | fertiges Markdown |

---

## 4 · LLM-Schicht (`ai.server.ts`)

Jeder LLM-Schritt lädt sein Template aus `prompt_templates` (`loadTemplate(stepKey)`) und
ruft `runPrompt(tpl, vars)` auf:

1. **Template-Rendering** (`renderTemplate`): Platzhalter `{{name}}` werden ersetzt.
   - Strings → unverändert eingefügt.
   - Objekte/Arrays → als eingerücktes JSON (`JSON.stringify(v, null, 2)`).
   - `null`/`undefined` → leerer String.
2. **Modell & Parameter** — Modell-Präfix (`openai/`) wird entfernt, `temperature` und
   `max_tokens` aus dem Template (Default 0.3 / 4000).
3. **Aufruf** — `POST {BASE_URL}/chat/completions` mit `system` + `user` Message.
   `response_format: "json"` → die Antwort wird via `extractJson` auch aus
   Code-Blöcken/umgebendem Text herausgelöst; sonst als Text übernommen.
4. **Retry** — bei Fehler bis zu 3 Versuche mit wachsender Wartezeit (800 ms × Versuch),
   außer bei erschöpftem Guthaben (`402`) oder Zugriff verweigert (`403`).
5. **Token-Zählung** — `usage.prompt_tokens` / `completion_tokens` werden je Schritt
   mitgeschrieben (`tokens_in`, `tokens_out`).
6. **Prompt-Snapshot** — `SYSTEM:\n…\n\nUSER:\n…` (mit aufgelösten Variablen) wird in
   `job_steps.prompt_snapshot` gespeichert und im UI angezeigt.

---

## 5 · Die 16 Schritte im Detail

Die Reihenfolge stammt aus `PIPELINE` in `types.ts`. Hinweis zur Benennung: die
Ausführungsreihenfolge ist S1 → S2 → S3 → S4 → **S7a → S7b → S7c** → S5 → S6 → S7 → S8 →
S9 → S10 → S11 → S12 → S13 (der Link-Pool S7a wird **vor** dem Stilprofil S5 gebaut, weil
S5 dessen Geschwisterartikel als Referenz braucht).

---

### S1 · Quelle extrahieren (`S1_extract_source`) — CODE

**Verständlich erklärt:** Das Tool ruft die eingegebene deutsche Webseite auf, so wie ein
Browser sie lädt. Aus dem Seitenquelltext fischt es den eigentlichen Artikel heraus und
räumt auf: Menü, Fußzeile, Werbung und technische Skripte fliegen raus. Übrig bleiben der
Text in sauber gegliederten Abschnitten, die Tabellen, die Links im Text und ein paar
Grunddaten wie Überschrift und Beschreibung. Diese „aufgeräumte" Version ist die Basis für
alle weiteren Schritte.

**Zweck:** Die deutsche Quellseite laden und in eine strukturierte Form überführen.

**Input:**
- `job.source_url` (deutsche URL).

**Umsetzung:**
- `extractPage(url)` → `fetchHtml(url)`: `GET` mit User-Agent
  `OMfireLocalizationBot/1.0`, `redirect: "follow"`. Netzwerkfehler liefern Status `0`
  statt abzubrechen.
- `extractDoc(...)` parst das HTML (`node-html-parser`):
  - Hauptbereich: `main` → sonst `article` → sonst `body`.
  - Entfernt: `script`, `style`, `noscript`, `nav`, `footer`, `header`.
  - **Abschnitte:** Durchlauf über `h1,h2,h3,p,li`. Jede Überschrift beginnt einen neuen
    Abschnitt; Absätze hängen sich als eigene Zeile an, echte `<li>` werden als `- `-Zeile
    erfasst (Formatierung bleibt unterscheidbar).
  - **Tabellen:** jede `<table>` wird zu Markdown (erste Zeile = Kopf, `|` maskiert),
    durchnummeriert. Im Abschnittstext bleibt ein Positionsmarker `[TABELLE n]`; die
    zugehörige Abschnittsüberschrift wird gespeichert.
  - **Content-Links:** interne Links nur aus dem Hauptbereich (ohne `#`, `mailto:`, `tel:`,
    Assets, Selbstverweis; dedupliziert) mit Ankertext → Grundlage der hreflang-Ernte.
  - Zusätzlich: `title`, `h1`, `metaDescription`, `canonical`, `hreflang`-Liste,
    `wordCount`, `outline`.
- **Abbruch:** HTTP-Status ≠ 200 bricht den Job ab.

**Output:**
- Kontext: `context.source` (SourceDoc).
- UI-Output: Zusammenfassung (Anzahl Abschnitte, hreflang-Einträge, Content-Links).

**Prompt:** keiner.

---

### S2 · Ziel-Slug ermitteln (`S2_resolve_slug`) — CODE + LLM (Fallback)

**Verständlich erklärt:** Hier geht es nur um die Frage, wie die Seite im Zielland heißen
würde. Zuerst schaut das Tool, ob die deutsche Seite selbst schon einen Hinweis auf ihre
Übersetzung enthält (das hreflang-System). Falls ja, wird dieser Link übernommen. Falls
nein, wird die künstliche Intelligenz gefragt, wie das letzte Stück der Adresse — zum
Beispiel „barbet" — in der Zielsprache heißen könnte. Sie liefert mehrere Vorschläge, die
in den nächsten Schritten ausprobiert werden.

**Zweck:** Den deutschen Fachbegriff in die Zielsprache übersetzen und Slug-Kandidaten bilden.

**Input:**
- `source.hreflang`, `source.h1`, `source.title`, `job.source_url`, `market.locale`,
  `market.language`, `market.country`.

**Umsetzung:**
- **Stufe 1 – hreflang:** `matchHreflang(source.hreflang, market.locale)` (exakte Locale,
  sonst nur Sprachteil). Treffer → Slug = letztes Pfadsegment der Alternate-URL (Fallback:
  `slugify(h1)`). `hreflangTargetUrl` wird gesetzt, **kein** LLM-Aufruf
  (`skipped_llm: true`).
- **Stufe 2 – LLM:** nur wenn kein Alternate existiert. Übersetzungsgrundlage ist das
  **letzte Pfadsegment** der Quell-URL (`lastPathSegment`) — nicht die Überschrift.
  Prompt **`resolve_target_slug`**. Die Antwort wird gegen `S2OutputSchema`
  (`term_translated`, `slug_candidates[]`) validiert; Kandidaten werden normalisiert
  (`slugify`: Kleinbuchstaben, Akzente weg, Bindestriche) und dedupliziert. Leere
  Kandidaten = Fehler (kein Fallback).

**Output:**
- Kontext: `slug = { term_translated, slug_candidates }`, `hreflangTargetUrl`.

**Prompt:** `resolve_target_slug` (Modell `gpt-4o-mini`, Temp 0.3, JSON).

---

### S3 · Zielstatus prüfen (`S3_target_status`) — CODE (+ LLM-Fallback)

**Verständlich erklärt:** Jetzt wird geprüft, ob es die Seite im Zielland überhaupt schon
gibt. Das Tool probiert mehrere Wege nacheinander: erst den direkten Übersetzungs-Link,
dann die Übersichtsseite des Themas, dann fragt es bei Nachbarartikeln nach, und zuletzt
baut es aus den vorgeschlagenen Namen selbst Adressen zusammen und testet sie. Am Ende
steht fest: Die Seite existiert, sie ist nachweislich tot (Fehlermeldung 404), oder sie
wurde nirgends gefunden. Diese Unterscheidung ist wichtig, damit der Nutzer weiß, ob neu
erstellt werden muss.

**Zweck:** Existiert die Seite im Zielmarkt bereits? Drei mögliche Ergebnisse:
`EXISTS`, `VERIFIED_404`, `NOT_IN_INDEX`. Jede Teilentscheidung wird als Evidence-Kette
protokolliert, jede geprüfte Adresse mit HTTP-Status in `checked`.

**Input:**
- `source`, `slug`, `hreflangTargetUrl`, `market`, gelerntes Pfadverzeichnis (`market_paths`),
  ggf. bereits gebauter Link-Pool.

**Umsetzung (Kaskade, erste Treffer gewinnt):**
1. **Stufe 1 – hreflang:** `hreflangTargetUrl` per `verifyUrl` prüfen
   (HTTP 200 + Canonical passt + kein Soft-404). Bestanden → `EXISTS`/`hreflang`.
   Existieren Alternates, aber keines für die Ziel-Locale → `hreflang_hint` als starkes
   Gegenindiz.
2. **Stufe 2 – Hub-Liste:** Elternpfad über `path_map` in eine Hub-Adresse übersetzen,
   Hub abrufen (`fetchHubEntries`), `matchHubEntry` (Trigramm-Ähnlichkeit ≥ 0,72 auf
   Ankertext + Slug). Treffer per `verifyUrl` prüfen.
3. **Stufe 2b – hreflang-Ernte:** `harvestHreflangEquivalents` ruft bis zu **20** im
   Content verlinkte Nachbarseiten ab (1 s Abstand), liest deren hreflang-Alternate für
   die Ziel-Locale und leitet daraus Pfadpaare ab (`derivePathPairs`, letztes Segment
   bleibt außen vor). Erneuter `matchHubEntry` über die belegten Ziele.
4. **Stufe 3 – Slug-Kandidaten live prüfen:** DE-Pfad segmentweise übersetzen
   (`path_map` → gelerntes Verzeichnis → abgeleitete Paare), Sprachpräfix voranstellen,
   letztes Segment durch jeden Slug-Kandidaten ersetzen und jede Adresse `verifyUrl`.
   Fehlen Verzeichnissegmente, fragt `resolveMissingSegments` den Prompt
   **`translate_path_segment`** (bis zu 3 Kandidaten je Lücke, max. 9 Kombinationen) und
   bestätigt jeden Vorschlag per Live-Abruf, bevor er in `market_paths` gespeichert wird.

**Status-Regel:**
- gefunden → `EXISTS` (Zielseite wird zusätzlich vollständig extrahiert),
- sonst mind. eine Prüfung mit 404 → `VERIFIED_404`,
- sonst → `NOT_IN_INDEX`.

**Output:**
- Kontext: `target` (Status, URL, `checked`, `doc`, `resolution_method`, `hreflang_hint`,
  `evidence`), `hreflangHarvest`, `derivedPathMap`.

**Prompt:** `translate_path_segment` (nur bei Pfadlücken, `gpt-4o-mini`, JSON).

---

### S4 · Abgleich DE ↔ Ziel (`S4_compare`) — LLM

**Verständlich erklärt:** Falls es im Zielland schon eine Seite gibt, vergleicht die
künstliche Intelligenz sie mit der deutschen: Ist sie lang genug, gut gegliedert und
inhaltlich gleichwertig? Wenn ja, ist der Auftrag hier praktisch erledigt und es muss
nichts neu geschrieben werden. Wenn nein, geht es mit der Neuerstellung weiter.

**Zweck:** Entscheiden, ob der bestehende Zielcontent ausreicht oder neu erstellt werden muss.

**Input:**
- `source.outline`, `source.wordCount`, `target.doc.outline`, `target.doc.wordCount`,
  Zieltext-Auszug (max. 4000 Zeichen).

**Umsetzung:**
- Existiert keine Zielseite (`!ctx.target.doc`) → Schritt übersprungen, `compare = { new_page: true }`.
- Sonst Prompt **`compare`** → `AUSREICHEND` oder `NEU_ERSTELLEN` mit Lückenliste.

**Output:**
- Kontext: `compare`.

**Prompt:** `compare` (`gpt-4o-mini`, Temp 0.2, JSON).

---

### S7a · Link-Pool aufbauen (`S7a_link_pool`) — CODE

**Verständlich erklärt:** Um später passende interne Verlinkungen setzen zu können, baut
das Tool eine kleine Sammlung bekannter Seiten des Zielmarkts auf. Dafür besucht es
gezielt ein paar Seiten: die Themen-Übersicht, die Startseite und ein paar ähnliche
Artikel. Von diesen Seiten sammelt es alle internen Links samt Beschriftung und merkt sich
zusätzlich ein paar Artikel als Stil-Vorlagen für später.

**Zweck:** Einen fokussierten Link-Pool des Zielmarkts bauen (ersetzt den früheren
Gesamtindex). Der Pool ist die Kandidatenquelle für S3 und S7.

**Input:**
- `source.contentLinks`, `market` (Domain, `path_map`, `magazine_root`, `category_root`,
  `crawl_delay_ms`), gelernte + abgeleitete Pfadkarten.

**Umsetzung (`buildLinkPool`, max. 8 Abrufe):**
1. **Stufe 0 – Ernte:** `harvestHreflangEquivalents`, falls in S3 noch nicht geschehen.
2. **Hub-Seiten** (bis zu 2 Kandidaten aus der übersetzten Elternhierarchie): alle internen
   Links mit Ankertext sammeln, Herkunft (`hub`/`nav`/`inline`/`footer`) über den
   umgebenden HTML-Container bestimmen, Typ klassifizieren (`magazine`/`category`/`other`).
3. **Navigation:** Magazin-Wurzel bzw. Startseite.
4. **Geschwisterartikel** (bis zu 3, `origin: hub`, Typ `magazine`): vollständig abrufen →
   liefern (a) weitere Links und (b) bis zu 6000 Zeichen Klartext je Artikel als
   Stilreferenz für S5.
- Belegte hreflang-Ziele werden **vorn** eingefügt, nicht abgerufene Quellkandidaten
  (`scope: source_candidate`) **hinten** angehängt.
- **Persistenz:** alte Einträge (> 7 Tage) löschen, Rest in Blöcken zu 200 in `link_pool`
  schreiben (Upsert auf `market_id + content_type + url`).

**Output:**
- Kontext: `linkPool` (Hub-URL, Abrufprotokoll, Einträge, Geschwisterartikel),
  `hreflangHarvest`, `derivedPathMap`.

**Prompt:** keiner.

---

### S7b · SERP-Lückenanalyse (`S7b_serp_gap`) — LLM + DataForSEO

**Verständlich erklärt:** Manche nützlichen Artikel sind über die normale Navigation gar
nicht auffindbar. Deshalb lässt das Tool eine Suchmaschine (Google, über einen
Datenanbieter) gezielt auf der Ziel-Webseite suchen. Die KI formuliert passende
Suchbegriffe, das Tool sucht, und eine zweite KI-Prüfung wählt nur die Treffer aus, die
wirklich thematisch passen. Gute Treffer kommen in die Sammlung.

**Zweck:** Artikel im Zielmarkt finden, die weder über hreflang noch über Hub/Nachbarseiten
auffindbar waren.

**Input:** gefüllter Link-Pool, `source` (Thema, Gliederung, Content-Links), `market`.

**Umsetzung:**
1. **Suchanfragen (LLM):** Prompt **`serp_gap_queries`** liefert ≤ 5 Suchbegriffe in der
   Zielsprache (ohne `site:`-Operator).
2. **SERP:** `runSerpQueries` → jede Anfrage als `site:<domain> <begriff>` an DataForSEO
   (erste Ergebnisseite, `depth: 10`, Land/Sprache aus `market.locale`). Parallel, hartes
   Gesamtbudget 5 Minuten (offene Anfragen → `skipped`). Fremde Hosts und bereits bekannte
   Adressen werden verworfen (max. 40 Kandidaten).
3. **Auswahl (LLM):** Prompt **`serp_gap_select`** wählt nur redaktionell passende Seiten
   (keine Produkt-/Kategorie-/Serviceseiten).
4. **Prüfung & Übernahme:** jede gewählte Adresse per `verifyUrl`; nur bestandene landen
   mit `origin = serp`, `scope = target`, `fetched = true` in `link_pool`.

**Output:**
- Kontext: `serpGap` + erweiterter `linkPool`.

**Prompts:** `serp_gap_queries` + `serp_gap_select` (beide `gpt-4o-mini`, JSON).

---

### S7c · SERP-Linkchancen (`S7c_serp_opportunities`) — LLM + DataForSEO

**Verständlich erklärt:** Zusätzlich überlegt die KI, an welchen Stellen im Text noch ein
sinnvoller interner Link fehlen könnte — auch wenn wir gar nicht wissen, ob es dazu eine
Seite gibt. Für jede Idee formuliert sie einen Suchbegriff, das Tool sucht auf der
Zielseite danach, und passende Treffer werden wieder in die Sammlung aufgenommen.

**Zweck:** Zusätzliche Linkziele ableiten, von denen nicht bekannt ist, ob es sie im
Zielmarkt gibt — die aber inhaltlich naheliegen.

**Input:** Link-Pool, `source` (Gliederung + gekürzte Abschnittstexte), `market`,
`ctx.serpGap.queries` (bereits gestellte Anfragen).

**Umsetzung:**
1. **Chancen (LLM):** Prompt **`serp_opportunity_queries`** liefert ≤ 10 Chancen
   (Thema + Suchbegriff + Begründung), ohne Wiederholungen aus S7b.
2. **SERP:** `site:<domain><sprachverzeichnis> <begriff>` (Sprachverzeichnis z. B. `/fr`
   wird übernommen, Treffer außerhalb verworfen). Hartes 5-Minuten-Budget, max. 60 Kandidaten.
3. **Auswahl (LLM):** Prompt **`serp_gap_select`** (wie S7b).
4. **Prüfung & Übernahme:** `verifyUrl`, bestandene → `link_pool` mit `origin = serp`.

**Output:**
- Kontext: `serpOpportunities` + erweiterter `linkPool`.

**Prompts:** `serp_opportunity_queries` + `serp_gap_select`.

---

### S5 · Stilprofil (`S5_style_profile`) — LLM (gecacht)

**Verständlich erklärt:** Jeder Markt schreibt anders — manche duzen, manche siezen, mal
kurze Sätze, mal lange. Damit der neue Text sich nahtlos in die bestehende Webseite
einfügt, schaut sich die KI ein paar vorhandene Artikel an und leitet daraus einen
„Steckbrief" des Schreibstils ab. Diesen Steckbrief merkt sich das Tool, damit es ihn nicht
jedes Mal neu berechnen muss.

**Zweck:** Ein Stilprofil aus Bestandsseiten des Zielmarkts ableiten (Ansprache, Satzlänge,
Überschriftenstil, Tonfall, wiederkehrende Formulierungen).

**Input:**
- Geschwisterartikel aus `linkPool.siblings` (Titel + bis zu 6000 Zeichen Text je Artikel).

**Umsetzung:**
- Zuerst Cache-Check in `style_profiles` (`market_id` + `content_type = magazine`).
  Treffer → ohne LLM-Aufruf verwenden.
- Sonst Referenztexte zusammenfügen (max. 12 000 Zeichen) und Prompt **`style_profile`**
  aufrufen. Ergebnis dauerhaft in `style_profiles` speichern.
- Ohne Geschwisterartikel bricht der Schritt bewusst ab (kein Stil wird erfunden).
- **Wichtig:** `markets.address_form` überschreibt das automatisch ermittelte Profil, da
  die Bestandsseiten (z. B. maxizoo.pl) uneinheitlich sind.

**Output:**
- Kontext: `styleProfile`.

**Prompt:** `style_profile` (`gpt-4o-mini`, Temp 0.3, JSON).

---

### S6 · Lokalisierungsplan (`S6_localization_plan`) — LLM

**Verständlich erklärt:** Der wichtigste Denkschritt. Die KI geht jeden Abschnitt des
deutschen Textes durch und entscheidet: einfach übersetzen, anpassen (weil etwa Gesetze
oder Vereine im Zielland anders heißen), komplett umschreiben (weil das Thema dort nicht
existiert) oder ganz weglassen. Außerdem merkt sie pro Abschnitt, welche Begriffe sich gut
intern verlinken ließen. Geschrieben wird hier noch nichts — es entsteht nur der Plan.

**Zweck:** Qualitätsentscheidender Schritt. Legt pro Abschnitt die Aktion fest, **ohne**
Fließtext zu schreiben.

**Input:**
- Deutsche Gliederung (je Abschnitt Überschrift + 500 Zeichen Text),
- Marktprofil (Land, Sprache, Marke, Institutionen, verbotene Aussagen, Ansprache).

**Umsetzung:**
- Prompt **`localization_plan`** → je Abschnitt: `de_heading`, `target_heading`, `action`
  (genau eines von `uebersetzen` | `lokalisieren` | `umschreiben` | `streichen`), `notes`,
  `has_table`, 0–4 `anchors` (Ankertext, Intent, Suchbegriffe, `path_type`).
- Validierung gegen `S6OutputSchema` (hart).

**Output:**
- Kontext: `plan = { sections }`.

**Prompt:** `localization_plan` (`gpt-4o`, Temp 0.3, max 8000, JSON) — das stärkste Modell
für die Planung.

---

### S7 · Linkkandidaten (`S7_link_candidates`) — CODE

**Verständlich erklärt:** Für jeden vorgeschlagenen Verlinkungs-Begriff sucht das Tool
jetzt passende Seiten aus seiner Sammlung heraus und bewertet, wie ähnlich sich Begriff
und Seitenbeschriftung sind. Reicht das nicht, fragt es zusätzlich die interne Suche des
Zielmarkts oder eine Websuche an. Am Ende hat jeder Begriff eine Liste von Kandidaten.

**Zweck:** Für jeden Anker aus S6 passende Zielkandidaten finden (zweistufig).

**Input:**
- `plan.sections[].anchors`, `linkPool.entries`, `market` (Suchmuster).

**Umsetzung:**
- Suchanfrage = `anchor + search_terms + intent`.
- **Stufe 1 – Pool-Retrieval** (`retrieveFromPool`): nur nutzbare Einträge
  (`scope = target`, `fetched`). Bewertung = IDF-Termgewichtung über Ankertext + URL-Slug +
  Breadcrumb, plus doppelt gewichtete Trigramm-Ähnlichkeit (Dice). Filter auf `path_type`,
  sonst ohne Filter; Rückgabe bis zu 8 Treffer absteigend.
- **Stufe 2 – Site-Suche** (`siteSearch`): nur wenn leer oder bester Score < 0,6 und
  Budget (10) reicht. Bevorzugt die interne Suche des Markts (`search_url_pattern` mit
  `{q}`); alternativ `site:`-Websuche via Firecrawl. Neue Treffer wandern in den Pool,
  Suche wird wiederholt.
- Jede Anfrage wird in `linkSearchLog` protokolliert.

**Output:**
- Kontext: `linkCandidates` (je Anker Liste aus `url`, `title`, `path_type`),
  `linkSearchLog`.

**Prompt:** keiner.

---

### S8 · Linkauswahl (`S8_link_select`) — LLM

**Verständlich erklärt:** Die KI bekommt pro Begriff nur eine nummerierte Liste aus
Seitentiteln — die eigentlichen Adressen sieht sie bewusst nicht. Sie wählt die passende
Nummer oder sagt „keine passt". Das Tool übersetzt die Nummer dann selbst in die Adresse.
So ist technisch ausgeschlossen, dass die KI sich eine erfundene Adresse ausdenkt.

**Zweck:** Aus der Kandidatenliste pro Anker die beste Seite wählen — **ohne** dass das
Modell URLs sieht.

**Input:** `linkCandidates` (je Anker nummerierte Liste aus **Titel + Seitentyp**, niemals Adressen).

**Umsetzung:**
- Pro Anker Prompt **`link_select`** → `choice` (Nummer) oder `null`.
- Die Nummer wird gegen die Listenlänge geprüft (`1..n`) und erst dann in eine URL
  aufgelöst. Damit sind erfundene Links strukturell ausgeschlossen.

**Output:**
- Kontext: `linkSelection` (je Anker `url | null` + Konfidenz).

**Prompt:** `link_select` (`gpt-4o-mini`, Temp 0.1, JSON).

---

### S9 · Linkprüfung (`S9_link_verify`) — CODE + LLM (Zusammenfassung)

**Verständlich erklärt:** Jede ausgewählte Seite wird jetzt wirklich aufgerufen und
geprüft: Lädt sie überhaupt? Zeigt sie auf die richtige Adresse? Ist sie keine
„Seite nicht gefunden"-Falle? Nur Seiten, die alle Prüfungen bestehen, dürfen später im
Text verlinkt werden. Zusätzlich fasst die KI kurz zusammen, worum es auf der Seite geht,
damit der Schreiber später den richtigen Link an die richtige Stelle setzt.

**Zweck:** Jede gewählte URL live prüfen und eine Inhaltszusammenfassung erzeugen.

**Input:** `linkSelection`, `market`.

**Umsetzung:**
- Vorherige `verified_links` des Jobs löschen (idempotent).
- Je gewählter URL: `verifyAndExtract` (ein Abruf liefert Prüfung + Extrakt).
  - **Nicht bestanden** (HTTP ≠ 200, Canonical weicht ab/fehlt, Soft-404) → Eintrag in
    `brokenLinks` **und** Löschung aus `link_pool` (tote Adresse wird nicht erneut gewählt).
  - **Bestanden** → Prompt **`link_summary`** erzeugt einen Absatz (max. 60 Wörter,
    Zielsprache) + `page_type` (`ratgeber`/`kategorie`/`produkt`/`sonstige`). Beides wird in
    `verified_links.summary`/`page_type` gespeichert und in S11 mitgegeben. Schlägt die
    Zusammenfassung fehl, bleibt der Link gültig; der Seitentyp wird dann aus der
    Textmenge abgeleitet (≥ 250 Wörter → `ratgeber`).
- 1 Sekunde Pause zwischen zwei Abrufen.

**Output:**
- Kontext: `verifiedLinks`, `brokenLinks`.

**Prompt:** `link_summary` (`gpt-4o-mini`, Temp 0.2, JSON).

---

### S10 · Tabellen lokalisieren (`S10_localize_tables`) — LLM

**Verständlich erklärt:** Tabellen werden separat übersetzt, eine nach der anderen. Danach
prüft das Tool automatisch, ob die übersetzte Tabelle genauso viele Zeilen und Spalten hat
wie das Original und ob wirklich übersetzt wurde. Passt etwas nicht, wird es bis zu dreimal
neu versucht. Tabellen getrennt zu behandeln verhindert, dass beim Übersetzen Zeilen
verloren gehen oder das Layout zerbricht.

**Zweck:** Tabellen getrennt vom Fließtext lokalisieren (ein Aufruf pro Tabelle).

**Input:** `source.tables` (Markdown), `market.language`, `market.country`,
`market.institutions`.

**Umsetzung:**
- Ohne Tabellen → leer, nichts passiert.
- Je Tabelle Prompt **`localize_table`**, danach **deterministische Prüfung**
  (`checkLocalizedTable`): gleiche Zeilenzahl **und** gleiche Spaltenzahl/Struktur **und**
  (bei Zielsprache ≠ Deutsch) tatsächlich verändertes Ergebnis. Fällt die Prüfung durch,
  wird bis zu 3× wiederholt; danach bricht der Schritt mit Grund ab.

**Output:**
- Kontext: `tables` (lokalisierte Markdown-Tabellen).

**Prompt:** `localize_table` (`gpt-4o-mini`, Temp 0.2, max 4000, JSON).

---

### S11 · Content erzeugen (`S11_generate_content`) — LLM (pro Abschnitt)

**Verständlich erklärt:** Jetzt wird tatsächlich geschrieben — aber Abschnitt für
Abschnitt, nicht alles auf einmal. Die KI bekommt pro Abschnitt den deutschen Originaltext,
den Plan aus S6, den Schreibstil aus S5 und die geprüften Links aus S9. Sie schreibt den
Abschnitt in der Zielsprache. Das Tool kontrolliert danach automatisch, ob alles stimmt
(nur eine Überschrift, keine eigenen Tabellen, ähnlicher Umfang) und lässt bei Fehlern
nachbessern. Weil jeder Abschnitt den bisherigen Text kennt, werden Wiederholungen
vermieden. Besteht ein Abschnitt dagegen nur aus einer Überschrift plus Tabelle (z. B. ein
Steckbrief), schreibt die KI gar nichts — das Tool setzt ihn direkt ohne KI zusammen.

**Zweck:** Der finale Content-Schritt. Erzeugt den Zieltext Abschnitt für Abschnitt.

**Input (je Abschnitt):**
- `buildSectionInputs` verdrahtet Plan → Quellabschnitte (über normalisiertes
  `de_heading`; keine Zuordnung = Fehler) und ordnet Tabellen deterministisch über die
  Positionsmarker `[TABELLE n]` zu.
- An das Modell: Zielsprache/-variante, Land, Marke, Ansprache, Stilprofil,
  Zielüberschrift + Ebene, ungekürzter deutscher Abschnitt (mit
  `[[OMFIRE_TABLE_n]]`-Markern), Aktion, Lokalisierungshinweise, **bereits geschriebene
  Überschriften**, **der komplette bisherige Artikel** (`previous_content`), Liste der
  noch verfügbaren verifizierten Links (`verified_links`), **bereits gesetzte Links**
  (`used_links`), Tabellenmarker, Strukturzahlen (Wortzahl, Listenpunkte, Absätze),
  Korrekturhinweise, Institutionen, verbotene Aussagen.

**Umsetzung:**
- **Überschriftenebene:** jeder Abschnitt übernimmt die Ebene (H1/H2/H3) des deutschen
  Quellabschnitts; nach der Erzeugung per `enforceHeadingLevel` erzwungen.
- **Inhaltsverzeichnis:** TOC-Überschriften → nur Überschrift + `[INHALTSVERZEICHNIS –
  Platzhalter]`, keine KI.
- **Reine Tabellen-Abschnitte (ohne LLM):** besteht der Abschnitt nach Abzug der
  Überschrift ausschließlich aus Tabellenmarkern (`[[OMFIRE_TABLE_n]]`, kein Fließtext),
  wird **kein** `generate_content`-Aufruf ausgeführt. Der Abschnitt wird direkt im Code
  zusammengesetzt (Überschrift + je eine Markerzeile in Original-Reihenfolge); die
  Tabellen-Substitution und die Schlussprüfung laufen unverändert weiter.
- **Schleife:** ein `generate_content`-Aufruf pro Abschnitt, streng von oben nach unten;
  Abschnitte mit `streichen` werden übersprungen. Max. 3 Versuche je Abschnitt.
- **Harte Guards** (`checkGeneratedSection` + Marker-Prüfung): genau eine Überschrift,
  keine eigene Tabelle (`stripMarkdownTables`), Tabellenmarker genau einmal, keine
  verschachtelten Überschriften, Listenpunktzahl nicht > ±1 abweichend. Der Marker wird
  **zuerst wörtlich im rohen Modell-Output** geprüft — fehlt er dort (auch wenn an seiner
  Stelle etwas Tabellenähnliches steht), gilt das als harter Fehler. Nach 3 Verstößen
  → Fehler.
- **Weiche Abweichungen** (Absatzzahl ±1, Wortbudget) → ein Korrekturversuch; bleibt die
  Abweichung, wird der Abschnitt übernommen und als Hinweis protokolliert.
- **Linkbudget (im Code durchgesetzt):** nach jedem Abschnitt werden die gesetzten Links
  per Regex aus dem Markdown gelesen und je Ziel-URL gezählt. Eine URL mit 2 Verwendungen
  wird aus der Kandidatenliste des nächsten Abschnitts entfernt; eine URL mit 1 Verwendung
  bleibt markiert („bereits 1x verlinkt als …") und ist nur mit anderem Ankertext erneut
  erlaubt.
- **Schlussprüfung:** jede lokalisierte Tabelle exakt einmal, keine fremde Tabelle
  (`checkExactTables`).

**Output:**
- Kontext: `content` (Liste `{ heading, markdown }`), `contentWarnings`.

**Prompt:** `generate_content` (`gpt-4o`, Temp 0.6, max 6000, **Text**).

---

### S12 · QA (`S12_qa`) — CODE + LLM

**Verständlich erklärt:** Eine Art Schlussredaktion. Die KI liest den fertigen Text noch
einmal komplett und sucht nach Fehlern: deutsche Restwörter, falscher Markenname,
erfundene Links, kaputte Tabellen. Zusätzlich macht das Tool selbst ein paar technische
Kontrollen, die nicht der KI überlassen werden — darunter ein automatischer Abgleich der
Markenschreibweise. Nur schwere, eindeutige Fehler stoppen die Ausgabe; alles andere
(auch Marken-Hinweise der KI) wird nur als Hinweis mitgeliefert.

**Zweck:** Sprach-, Marken-, Claim- und Strukturprüfung des Gesamttexts.

**Input:** `content`, `source`, `tables`, `plan`, `market`.

**Umsetzung:**
- **Deterministische Code-Prüfungen** (`deterministicArticleIssues`): Tabellenanzahl/
  -identität, Struktur je Abschnitt (Listen/Überschriften/Absätze), Gesamtlänge sowie —
  neu — ein **deterministischer Marken-Abgleich** (`deterministicBrandIssues`): blockiert
  nur bei einer tatsächlich falsch geschriebenen Marke (Nah-Treffer, Typ `marke_falsch`);
  Groß-/Kleinschreibung und Leer-/Bindestrich-Varianten gelten als korrekt.
- **LLM-Prüfung** Prompt **`qa`** mit Volltext, Quelle, lokalisierten Tabellen und einem
  Strukturbericht (Wortzahl/Listen/Absätze je Abschnitt Quelle vs. Ziel).
- Befunde werden kombiniert und mit `issueSeverity` klassifiziert. **Blockierend** (Stoppt
  den Export) sind nur: Tabellenprobleme, verbotene Aussagen/Claims sowie echte
  Marken-Rechtschreibfehler (`marke_falsch`). Der LLM-Typ `marke` blockiert **nicht mehr**:
  er wird weiterhin erzeugt, geloggt und im Report als Hinweis angezeigt.

**Output:**
- Kontext: `qa = { issues, blocking, warnings }`.
- Blockierende Fehler → `PipelineQualityError` (Schritt `error`, Export bleibt gesperrt).

**Prompt:** `qa` (`gpt-4o-mini`, Temp 0.2, max 4000, JSON).

---

### S13 · Export (`S13_export`) — CODE

**Verständlich erklärt:** Der letzte Schritt baut aus allem, was bisher entstanden ist,
das fertige Dokument zusammen: Überschrift, kurze Kopfzeilen (Quelle, Lesedauer,
Zielstatus), der komplette Text, die Liste der geprüften Links und ein Hinweis auf
verworfene Links. Das Ergebnis wird als Text angezeigt und kann kopiert oder
heruntergeladen werden.

**Zweck:** Das fertige Markdown ohne weiteren LLM-Aufruf zusammenbauen.

**Input:** `content`, `tables`, `verifiedLinks`, `brokenLinks`, `target`, `slug`,
`linkPool`, `market.closing_note`.

**Umsetzung:**
- Vorab `checkExactTables` (blockiert bei fehlenden/doppelten/fremden Tabellen).
- Aufbau des Markdown:
  - **H1** aus dem übersetzten Begriff (`headline`: Bindestriche auflösen, erster
    Buchstabe groß, **nie als Slug**) — nur wenn der Text keine eigene H1 enthält.
  - Kopfzeilen: Quelle, Wortzahl + Lesezeit (200 Wörter/Minute, min. 1), Zielstatus,
    Zielermittlung, hreflang-Hinweis, Link-Pool-Umfang.
  - alle Abschnitte in Planreihenfolge (Überschriftsebene aus dem deutschen Original).
  - „Verifizierte Links" mit HTTP-Status.
  - „Verworfene Poolkandidaten" (Gap-Report).
  - Abschlusshinweis des Markts (falls gepflegt).

**Output:**
- Kontext: `exportMarkdown` (wird im UI angezeigt + kopierbar; zusätzlich als
  `job-<id>-report.md` / „Gesamtdoku" / „Platzhalter" herunterladbar).

**Prompt:** keiner.

---

## 6 · Prompt-Übersicht

| Schritt | Prompt-Schlüssel | Modell | Temp | max Tokens | Format |
| --- | --- | --- | --- | --- | --- |
| S2 | `resolve_target_slug` | gpt-4o-mini | 0.3 | 1000 | JSON |
| S3 (Fallback) | `translate_path_segment` | gpt-4o-mini | 0.3 | 1000 | JSON |
| S4 | `compare` | gpt-4o-mini | 0.2 | 2000 | JSON |
| S5 | `style_profile` | gpt-4o-mini | 0.3 | 2000 | JSON |
| S6 | `localization_plan` | gpt-4o | 0.3 | 8000 | JSON |
| S7b | `serp_gap_queries` | gpt-4o-mini | 0.4 | 1500 | JSON |
| S7b/S7c | `serp_gap_select` | gpt-4o-mini | 0.2 | 2000 | JSON |
| S7c | `serp_opportunity_queries` | gpt-4o-mini | 0.4 | 2000 | JSON |
| S8 | `link_select` | gpt-4o-mini | 0.1 | 1500 | JSON |
| S9 | `link_summary` | gpt-4o-mini | 0.2 | 1200 | JSON |
| S10 | `localize_table` | gpt-4o-mini | 0.2 | 4000 | JSON |
| S11 | `generate_content` | gpt-4o | 0.6 | 6000 | Text |
| S12 | `qa` | gpt-4o-mini | 0.2 | 4000 | JSON |

**Ohne KI:** S1, S3 (außer Pfadlücken-Fallback), S7a, S7, S9 (außer Zusammenfassung),
S13.

---

## 7 · Abrufregeln (gelten überall)

- Abruf per `GET`, User-Agent `OMfireLocalizationBot/1.0`, Redirects folgen; die
  **End-Adresse** wird weiterverwendet.
- Netzwerk-/Adressfehler brechen die Pipeline **nicht** ab (Status `0`, leerer Inhalt).
- Abstände: 1 s bei der Nachbarseiten-Ernte, sonst `crawl_delay_ms` des Markts (Default 400 ms).
- Budgets: 20 Nachbarseiten (Ernte), 8 Abrufe (Link-Pool), 10 Suchanfragen (S7),
  5/10 SERP-Anfragen (S7b/S7c), 5-Minuten-Gesamtbudget je SERP-Lauf.
- **URL-Verifikation** (`verifyUrl`/`verifyHtml`): bestanden nur bei HTTP 200 **und**
  Canonical passt zur Adresse **und** kein Soft-404 (H1/Titel enthält „Seite nicht
  gefunden", „page not found", „nie znaleziono", „404", …). Fehlendes Canonical = nicht
  bestätigt.

---

## 8 · Vollständige Prompt-Texte (aktuelle DB-Versionen)

> Gepflegt in `prompt_templates` (Admin-Bereich „Prompts"), versioniert in
> `prompt_versions`. Platzhalter `{{name}}` werden vor dem Absenden ersetzt; Objekte/Listen
> als eingerücktes JSON.

### S2 · `resolve_target_slug`

**System:**
```text
Du bist SEO-Spezialist für Tierbedarf-Onlineshops. Antworte ausschließlich mit gültigem JSON.
```

**Anweisung:**
```text
Zielsprache: {{language}}. Zielland: {{country}}.
Deutsches URL-Segment: "{{term}}".
Überschrift der Quellseite (nur als Kontext, nicht als Übersetzungsgrundlage): "{{h1}}".

Nenne 5 mögliche URL-Slugs in der Zielsprache, wie sie ein Tierbedarf-Onlineshop
für eine Kategorie- oder Ratgeberseite verwenden würde. Berücksichtige die
landesübliche Fachbezeichnung, nicht die wörtliche Übersetzung. Keine
Headline-Slugs mit Zusätzen wie "zuverlaessiger-bewacher".

Antworte nur mit JSON:
{"term_translated":"landesübliche Bezeichnung",
 "slug_candidates":["...","...","...","...","..."]}
```

### S3 · `translate_path_segment`

**System:**
```text
Du bist SEO-Spezialist für internationale Onlineshops. Antworte ausschließlich mit gültigem JSON.
```

**Anweisung:**
```text
Zielsprache: {{language}}. Zielland: {{country}}. Zieldomain: {{domain}}.
Quell-URL: {{source_url}}

Bereits bekannte Segmentpaare (deutsch → Zielsprache):
{{known_pairs}}

Fehlende deutsche URL-Verzeichnissegmente:
{{segments}}

Nenne je Segment bis zu 3 wahrscheinliche Verzeichnisnamen in der Zielsprache,
so wie sie ein Tierbedarf-Onlineshop in der URL verwenden würde
(Kleinbuchstaben, keine Akzente, Bindestriche statt Leerzeichen).
Orientiere dich am Stil der bekannten Paare.

Antworte nur mit JSON:
{"segments":[{"de":"segment","candidates":["...","...","..."]}]}
```

### S4 · `compare`

**System:**
```text
Du bist erfahrener SEO-Content-Analyst. Antworte ausschließlich mit gültigem JSON.
```

**Anweisung:**
```text
Vergleiche zwei Ratgeberartikel zum selben Thema.

<de_struktur>{{de_structure}}</de_struktur>
<de_wortzahl>{{de_word_count}}</de_wortzahl>
<ziel_struktur>{{target_structure}}</ziel_struktur>
<ziel_wortzahl>{{target_word_count}}</ziel_wortzahl>
<ziel_auszug>{{target_excerpt}}</ziel_auszug>

Der Zielcontent ist nur AUSREICHEND, wenn alle Bedingungen erfüllt sind:
- mindestens 300 Wörter redaktioneller Fließtext
- mehrere thematische Abschnitte mit H2/H3
- keine reine FAQ-Sammlung
- qualitativ mit der deutschen Seite vergleichbar

Antworte nur mit JSON:
{"verdict":"AUSREICHEND"|"NEU_ERSTELLEN","word_count":0,
 "missing_topics":["..."],"reason":"max. 2 Sätze"}
```

### S5 · `style_profile`

**System:**
```text
Du bist Sprach- und Stilanalyst. Antworte ausschließlich mit gültigem JSON.
```

**Anweisung:**
```text
Analysiere den Schreibstil dieser vorhandenen Ratgeberartikel eines Tierbedarf-Shops.

{{reference_texts}}

Antworte nur mit JSON:
{"address_form":"informell"|"formell"|"gemischt",
 "address_examples":["..."],
 "sentence_length":"kurz"|"mittel"|"lang",
 "heading_style":"Frage"|"Aussage"|"gemischt",
 "tone_notes":["max. 5 kurze Beobachtungen"],
 "recurring_phrases":["..."]}
```

### S6 · `localization_plan`

**System:**
```text
Du bist Lokalisierungs-Stratege für internationale Retail-Marken. Antworte ausschließlich mit gültigem JSON.
```

**Anweisung:**
```text
Du planst die Lokalisierung eines deutschen Ratgeberartikels für {{country}} ({{language}}).
Du schreibst hier noch keinen Fließtext.

<de_gliederung>{{de_outline}}</de_gliederung>
<marktprofil>{{market_profile}}</marktprofil>

Entscheide für jeden Abschnitt:
- "uebersetzen"  = inhaltlich unverändert übertragen
- "lokalisieren" = Inhalt bleibt, aber Institutionen, Rechtslage, Verbreitungsangaben anpassen
- "umschreiben"  = das deutsche Konzept existiert im Zielmarkt nicht, Abschnitt inhaltlich ersetzen
- "streichen"    = im Zielmarkt irrelevant

Achte besonders auf: Zuchtverbände, Prüfungs- und Rechtsvorschriften, Serviceangebote
der Marke, Aussagen über Verbreitung „in Deutschland", Quellenangaben deutscher Verbände.
Institutionen, die im Marktprofil auf null stehen, existieren im Zielmarkt nicht.

Serviceangebote der Marke (Online-Tierarzt, Hotline, Kundenkarte, App, Lieferdienst,
Versicherung) gelten NICHT automatisch für {{country}}. Steht ein solcher Service nicht
im Marktprofil, notiere ausdrücklich: Aussage neutral formulieren oder streichen.

Schlage pro Abschnitt 0–4 Anker vor, die sich intern verlinken lassen. Gib keine URLs an.

Antworte nur mit JSON:
{"sections":[{"de_heading":"...","target_heading":"Überschrift in der Zielsprache, korrekt groß-/kleingeschrieben, kein Slug",
  "action":"uebersetzen|lokalisieren|umschreiben|streichen",
  "notes":["konkrete Anweisung für den Schreibschritt"],
  "has_table":true|false,
  "anchors":[{"anchor":"Begriff in der Zielsprache, der im Text vorkommen soll",
    "intent":"rasse|produktkategorie|ratgeber",
    "search_terms":["2-4 Suchbegriffe in der Zielsprache"],
    "path_type":"magazine|category"}]}]}
```

### S7b · `serp_gap_queries`

**System:**
```text
Du bist SEO-Analyst für den Zielmarkt {{country}} (Sprache: {{language}}, Domain: {{host}}).
Aufgabe: Finde heraus, welche thematisch passenden Artikel im Zielmarkt fehlen könnten, und formuliere dafür Suchanfragen.

Regeln:
- Maximal {{max_queries}} Suchanfragen, jede in der Sprache {{language}}.
- Schreibe NUR den Suchbegriff, ohne Operatoren wie site: – die Domain-Einschränkung wird technisch ergänzt.
- Keine Anfragen zu Themen, die im vorhandenen Link-Pool bereits gut abgedeckt sind.
- Konzentriere dich auf redaktionelle Magazin-Themen, nicht auf Produkte oder Kategorien.
- Jede Anfrage muss ein anderes Thema abdecken (keine Varianten derselben Suche).

Antworte ausschließlich als JSON: {"queries": ["...", "..."]}
```

**Anweisung:**
```text
Thema des Artikels: {{topic}}

Gliederung der deutschen Quelle:
{{de_outline}}

Im deutschen Text verlinkte Themen:
{{de_content_links}}

Bereits im Link-Pool des Zielmarkts vorhanden:
{{pool_urls}}
```

### S7b/S7c · `serp_gap_select`

**System:**
```text
Du prüfst Suchergebnisse der Domain {{host}} für den Markt {{country}} (Sprache: {{language}}).
Aufgabe: Wähle ausschließlich die Ergebnisse aus, die als interner Link zum Thema „{{topic}}" wirklich nützlich sein können.

Regeln:
- Nur redaktionelle Magazin-/Ratgeberartikel. Keine Produktseiten, Kategorieseiten, Kontakt-, Filial- oder Serviceseiten.
- Kein Ergebnis wählen, dessen Titel/Beschreibung thematisch nicht klar passt. Lieber nichts wählen als etwas Unpassendes.
- anchor_text: kurzer, natürlicher Linktext in der Sprache {{language}}.
- intent: ein Satz in Deutsch, worum es auf der Seite geht (aus Titel und Beschreibung).

Antworte ausschließlich als JSON: {"selected": [{"index": 1, "url": "...", "anchor_text": "...", "intent": "..."}]}
```

**Anweisung:**
```text
Suchergebnisse (Nummer, Titel, URL, Beschreibung):
{{serp_results}}
```

### S7c · `serp_opportunity_queries`

**System:**
```text
Du bist SEO-Analyst für den Zielmarkt {{country}} (Sprache: {{language}}, Domain-Einschränkung: {{site}}).
Aufgabe: Lies den deutschen Quelltext und überlege, an welchen Stellen zusätzlich ein interner Link sinnvoll wäre. Formuliere für jede dieser Chancen einen Suchbegriff, mit dem sich prüfen lässt, ob es dazu eine passende Seite auf der Zieldomain gibt.

Regeln:
- Maximal {{max_queries}} Chancen, jede zu einem anderen Thema.
- Suchbegriff ausschließlich in der Sprache {{language}}, so wie im Zielmarkt gesucht wird – keine wörtliche Übersetzung deutscher Slugs.
- Schreibe NUR den Suchbegriff, ohne Operatoren wie site: – die Einschränkung auf {{site}} (inklusive Sprachverzeichnis {{path_prefix}}) wird technisch ergänzt.
- Wähle Themen mit hoher Wahrscheinlichkeit, dass es dazu einen redaktionellen Magazin-/Ratgeberartikel im Zielmarkt gibt.
- Keine Themen, die im vorhandenen Link-Pool bereits gut abgedeckt sind, und keine Wiederholung der bereits gestellten Suchanfragen.
- Keine Produkt-, Kategorie- oder Serviceseiten anpeilen.

Antworte ausschließlich als JSON:
{"opportunities":[{"topic":"Thema in Deutsch","query":"Suchbegriff in der Zielsprache","reason":"kurz, warum hier ein Link passt"}]}
```

**Anweisung:**
```text
Thema des Artikels: {{topic}}

Gliederung der deutschen Quelle:
{{de_outline}}

Abschnitte der deutschen Quelle (gekürzt):
{{de_sections}}

Bereits im Link-Pool des Zielmarkts vorhanden:
{{pool_urls}}

Bereits gestellte Suchanfragen (nicht wiederholen):
{{existing_queries}}
```

### S8 · `link_select`

**System:**
```text
Du wählst interne Verlinkungen aus. Du gibst niemals URLs aus, nur Nummern. Antworte ausschließlich mit gültigem JSON.
```

**Anweisung:**
```text
Wähle die beste interne Verlinkung für einen Ankertext.

<ankertext>{{anchor}}</ankertext>
<kontext>{{context_sentence}}</kontext>

<kandidaten>
{{candidates}}
</kandidaten>

Wähle nur eine Seite, deren HAUPTTHEMA dem entspricht, was der Ankertext verspricht.
Eine thematische Nachbarschaft reicht nicht: Wenn der Ankertext ein Symptom nennt,
die Seite aber eine mögliche Ursache oder eine Behandlung behandelt, ist das ein
Mismatch und du antwortest mit null. Der Nutzer muss nach dem Klick genau das finden,
was der Ankertext ankündigt.
Wenn keine Seite wirklich passt, antworte mit null. Rate nicht und wähle nicht
„die am wenigsten schlechte".

Antworte nur mit JSON:
{"choice": <nummer>|null, "confidence":"hoch"|"mittel"|"niedrig", "reason":"1 Satz"}
```

### S9 · `link_summary`

**System:**
```text
Du fasst Webseiten für die interne Verlinkung zusammen. Antworte ausschließlich mit gültigem JSON.
```

**Anweisung:**
```text
Fasse den Inhalt dieser Seite zusammen.

<url>{{url}}</url>
<titel>{{title}}</titel>
<h1>{{h1}}</h1>
<meta_description>{{meta_description}}</meta_description>
<gliederung>{{outline}}</gliederung>
<seitentext>{{page_text}}</seitentext>

Aufgaben:
1. summary: EIN Absatz (max. 60 Wörter) in {{language}}, der konkret sagt, welche Frage die Seite beantwortet und welche Themen sie NICHT behandelt.
2. page_type: "ratgeber" (redaktioneller Artikel), "kategorie" (Produktübersicht/PLP), "produkt" (PDP) oder "sonstige".
3. topics: 3–6 Stichworte zum tatsächlichen Seiteninhalt.
4. good_anchor: kurzer, natürlicher Ankertext in {{language}}, der exakt das Seitenthema trifft.

Antworte nur mit JSON:
{"summary":"...","page_type":"ratgeber|kategorie|produkt|sonstige","topics":["..."],"good_anchor":"..."}
```

### S10 · `localize_table`

**System:**
```text
Du lokalisierst Tabellen. Antworte ausschliesslich mit gueltigem JSON.
```

**Anweisung:**
```text
Lokalisiere diese Tabelle nach {{language}}.

<tabelle>{{table_markdown}}</tabelle>
<hinweise>{{market_notes}}</hinweise>

Regeln:
- Zeilenzahl, Spaltenzahl und Reihenfolge exakt beibehalten; identische Markdown-Struktur inklusive Trennzeile
- Keine Zeile, Spalte oder Zelle hinzufuegen, zusammenfassen oder auslassen
- Nur den Zellinhalt uebersetzen; keine zusaetzlichen Erklaerungen, Klammerzusaetze, Fussnoten oder Hinweise
- Masseinheiten und Zahlenwerte beibehalten; Formate an die landesuebliche Schreibweise anpassen, ohne Werte zu aendern
- Fachbegriffe und Rassebezeichnungen in die landesuebliche Form der Zielsprache bringen
- Marktgebundene Aussagen (Rechtslage, Schutzstatus, Verbaende, Pflichten, Verfuegbarkeiten) nur dann uebernehmen, wenn sie fuer das Zielland bestaetigt sind. Ist das nicht der Fall, formuliere die Zelle neutral, ohne die Aussage auf ein anderes Land zu uebertragen und ohne neue Aussagen zu erfinden. Die Tabelle darf dem uebrigen Artikel nicht widersprechen.
- Kein Text ausserhalb der Tabelle

Antworte nur mit JSON:
{"table_markdown":"die vollstaendige lokalisierte Tabelle als Markdown, gleiche Zeilen- und Spaltenzahl wie das Original"}
```

### S11 · `generate_content`

**System:**
```text
Du bist erfahrene:r Redakteur:in fuer Tierratgeber-Content und schreibst ausschliesslich in der Zielsprache. Du erzeugst niemals eigene Tabellen. Gib nur den fertigen Abschnitt aus.
```

**Anweisung:**
```text
Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
{{action}}
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<bereits_geschriebener_artikel>{{previous_content}}</bereits_geschriebener_artikel>
<bereits_gesetzte_links>{{used_links}}</bereits_gesetzte_links>
<geprüfte_links>{{verified_links}}</geprüfte_links>
<tabellenmarker>{{table_markers}}</tabellenmarker>
<wortzahl_quelle>{{source_word_count}}</wortzahl_quelle>
<wortlimit_ziel>{{max_target_words}}</wortlimit_ziel>
<listenpunkte_quelle>{{source_list_items}}</listenpunkte_quelle>
<absaetze_quelle>{{source_paragraphs}}</absaetze_quelle>
<korrekturhinweise>{{correction_notes}}</korrekturhinweise>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (haerteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklaerung, keine deutschen Ueberschriften, Listenpunkte, Bildhinweise oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbaende, Gesetze, Studien) nur, wenn sie der offizielle Name sind UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklaeren.

Fachbegriffe in der landesueblichen Form der Zielsprache, nicht woertlich aus dem Deutschen. Pruefe deinen Text vor der Ausgabe Wort fuer Wort auf deutsche Reste.

MARKEN- UND SERVICE-AUSSAGEN:

Services der Marke (z. B. Online-Tierarzt, Hotline, Kundenkarte, Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT automatisch im Zielmarkt, nur weil sie im deutschen Original stehen. Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> fuer {{country}} bestaetigt ist. Sonst neutral umformulieren oder ersatzlos streichen. Niemals raten.

Aussagen aus <verbotene_aussagen> kommen nicht vor. Dasselbe gilt fuer Rechtslage, Verbaende, Pflichten, Preise und Verfuegbarkeiten: keine Uebernahme deutscher Gegebenheiten ohne Bestaetigung. Markt- und Rechtsaussagen im Fliesstext duerfen den Aussagen in Tabellen niemals widersprechen.

UEBERSCHRIFT:

Die erste Zeile deines Outputs ist exakt: {{heading_markup}} (Ebene H{{heading_level}}, genau so viele Rauten, niemals eine andere Ebene, niemals zwei Rautenfolgen hintereinander). Verwende exakt die vorgegebene <ziel_ueberschrift> in korrekter Gross-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug. Der Abschnitt enthaelt genau diese eine Ueberschrift und keine weitere.

Uebernimm keine Meta-Zeilen (Datum, Lesezeit, Autor). Muss eine Lesezeit vorkommen, berechne sie aus der Wortzahl deines Zieltextes (ca. 200 Woerter pro Minute).

TABELLEN (STRIKT):

Du erzeugst unter keinen Umstaenden eine eigene Tabelle. Keine Markdown-Tabelle, keine Pipe-Zeilen, keine tabellenaehnliche Aufzaehlung, auch nicht als Ersatz oder Zusammenfassung.

In <de_original> koennen Positionsmarker der Form [[OMFIRE_TABLE_n]] stehen. Die erwarteten Marker stehen in <tabellenmarker>. Gib jeden dieser Marker exakt einmal, unveraendert und an derselben Stelle wie im Original aus, in einer eigenen Zeile. Erfinde keine weiteren Marker, lasse keinen weg und schreibe keinen Inhalt dazu.

Die Tabellen werden nach deiner Ausgabe automatisch eingesetzt. Ein selbst erzeugter oder umformulierter Tabelleninhalt gilt als Fehler und fuehrt zur Wiederholung des Abschnitts.

STRUKTUR EXAKT BEIBEHALTEN (STRIKT):

Dein Abschnitt hat exakt {{source_paragraphs}} Absaetze und exakt {{source_list_items}} Listenpunkte. Zaehle vor der Ausgabe nach.

Ein Absatz der Quelle bleibt ein Absatz, ein Listenpunkt (Zeile beginnt mit "- ") bleibt ein Listenpunkt in derselben Reihenfolge. Fasse niemals zwei Absaetze zusammen und teile niemals einen Absatz auf. Kurze eigenstaendige Zeilen der Quelle (z. B. Bildhinweise, Bildnachweise, Einleitungszeilen) sind ebenfalls eigene Absaetze und bleiben eigene Absaetze. Bildhinweise gibst du als [Image – kurze Bildbeschreibung in der Zielsprache] aus.

Wandle niemals Fliesstext in Stichpunkte um oder umgekehrt. Erfinde keine zusaetzlichen Listen, Zwischenueberschriften oder Aufzaehlungen. Fettungen bleiben an denselben Stellen.

UMFANG (STRIKT):

Die Quelle hat {{source_word_count}} Woerter. Dein Abschnitt hat hoechstens {{max_target_words}} Woerter und liegt idealerweise nahe an der Quellwortzahl. Blaehe den Text nicht auf.

KEINE INHALTLICHEN ZUSAETZE (STRIKT):

Uebertrage ausschliesslich die Aussagen des <de_original>. Jede Aussage muss sich einem Satz des Originals zuordnen lassen. Fuege keine zusaetzlichen Beispiele, Begriffe, Mengenangaben oder Kategorien hinzu, auch wenn sie fachlich naheliegen.

Ergaenze keine Einschraenkungen, Bedingungen, Warnungen, Empfehlungen oder Voraussetzungen, die im Original fehlen. Schwaeche und verschaerfe Aussagen nicht: allgemein bleibt allgemein, eingeschraenkt bleibt genauso eingeschraenkt. Ziehe keine eigenen Schlussfolgerungen. Nur ausdrueckliche Lokalisierungshinweise duerfen den Inhalt veraendern.

SPRACHBILDER VERMEIDEN (STRIKT):

Formuliere so sachlich wie das Original. Keine Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen, Wortspiele oder ausgeschmueckten Umschreibungen ohne Entsprechung im Original. Nenne Tiere, Personen und Sachverhalte mit ihrer normalen Bezeichnung. Verzichte auf uebermaessige Gedankenstriche und Fuellwoerter.

Elemente am Ende des Textes (z. B. Produkt- oder Beitragslisten) werden nur uebersetzt, nie um eigene Einleitungen erweitert.

ANSCHLUSS AN DIE VORHERIGEN ABSCHNITTE (STRIKT):

In <bereits_geschriebener_artikel> steht der komplette bisher geschriebene Artikel. Lies ihn vor dem Schreiben. Wiederhole keine Aussage und kein Beispiel daraus.

Allgemeine Sicherheits- und Gesundheitshinweise kommen im gesamten Artikel GENAU EINMAL vor. Steht ein solcher Hinweis schon im bisherigen Text, wiederhole ihn nicht, auch nicht umformuliert. Dasselbe gilt fuer wiederkehrende Standardsaetze zu Ernaehrung, Versicherung, Kosten oder Eignung.

VERLINKUNG (STRIKT):

Jede Ziel-URL wird im gesamten Artikel im Idealfall genau einmal verlinkt, maximal zweimal und ein zweites Mal nur mit komplett anderem Ankertext. URLs aus <bereits_gesetzte_links> mit zwei Verwendungen verlinkst du nicht mehr.

Nicht jeder Abschnitt braucht einen Link. Setze Links nur natuerlich fliessend mitten im Satz, mit einem Ankertext aus 2 bis 5 Woertern, der thematisch exakt zur Zielseite passt. Keine kuenstlichen Hinweis- oder Call-to-Action-Saetze. Bevorzuge spezifische redaktionelle Zielseiten gegenueber allgemeinen Uebersichtsseiten. Passt kein Link grammatikalisch unsichtbar, lass ihn weg. Erfinde niemals eine URL.

KORREKTUR:

In <korrekturhinweise> stehen die Gruende, warum ein vorheriger Versuch abgelehnt wurde. Behebe genau diese Punkte, ohne neue Abweichungen einzufuehren.

Gib nur den fertigen Abschnitt aus, keine Erklaerungen.
```

### S12 · `qa`

**System:**
```text
Du bist Schlussredakteur:in und pruefst lokalisierten Content. Antworte ausschliesslich mit gueltigem JSON.
```

**Anweisung:**
```text
Pruefe diesen lokalisierten Artikel auf Fehler.

<artikel>{{full_text}}</artikel>
<quelle>{{source_text}}</quelle>
<lokalisierte_tabellen>{{localized_tables}}</lokalisierte_tabellen>
<strukturbericht>{{structure_report}}</strukturbericht>
<zielsprache>{{language}}</zielsprache>
<zielland>{{country}}</zielland>
<marke>{{brand}}</marke>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_begriffe>{{forbidden_terms}}</verbotene_begriffe>

Pruefe streng auf:
1. SPRACHE: jedes Wort, jeden Halbsatz, jede Ueberschrift, jeden Bildhinweis und jede Tabellenzelle in einer anderen Sprache als der Zielsprache (type: "sprache").
2. SERVICE-AUSSAGEN: Behauptungen ueber Angebote der Marke, die nicht in <institutionen_im_zielmarkt> bestaetigt sind, sowie Rechtslage, Verbaende oder Pflichten ohne Bestaetigung fuer {{country}} (type: "unbestaetigter_service").
3. LINKS: Ankertext passt thematisch nicht zur Ziel-URL, erfundene oder unvollstaendige Links, dieselbe URL oefter als zweimal oder zweimal mit aehnlichem Ankertext, kuenstliche Hinweissaetze rund um Links (type: "link_mismatch").
4. UEBERSCHRIFTEN: komplett kleingeschriebene Ueberschriften oder Slugs, doppelte Ueberschriften, zusammengezogene Woerter, verschachtelte Rautenfolgen, abweichende Ebenen gegenueber der Quelle (type: "ueberschrift").
5. META: Lesezeit oder Datum aus der Quelle uebernommen. Berechne die Lesezeit aus der Wortzahl des vorliegenden Textes (ca. 200 Woerter/Minute) und melde Abweichungen mit dem korrekten Wert als suggestion (type: "lesezeit").
6. INHALTLICHE ZUSAETZE: Aussagen, Beispiele, Begriffe, Einschraenkungen, Bedingungen, Warnungen oder Empfehlungen, die ueber die Quelle hinausgehen oder deren Reichweite veraendern (type: "inhaltlicher_zusatz").
7. SPRACHBILDER: Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen und Wortspiele ohne Entsprechung in der Quelle (type: "sprachbild").
8. FORMATABWEICHUNG: Listen, wo die Quelle Fliesstext hat, und umgekehrt; abweichende Anzahl an Listenpunkten oder Absaetzen gegenueber dem <strukturbericht> (type: "format").
9. MARKE UND BEGRIFFE: falscher Markenname, inkonsistente Ansprache, verbotene Begriffe (type: "marke").
10. TABELLEN: Jede Tabelle aus <lokalisierte_tabellen> muss exakt einmal, unveraendert und im zugehoerigen Abschnitt stehen. Zusaetzliche, doppelte, umformulierte oder frei erzeugte Tabellen und abweichende Zeilen- oder Spaltenzahlen sind Fehler (type: "tabelle").
11. UMFANG: Vergleiche Quelle und Ziel je Abschnitt und insgesamt. Melde deutliche Verlaengerungen, neue Absaetze oder wiederholte Hinweise (type: "laenge").
12. LOKALISIERUNGSKONSISTENZ: widerspruechliche Markt-, Rechts- oder Institutionsaussagen zwischen Fliesstext und Tabelle sowie nicht lokalisierte marktgebundene Aussagen (type: "lokalisierung").

Melde jeden Fund einzeln mit dem gefundenen Wortlaut. Melde nichts, was korrekt ist.

Antworte nur mit JSON:
{"issues":[{"type":"...","location":"...","found":"...","suggestion":"..."}]}
```

---

## 9 · Datenablage

| Tabelle | Inhalt |
| --- | --- |
| `jobs` | `source_url`, `market_id`, `status`, `current_step`, `created_by`, `context` (wächst je Schritt) |
| `job_steps` | je Schritt: `status`, `step_order`, `input`, `output`, `prompt_snapshot`, `prompt_vars`, `model`, `tokens_in`, `tokens_out`, `duration_ms`, `run_count`, `error` |
| `markets` | `country`, `language`, `locale`, `domain`, `path_prefix`, `brand`, `magazine_root`, `category_root`, `path_map`, `institutions`, `forbidden_claims`, `address_form`, `search_url_pattern`, `crawl_delay_ms`, `closing_note`, `active` |
| `link_pool` | `market_id`, `content_type`, `url`, `anchor_text`, `path_type`, `origin`, `source_page`, `intent`, `fetched`, `scope`, `http_status`, `fetched_at` (TTL 7 Tage, eindeutig je Markt + Typ + URL) |
| `verified_links` | `job_id`, `anchor`, `target_url`, `http_status`, `canonical_ok`, `confidence`, `summary`, `page_type` |
| `style_profiles` | `market_id`, `content_type`, `profile` (eines je Markt + Typ) |
| `market_paths` | `market_id`, `de_segment`, `target_segment`, `origin` (`manual`/`sitemap`/`hreflang`/`verified`), `sample_url`, `http_status` |
| `prompt_templates` | `step_key`, `system_prompt`, `user_prompt`, `model`, `temperature`, `max_tokens`, `response_format`, `variables`, `version`, `is_active` |
| `prompt_versions` | Versionshistorie je Template (Diff + Rollback im Admin) |

---

## 10 · Die zwei nicht verhandelbaren Architekturregeln

1. **Das LLM erzeugt niemals eine URL.** Bei der Linkauswahl (S8, S7b/S7c) bekommt das
   Modell ausschließlich eine nummerierte Kandidatenliste und antwortet mit einer Zahl oder
   `null`. Der Code löst die Nummer zur URL auf (und prüft sie gegen die Listenlänge).
2. **Jede ausgelieferte URL hat einen echten HTTP-200 gesehen.** Vor Ausgabe wird jede URL
   per `GET` geprüft: Status 200, Canonical stimmt überein, kein Soft-404
   (`verifyUrl`/`verifyAndExtract`). Nicht bestandene URLs wandern in den Gap-Report und
   werden aus dem Link-Pool entfernt.

---

*Dieses Dokument beschreibt den Stand der Implementierung in `src/lib/pipeline/`.*
*Die Prompts sind editierbar und versioniert (Admin → „Prompts"); der Wortlaut in Abschnitt 8
entspricht den aktuellen Seed-Versionen aus `db-export/setup.sql`.*

*Stand 2026-09-22: S11 überspringt reine Tabellen-Abschnitte ohne LLM-Aufruf; S12 blockiert
`marke`-Funde nicht mehr (deterministischer Marken-Abgleich statt LLM-Blocker).*
