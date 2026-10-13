# Content Compass

> **Aktueller Stand (Oktober 2026):** Die Pipeline wurde auf **4 Schritte** vereinfacht
> (`extract` → `scan` → `localize` → `review`). Aus einer deutschen URL entsteht ein
> strukturtreues Markdown-Dokument für den Zielmarkt. Interne Verlinkung, Zielseiten-Erkennung,
> SERP-Analyse (DataForSEO), Websuche (Firecrawl) und Stilprofil sind entfallen; dafür werden
> keine Zugangsdaten mehr benötigt – nur `OPENAI_API_KEY` (optional `OPENAI_BASE_URL`).
> Beschreibung: [`docs/pipeline/pipeline.md`](docs/pipeline/pipeline.md), Prompts:
> [`docs/pipeline/prompts.md`](docs/pipeline/prompts.md). Tests: `bun test`.
>
> Der folgende Build-Prompt ist die ursprüngliche Spezifikation und nur noch historisch;
> die Abschnitte zu Links, Zielstatus, Stilprofil und SERP gelten nicht mehr.

Build-Prompt: Fressnapf Content-Lokalisierungs-Tool

Setze das folgende Projekt im Design des Omfire Budget Buddy um, inkl. Logo.

Erstelle einen Login-Bereich, wo mindestens eine User-Rolle mit Admin existiert. (Erstmal nur den Admin, potentiell kommt später der Viewer dazu etc.)

1. Was gebaut wird

Ein internes Web-Tool für das Fressnapf-/Maxi-Zoo-SEO-Team. Es nimmt eine deutsche Ratgeber- oder Kategorie-URL entgegen, vergleicht sie mit der entsprechenden Seite im Zielmarkt und erzeugt bei Bedarf einen vollständig lokalisierten Content in der Zielsprache — inklusive geprüfter interner Verlinkungen.

Das Tool arbeitet die Aufgabe in einzeln sichtbaren Schritten ab. Jeder Schritt hat einen eigenen, im Admin-Bereich editierbaren Prompt. Der letzte Schritt erzeugt aus allen zuvor gesammelten Informationen den fertigen Content.

Alle Schritte laufen über API-Calls. Es gibt keinen interaktiven Agenten, keine Browser-Automatisierung und keine manuellen Zwischeneingriffe im Standardablauf.

2. Zwei nicht verhandelbare Architekturregeln

Diese beiden Regeln bestimmen den gesamten Aufbau. Bitte nicht wegoptimieren.

Regel 1 — Das LLM erzeugt niemals eine URL. Bei der Linkauswahl bekommt das Modell ausschließlich eine nummerierte Kandidatenliste und antwortet mit einer Zahl. Der Code löst die Nummer zur URL auf. Ein Modell, das URLs frei generieren darf, produziert plausible, aber nicht existierende Pfade.

Regel 2 — Jede ausgelieferte URL hat einen echten HTTP-200 gesehen. „Steht in der Navigation" ist kein Beleg. Das Rasse-Verzeichnis auf maxizoo.pl enthält nachweislich tote Slugs (/magazyn/psy/rasy/bolonczyk/, /magazyn/pies/rasa/maltipoo/, /magazyn/pies/ras/seter-irlandzki-mahoniowy/). Vor Ausgabe wird jede URL per GET geprüft: Status 200, Canonical stimmt überein, kein Soft-404.

3. Login & Rollen

E-Mail/Passwort-Login, keine öffentliche Registrierung. Admin legt Nutzer an.

Rollentabelle mit admin als einziger initialer Rolle, aber erweiterbar angelegt (viewer, editor später ergänzbar).

Rollen in einer separaten Tabelle speichern, nicht als Spalte auf dem User-Profil, damit weitere Rollen ohne Migration ergänzt werden können.

Zugriffsschutz serverseitig, nicht nur im UI.

Nur admin darf den Admin-Bereich und die Prompt-Verwaltung sehen.

4. Einstieg für den Nutzer

Startseite = Formular mit genau drei Eingaben:

Deutsche Fressnapf-URL (Pflichtfeld, Validierung auf fressnapf.de)

Zielland (Dropdown)

Zielsprache (Dropdown, gefiltert nach gewähltem Land)

Land und Sprache kommen aus der Markttabelle. Bei Ländern mit nur einer Sprache wird diese vorausgewählt.

Land Sprache Domain Pfad-Präfix Marke Sprachvariante Belgien Französisch maxizoo.be /fr/ Maxi Zoo Belgisches Französisch, formeller Stil Belgien Niederländisch maxizoo.be /nl/ Maxi Zoo Belgisches Niederländisch (Vlaams) Österreich Deutsch fressnapf.at / Fressnapf Österreichisches Deutsch Niederlande Niederländisch fressnapf.nl / Fressnapf Standardniederländisch Schweiz Deutsch fressnapf.ch / Fressnapf Schweizer Hochdeutsch, kein „ß" Schweiz Französisch fressnapf.ch /fr/ Fressnapf Schweizer Französisch Frankreich Französisch maxizoo.fr / Maxi Zoo Standard-Französisch Polen Polnisch maxizoo.pl / Maxi Zoo Standardpolnisch Irland Englisch maxizoo.ie / Maxi Zoo Irisches Englisch Ungarn Ungarisch fressnapf.hu / Fressnapf Standardungarisch Rumänien Rumänisch fressnapf.ro / Fressnapf Standardrumänisch Kroatien Kroatisch fressnapf.hr / Fressnapf Standardkroatisch Slowakei Slowakisch fressnapf.sk / Fressnapf Standardslowakisch Tschechien Tschechisch fressnapf.cz / Fressnapf Standardtschechisch

Nach „Job starten" öffnet sich die Job-Ansicht: eine vertikale Schrittliste, die live befüllt wird. Pro Schritt sichtbar: Status, Dauer, Input, Output, verwendeter Prompt. Jeder Schritt einzeln neu ausführbar, ohne den ganzen Job zu wiederholen.

5. Datenmodell

users                 id, email, created_at
user_roles            id, user_id, role            -- separate Tabelle!
markets               id, country, language, domain, path_prefix, brand,
                      language_variant, magazine_root, category_root,
                      path_map (json), institutions (json), forbidden_claims (json),
                      address_form, active
prompt_templates      id, step_key, name, description, system_prompt, user_prompt,
                      model, temperature, max_tokens, response_format,
                      variables (json), version, is_active, updated_by, updated_at
prompt_versions       id, template_id, version, system_prompt, user_prompt, created_at, created_by
url_index             id, market_id, url, path_type, h1, title, meta_description,
                      breadcrumb, intro_text, http_status, embedding, last_seen
jobs                  id, source_url, market_id, status, current_step,
                      created_by, created_at, context (json)
job_steps             id, job_id, step_key, status, input (json), output (json),
                      prompt_snapshot, model, tokens_in, tokens_out, duration_ms, error
verified_links        id, job_id, anchor, target_url, http_status, canonical_ok,
                      confidence, source ('hreflang'|'index'|'manual')


Wichtig: jobs.context ist das mitwachsende Kontextobjekt. Jeder Schritt liest daraus und schreibt sein Ergebnis zurück. Der letzte Schritt bekommt es vollständig. So wird garantiert, dass am Ende alle Informationen zusammenlaufen.

6. Der Kontext-Container

Nach jedem Schritt wächst jobs.context. Struktur:

{
  "source": {
    "url": "...", "h1": "...", "meta_description": "...",
    "blocks": [{"type":"h2","text":"..."}, {"type":"p","text":"..."}],
    "tables": [{"index":0,"rows":[{"label":"...","value":"..."}]}],
    "outgoing_links": [{"anchor":"...","url":"...","section":"..."}],
    "word_count": 1900
  },
  "market": { "...aus markets..." },
  "target": {
    "url": "...", "status": "EXISTS|VERIFIED_404|NOT_IN_INDEX",
    "resolution_method": "hreflang|path_map|llm_slug|fuzzy",
    "content": { "...oder null..." }
  },
  "comparison": { "verdict":"AUSREICHEND|NEU_ERSTELLEN", "word_count":0, "missing_topics":[], "reason":"..." },
  "style_profile": { "address_form":"...", "examples":["..."], "tone_notes":["..."] },
  "plan": { "sections":[{"de_heading":"...","target_heading":"...","action":"...","notes":[],"has_table":false}] },
  "links": { "verified":[{"anchor":"...","url":"...","confidence":"hoch"}], "gaps":[{"de_anchor":"...","searched":["..."],"reason":"..."}] },
  "tables_localized": [ ... ],
  "content": { "sections":[...], "full_text":"...", "output_mode":"markdown|txt" },
  "qa": { "issues":[...] }
}


7. Die Pipeline-Schritte

Jeder Schritt bekommt einen step_key. Schritte mit LLM haben einen editierbaren Prompt in prompt_templates. Schritte mit CODE laufen ohne Modell.

S1 fetch_source — CODE

Serverseitiger Fetch der DE-URL über eine Edge-Function (kein Client-Fetch, CORS). Extraktion via Readability-artigem Parser:

H1, Meta-Description, Datum

Redaktioneller Block als Blockliste (h2, h3, p, ul, table, img)

Navigation, Footer, Produktkacheln, Filter, Breadcrumbs, Banner entfernen

Tabellen als eigene Objekte, nicht als Fließtext

Alle internen Ausgangslinks mit Ankertext und Abschnittszuordnung — die werden in S7 gebraucht

Roh-HTML zusätzlich speichern (für hreflang-Auslesung in S2)

S2 resolve_target — CODE + LLM (Fallback)

Kaskade, in dieser Reihenfolge:

hreflang aus dem Roh-HTML: <link rel="alternate" hreflang="pl-PL" href="...">. Treffer → fertig, resolution_method: hreflang.

path_map: Pfadsegmente über die Markt-Mapping-Tabelle übersetzen (magazin/hund/rassen → magazyn/pies/rasy), Slug anhängen, im url_index suchen.

LLM-Slugvorschlag (nur wenn 1 und 2 leer) — siehe Prompt resolve_target_slug unten.

Fuzzy-Match: Embedding-Suche mit dem deutschen H1 im url_index, gefiltert auf denselben path_type.

Danach immer ein echter GET auf die ermittelte URL.

Statusunterscheidung ist Pflicht: VERIFIED_404 (aufgerufen, existiert nicht) versus NOT_IN_INDEX (nicht gefunden, aber nie aufgerufen). Diese beiden dürfen im UI nicht zusammenfallen.

S3 fetch_target — CODE

Wie S1 für die Zielseite. Bei VERIFIED_404 übersprungen.

S4 compare — LLM

Vergleicht DE- und Zielcontent, liefert AUSREICHEND oder NEU_ERSTELLEN. Bei AUSREICHEND endet der Job hier mit Report; Content-Erstellung entfällt.

S5 style_profile — LLM (gecacht pro Markt + Content-Typ)

Zieht 2–3 thematisch benachbarte Seiten aus dem url_index, extrahiert deren Fließtext und leitet ein Stilprofil ab. Ergebnis wird gecacht und nur bei Cache-Miss neu berechnet.

Hinweis für die Implementierung: maxizoo.pl ist bei der Ansprache inkonsistent — der Rassen-Hub duzt, einzelne Artikel siezen. Deshalb überschreibt markets.address_form, falls gesetzt, immer das automatisch ermittelte Profil.

S6 localization_plan — LLM

Entscheidet pro Abschnitt zwischen uebersetzen, lokalisieren, umschreiben, streichen. Schreibt noch keinen Fließtext.

Dies ist der qualitätsentscheidende Schritt. Ohne ihn wird jeder Abschnitt isoliert übersetzt, und marktspezifische Anpassungen fallen weg — genau die Anpassungen, die den Wert des Tools ausmachen. Beispiele aus dem Referenzfall Barbet/Polen: die deutsche „Brauchbarkeitsprüfung" muss zu „próby pracy / Polski Związek Łowiecki" werden, der „Hundeführerschein" existiert in Polen nicht und muss ersetzt werden, „In Deutschland selten" muss auf den polnischen Markt umgeschrieben werden.

Für diesen Schritt das stärkste verfügbare Modell konfigurieren.

S7 link_discovery — CODE

Kandidatensuche, vor der Content-Erstellung. Zwei Quellen:

a) DE-Ausgangslinks aus S1. Für jeden: falls hreflang verfügbar, die verlinkte DE-Seite abrufen und deren PL-Alternate auslesen → direktes Mapping, Konfidenz hoch. Sonst Retrieval im url_index.

b) Geplante Abschnittsthemen aus S6. Pro Abschnitt Suchbegriffe ableiten und im Index suchen.

Retrieval = Hybrid aus BM25 auf h1 + title + meta_description und Embedding-Similarity, gefiltert nach path_type (Rassen/Ratgeber → magazine_root, Produkte → category_root). Top 10 pro Anker.

S8 link_select — LLM (gebatcht, 5–10 Anker pro Call)

Bekommt Ankertext plus nummerierte Kandidatenliste. Antwortet mit Nummer oder null. Keine URLs im Output.

S9 link_verify — CODE

Für jede gewählte URL: GET (nicht HEAD), Status 200, Redirect-Ziel protokollieren, Canonical vergleichen, Soft-404-Heuristik (Titel oder Body enthält 404-Marker, Content-Element leer). Nur vollständig bestandene URLs landen in verified_links. Der Rest wandert in den Gap-Report.

S10 localize_tables — LLM (ein Call pro Tabelle)

Tabellen bewusst getrennt vom Fließtext. Zusammen mit Fließtext im selben Call führt zuverlässig zu zerschossenem Markdown oder ausgelassenen Zeilen. Code prüft danach: Zeilenzahl identisch zum Original? Sonst Retry.

S11 generate_content — LLM — der finale Content-Schritt

Bekommt den vollständigen Kontext-Container: Marktprofil, Stilprofil, Lokalisierungsplan, lokalisierte Tabellen, verifizierte Linkliste und den deutschen Originaltext.

Implementierung als Schleife über die Abschnitte aus S6 — ein API-Call pro Abschnitt, damit Token-Limits eingehalten werden. Für den Nutzer ist es ein Schritt; im Admin ist es ein Prompt-Template, das pro Abschnitt angewandt wird. Jeder Call erhält zusätzlich die bereits erzeugten Überschriften, damit keine Dopplungen entstehen.

Die verifizierte Linkliste wird hier hineingegeben, damit das Modell die Anker an passender Stelle im Text platziert. Dadurch bleibt Regel 1 gewahrt: Das Modell erfindet keine URLs, es verwendet nur bereits geprüfte.

S12 qa — LLM + CODE

LLM prüft auf deutsche Restwörter, falschen Markennamen, inkonsistente Ansprache, marktfremde Aussagen, defekte Tabellen, doppelte Überschriften. Code prüft deterministisch: Umlaute in nicht-deutschen Zielsprachen, „Fressnapf" auf einer Maxi-Zoo-Domain, „ß" bei Schweizer Hochdeutsch, Spaltenzahl aller Tabellen.

S13 assemble — CODE

Zusammenbau und Ausgabe:

Content enthält Tabellen → Ausgabe als Markdown im UI, mit dem Hinweis „Der Content enthält eine Tabelle und wird daher direkt im Chat ausgegeben statt als TXT-Datei."

Keine Tabellen → zusätzlich als .txt zum Download

Immer angehängt: Quell-URL, Ziel-URL, Sprache des Contents, Linkempfehlungstabelle mit HTTP-Status, Gap-Report, Liste der vorgenommenen Anpassungen aus S6

Antworten an den Nutzer immer auf Deutsch, auch wenn der Content in einer anderen Sprache ist

8. Admin-Bereich

8.1 Prompt-Verwaltung

Liste aller Prompt-Templates nach step_key. Pro Template editierbar:

Name, Beschreibung

System-Prompt und User-Prompt (Monospace-Editor, mehrzeilig)

Modell-Auswahl, Temperature, Max Tokens, Response-Format (json / text)

Anzeige der verfügbaren Variablen für genau diesen Schritt, per Klick einfügbar

Validierung beim Speichern: Wird eine Variable verwendet, die es im Schritt nicht gibt → Fehler mit Namensnennung

Versionierung: jede Speicherung erzeugt eine neue Version, Diff-Ansicht, Rollback per Klick

Testlauf: Prompt gegen einen bestehenden Job ausführen, ohne dessen gespeichertes Ergebnis zu überschreiben — Ergebnis wird nur angezeigt

Variablen-Syntax: {{variable_name}}. Die verfügbaren Variablen pro Schritt kommen aus prompt_templates.variables und werden aus dem Kontext-Container befüllt.

8.2 Marktverwaltung

CRUD auf markets, inklusive der JSON-Felder:

path_map — Pfadsegment-Übersetzungen

institutions — Mapping deutscher Institutionen auf lokale Entsprechungen. null bedeutet: existiert im Zielmarkt nicht, Abschnitt muss umgeschrieben statt übersetzt werden.

forbidden_claims — Formulierungen, die im Zielmarkt nicht stehen dürfen

address_form — überschreibt das automatisch ermittelte Stilprofil

8.3 URL-Index-Verwaltung

Pro Markt: „Index neu aufbauen" (Sitemap-Crawl), Fortschrittsanzeige, Anzahl URLs, Zeitpunkt des letzten Laufs

Suchbare Tabellenansicht des Index

Liste der URLs mit http_status != 200 als Nebenprodukt für das SEO-Team

Sitemap-Kette: robots.txt → Sitemap-Index → Sub-Sitemaps. Fallback bei fehlender Sitemap: BFS-Crawl ab magazine_root und category_root mit Tiefenlimit und Rate-Limiting.

8.4 Job-Übersicht

Alle Jobs mit Status, Markt, Quell-URL, Erstellungszeit. Detailansicht mit allen Schritten, deren Ein- und Ausgaben, dem verwendeten Prompt-Snapshot und den Token-Kosten.

9. Prompt-Vorlagen (Seed-Daten)

Diese Templates werden beim Setup in prompt_templates angelegt und sind danach im Admin editierbar.

resolve_target_slug

Variablen: {{term}}, {{language}}, {{country}}

Zielsprache: {{language}}. Zielland: {{country}}.
Deutscher Begriff aus der URL: "{{term}}".

Nenne 5 mögliche URL-Slugs in der Zielsprache, wie sie ein Tierbedarf-Onlineshop
verwenden würde. Berücksichtige die landesübliche Fachbezeichnung, nicht die
wörtliche Übersetzung.

Antworte nur mit JSON:
{"slugs": ["...", "...", "...", "...", "..."]}


compare

Variablen: {{de_structure}}, {{de_word_count}}, {{target_structure}}, {{target_word_count}}, {{target_excerpt}}

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


style_profile

Variablen: {{reference_texts}}

Analysiere den Schreibstil dieser vorhandenen Ratgeberartikel eines Tierbedarf-Shops.

{{reference_texts}}

Antworte nur mit JSON:
{"address_form":"informell"|"formell"|"gemischt",
 "address_examples":["..."],
 "sentence_length":"kurz"|"mittel"|"lang",
 "heading_style":"Frage"|"Aussage"|"gemischt",
 "tone_notes":["max. 5 kurze Beobachtungen"],
 "recurring_phrases":["..."]}


localization_plan

Variablen: {{de_outline}}, {{market_profile}}, {{country}}, {{language}}

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

Antworte nur mit JSON:
{"sections":[{"de_heading":"...","target_heading":"...",
  "action":"uebersetzen|lokalisieren|umschreiben|streichen",
  "notes":["konkrete Anweisung für den Schreibschritt"],
  "has_table":true|false}]}


link_select

Variablen: {{anchor}}, {{context_sentence}}, {{candidates}}

Wähle die beste interne Verlinkung für einen Ankertext.

<ankertext>{{anchor}}</ankertext>
<kontext>{{context_sentence}}</kontext>

<kandidaten>
{{candidates}}
</kandidaten>

Wähle die thematisch am besten passende Seite. Wenn keine Seite wirklich passt,
antworte mit null. Rate nicht und wähle nicht „die am wenigsten schlechte".

Antworte nur mit JSON:
{"choice": <nummer>|null, "confidence":"hoch"|"mittel"|"niedrig", "reason":"1 Satz"}


localize_table

Variablen: {{table_markdown}}, {{language}}, {{market_notes}}

Lokalisiere diese Tabelle nach {{language}}.

<tabelle>{{table_markdown}}</tabelle>
<hinweise>{{market_notes}}</hinweise>

Regeln:
- Zeilenzahl und Reihenfolge exakt beibehalten
- Maßeinheiten beibehalten
- Rassebezeichnungen und Fachbegriffe in die landesübliche Form bringen
- Keine Zeile zusammenfassen oder auslassen

Antworte nur mit JSON:
{"rows":[{"label":"...","value":"..."}]}


generate_content — der finale Schritt

Variablen: {{language}}, {{language_variant}}, {{brand}}, {{address_form}}, {{style_profile}}, {{style_example}}, {{de_section}}, {{action}}, {{localization_notes}}, {{written_headings}}, {{verified_links}}, {{table_markdown}}

Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Marke: {{brand}}. Ansprache: {{address_form}}.

<stilprofil>{{style_profile}}</stilprofil>
<stilbeispiel>{{style_example}}</stilbeispiel>

<de_original>{{de_section}}</de_original>
<aktion>{{action}}</aktion>
<lokalisierungshinweise>{{localization_notes}}</lokalisierungshinweise>
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<geprüfte_links>{{verified_links}}</geprüfte_links>
<tabelle>{{table_markdown}}</tabelle>

Regeln:
- Nicht 1:1 übersetzen, sondern lokalisieren. Kein Übersetzungston.
- Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog.
  Keine bürokratischen oder akademischen Formulierungen.
- Alle inhaltlichen Kernaussagen, Checklisten, Material- und Produkthinweise erhalten.
- Keine Fakten erfinden, die nicht im Original stehen — außer die
  Lokalisierungshinweise fordern es ausdrücklich.
- Fettungen (**) an denselben Stellen wie im Original.
- VERLINKUNG: Verwende ausschließlich Anker aus <geprüfte_links>. Erfinde niemals
  eine URL. Setze einen Anker nur dort, wo er inhaltlich passt — lieber weglassen
  als erzwingen.
- Falls eine Tabelle übergeben wurde, füge sie unverändert an der passenden Stelle ein.
- Format: [H2: ...] bzw. [H3: ...], darunter Fließtext, Listen als Bullets,
  Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.


qa

Variablen: {{full_text}}, {{brand}}, {{forbidden_terms}}, {{language}}

Prüfe diesen lokalisierten Artikel auf Fehler.

<artikel>{{full_text}}</artikel>
<zielsprache>{{language}}</zielsprache>
<marke>{{brand}}</marke>
<verbotene_begriffe>{{forbidden_terms}}</verbotene_begriffe>

Prüfe auf: deutsche Restwörter, falschen Markennamen, inkonsistente Ansprache,
marktfremde Aussagen, defekte Markdown-Tabellen, doppelte Überschriften,
erfundene oder unvollständige Links.

Antworte nur mit JSON:
{"issues":[{"type":"...","location":"...","found":"...","suggestion":"..."}]}


10. Technische Hinweise

Alle externen Fetches serverseitig über Edge-Functions. Kein Client-Fetch (CORS, IP-Reputation).

API-Keys ausschließlich serverseitig speichern, niemals im Frontend.

Rate-Limiting beim Crawlen der eigenen Domains: konfigurierbare Verzögerung, robots.txt respektieren, aussagekräftiger User-Agent.

Retry-Logik pro LLM-Call: bei ungültigem JSON bis zu 2 Wiederholungen mit Fehlerhinweis im Prompt, dann Schritt als fehlgeschlagen markieren.

Idempotenz: Ein einzelner Schritt muss wiederholbar sein, ohne den Job zu zerstören. Ergebnisse werden versioniert überschrieben.

Kostenanzeige pro Job aus den Token-Zählern.

Langlaufende Schritte (Index-Aufbau, S11) als Background-Job mit Fortschritts-Polling, nicht als blockierender Request.

11. Abnahmekriterien

Referenzfall: https://www.fressnapf.de/magazin/hund/rassen/barbet/ → Polen / Polnisch.

Kriterium Erwartung Ziel-URL-Status VERIFIED_404, nicht NOT_IN_INDEX Vergleichsurteil NEU_ERSTELLEN Lokalisierungsplan „Brauchbarkeitsprüfung" → umschreiben; „Hundeführerschein" → umschreiben; Quellenblock → streichen Generierter Content Marke durchgängig „Maxi Zoo"; ZKwP und Polski Związek Łowiecki statt VDH; keine deutschen Restwörter Steckbrief-Tabelle Zeilenzahl identisch zum deutschen Original Links jede ausgegebene URL mit HTTP-200-Beleg; keine URL ohne Verifikation Gap-Report dokumentiert, mit welchen Suchbegriffen erfolglos gesucht wurde Defekte Slugs /magazyn/psy/rasy/bolonczyk/ wird bei S9 aussortiert Admin jeder LLM-Prompt editierbar, versioniert, testbar Rollen Admin vorhanden, weitere Rollen ohne Schema-Migration ergänzbar

Zusätzlicher Recall-Test: Die Linkpipeline muss Themen finden, die weder in der Navigation noch im Rasse-Verzeichnis verlinkt sind — etwa polnische Entsprechungen zu Hüftgelenkdysplasie, Lebenserwartung oder Trennungsangst, sofern sie im Sitemap-Index existieren. Genau daran scheitert eine navigationsbasierte Suche.

12. Vor dem Bauen zu klären

Liefert fressnapf.de hreflang-Tags auf die Zieldomains aus? Ein einziger Request auf das Roh-HTML klärt das. Falls ja, wird S2 trivial und S7 nahezu fehlerfrei — die Architektur beider Schritte hängt daran.

Ist eine Sitemap unter maxizoo.pl/robots.txt erreichbar? Bestimmt, ob der Index per Sitemap oder per Crawl aufgebaut wird.

Ansprache pro Markt einmalig festlegen und in markets.address_form eintragen, da die Bestandsseiten uneinheitlich sind.

Abschlusshinweis unter der Linktabelle: Im ursprünglichen Agenten-Prompt war an dieser Stelle ein leerer Platzhalter. Text muss vom Fachbereich geliefert und in die Marktkonfiguration aufgenommen werden.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a1184ce9-bf59-4862-9d38-534cf59016c4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
