# Content-Index – Sitemap-Daten (Speicherung & Analyse)

Ziel: Schritt 6 (semantische interne Verlinkung) braucht einen Ziel-Index eigener
Ratgeberseiten. Dieser Index wird **außerhalb** der Job-Pipeline aufgebaut – lokal per
`scripts/content-index.mjs` (Node), damit das Vercel-Zeitlimit nicht greift. Verbindung **nur**
gegen die Dev-DB (gleicher Guard wie `scripts/dev-db.mjs`).

## 1 · Speicherung (`public.content_pages`, Migration `0013_content_pages.sql`)

| Spalte | Typ | Bedeutung |
| --- | --- | --- |
| `id` | `bigint` identity | Primärschlüssel |
| `url` | `text` not null **unique** | Kanonische Ziel-URL (Upsert-Schlüssel) |
| `market_id` | `uuid` FK → `markets` | Marktzuordnung (`on delete cascade`) |
| `country` | `text` | Ländercode, aus `markets.locale` (`fr-CH` → `ch`) |
| `language` | `text` | Sprachcode, aus `markets.locale` (`fr-CH` → `fr`) |
| `content_type` | `text` default `'ratgeber'` | `'ratgeber'` \| `'hub'` |
| `title` / `h1` / `meta_description` | `text` | Metadaten der Zielseite |
| `content_payload` | `text` | H1 + Meta + Überschriften (`## …`) + Fließtext |
| `content_hash` | `text` | `sha256(payload)` – Re-Embedding nur bei Änderung |
| `embedding` | `halfvec(1536)` not null | `text-embedding-3-small` |
| `embedding_model` | `text` | Modellname des Embeddings |
| `sitemap_lastmod` | `date` | `lastmod` der Sitemap (Inkrementell-Schlüssel) |
| `http_status` | `int` | HTTP-Status beim Crawlen |
| `is_active` | `boolean` default true | `false`, wenn URL aus der Sitemap verschwunden ist |
| `last_crawled_at` | `timestamptz` | Zeitpunkt des letzten Crawls |

**Indexe**

- `content_pages_filter_idx` – `(country, language, content_type) WHERE is_active` (B-Tree-Filter vor dem Vektorscan).
- `content_pages_embedding_hnsw` – `USING hnsw (embedding halfvec_cosine_ops)`.

**Zugriff**

- RLS aktiv, **keine Policies** – nur `service_role` (über `supabaseAdmin`).
- RPC `public.match_content_pages(query_embedding halfvec, p_country text, p_language text, p_match_count int = 20, p_content_types text[] = '{ratgeber}', p_exclude_urls text[] = '{}')` → `(url, title, content_payload, similarity)`.
  - Filter: `is_active` + `country` + `language` + `content_type = any(...)` + `url <> all(exclude)`.
  - `similarity = 1 - (embedding <=> query_embedding)` (Cosinus).
  - Funktions-Optionen: `hnsw.ef_search = 100`, `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8; per DO-Block versioniert gesetzt).
  - `execute` nur für `service_role`, entzogen für `anon`/`authenticated`.

## 2 · Analyse (Crawl-Ablauf je Markt)

1. **Markt laden** – `locale`, `domain`, `path_prefix`, `magazine_root`, `crawl_delay_ms` aus `markets` (aktiv).
2. **Sitemap entdecken** – `robots.txt` → `Sitemap:`-Zeilen; Fallback `https://{domain}/sitemap.xml`. Ist die Antwort ein `<sitemapindex>`, werden die Kind-Sitemaps aufgelöst.
3. **Content-Sitemap wählen** – bevorzugt `sitemap-content-{lang}.xml` (z. B. `sitemap-content-de.xml`); sonst alle Sitemaps.
4. **URL-Filter (`filterContentUrl`)** – harte Filter:
   - Pfad muss unter `magazine_root` liegen (normalisiert, inkl. Sprachpräfix).
   - Pfadsegmente aus der Ausschlussliste werden verworfen: `product|category|cart|checkout|search|promotion|newsletter|store|shop` (+ deutsche/polnische Varianten `produkt`, `kategorie`, `warenkorb`, `suche`, `aktion`, …).
5. **Inkrementell** – bestehende Zeilen (`url`, `sitemap_lastmod`, `content_hash`) laden; URL überspringen, wenn `sitemap_lastmod` (nur Datumsteil) unverändert ist und kein `--force`. (`sitemap_lastmod::text` abfragen, weil postgres.js `date` als `Date`-Objekt liefert.)
6. **Scraping** – Concurrency 3, **Pause je Request = `crawl_delay_ms`** (alle Märkte: 800 ms), User-Agent `OMfireLocalizationBot/1.0`, 20 s Timeout. Extrahiert werden H1, Meta-Description sowie `h2`/`h3`-Überschriften und `p`/`li`-Fließtext aus `main`/`article`/`body`; `nav`/`header`/`footer`/`aside`/`script`/`style`/`form` werden entfernt.
7. **Klassifikation (`classifyContentType`)** – `hub` bei Kategorie-Übersicht (Pfadtiefe ≤ `magazine_root`+1 **oder** < 250 Wörter), sonst `ratgeber`.
8. **Payload (`buildPayload`)** – `H1` + Meta + Überschriften (`## …`, `### …`) + Fließtext, durch Leerzeilen getrennt.
9. **Hash (`hashPayload`)** – `sha256(payload)`; nur bei geändertem Hash wird neu eingebettet.
10. **Embedding** – `text-embedding-3-small`; Input auf 24.000 Zeichen gekürzt (~6k Tokens, unter dem 8k-Input-Limit), Batch à 40 (unter dem 300k-Token-Limit je Request), 3 Retries.
11. **Upsert** – `ON CONFLICT (url) DO UPDATE`:
    - mit Embedding: volle Aktualisierung inkl. `embedding`/`embedding_model`;
    - ohne Embedding (Hash unverändert): nur Metadaten + Zeitstempel, Embedding bleibt;
    - neue URL ohne Embedding (Batch fehlgeschlagen): **überspringen** (zählt als Fehler), nächster Lauf holt sie nach.
12. **Deaktivierung** – URLs des Markts, die nicht mehr in der Sitemap stehen, werden `is_active = false`.
13. **Report** – je Markt `total/crawled/neu/aktualisiert/unverändert/Fehler` + Tabellengröße (`pg_total_relation_size`).

## 3 · Kommandos

```bash
node scripts/content-index.mjs crawl [--market fr-CH] [--limit N] [--force]
node scripts/content-index.mjs status
```

Reine, testbare Helfer liegen in `scripts/content-index-lib.mjs` (Filter, Klassifikation,
Payload-Aufbau, Sitemap-XML-Parsing, Hash) und werden von `tests/content-index.test.ts` abgedeckt.

## 4 · Stand & Datenkorrektur

- **8 Märkte indexiert, 5.410 Seiten, 66,4 MB** (Stand Erstaufbau):
  `de-AT` 1156 · `de-CH` 1253 · `en-IE` 329 · `fr-BE` 478 · `fr-CH` 542 · `fr-FR` 568 · `nl-BE` 440 · `pl-PL` 644.
- **`de-CH` korrigiert:** `magazine_root` war `'/magazin/'` (falsch), tatsächlicher Inhalt liegt unter
  `'/de/magazin/'` (laut Sitemap). Auf `'/de/magazin/'` gesetzt – der neue Snapshot übernimmt den Wert.

## 5 · Verbrauch & Betrieb

- Der Crawler läuft **manuell/lokal** (kein Zeitplan). Wiederholungsläufe sind inkrementell
  (nur geänderte/neue URLs werden erneut gecrawlt; unveränderte Seiten werden per `lastmod` übersprungen).
- `--force` erzwingt einen Komplett-Neucrawl. `--limit N` begrenzt (Probelauf).
