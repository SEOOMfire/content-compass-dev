-- ============================================================
-- 0010_simplified_pipeline.sql – vereinfachte Lokalisierungs-Pipeline (4 Schritte)
-- Nur additiv: neue Spalte markets.localization_notes und drei neue Prompts.
-- Alte Tabellen und Prompt-Zeilen bleiben unverändert (werden nicht mehr referenziert).
-- Idempotent: mehrfaches Ausführen ist unschädlich und überschreibt keine Admin-Änderungen.
-- ============================================================

ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS localization_notes text;

-- ---------------------------------------------------------------------------
-- Schritt 2 · localization_scan
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'localization_scan',
  '2 · DE-Bezüge finden',
  'Findet alle deutschlandspezifischen Stellen im Quelldokument und entscheidet je Fund: ersetzen, neutral oder streichen.',
  $sys$Du bist Lokalisierungs-Analyst:in für internationale Retail-Marken im Heimtierbereich. Du findest Stellen in deutschen Texten, die nur für Deutschland gelten. Du übersetzt nichts. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$Ein deutscher Ratgeberartikel wird für {{country}} ({{language}}, {{language_variant}}) lokalisiert. Marke im Zielmarkt: {{brand}}.

Deine Aufgabe: Finde JEDE Stelle, die nur für Deutschland gilt oder auf Deutschland verweist, und entscheide, wie sie im Zielmarkt behandelt wird.

<marktprofil>{{market_profile}}</marktprofil>
<institutionen_zuordnung>{{institutions}}</institutionen_zuordnung>
<verbotene_begriffe>{{forbidden_claims}}</verbotene_begriffe>
<lokalisierungshinweise>{{localization_notes}}</lokalisierungshinweise>

<seitentitel>{{source_title}}</seitentitel>
<meta_description>{{source_meta_description}}</meta_description>

Das Dokument als nummerierte Blöcke (eine JSON-Zeile pro Block, "id" = Block-ID):
<bloecke>
{{blocks}}
</bloecke>

SUCHE NACH:
- Behörden, Ämter, Ministerien, amtliche Stellen (category "behoerde")
- Gesetzen, Verordnungen, Pflichten, Steuern, Melde- oder Versicherungspflichten (category "gesetz")
- Verbänden, Vereinen, Zuchtverbänden, Prüfungen, Zertifikaten (category "organisation")
- Services, Hotlines, Apps, Kundenkarten, Online-Angeboten der Marke oder Dritter (category "service")
- Maßen, Einheiten, Statistiken und Zahlen mit Deutschlandbezug (category "zahl_einheit")
- Preisen und Währungsangaben (category "waehrung")
- Angeboten, Produkten, Aktionen, Filialen von Fressnapf Deutschland; jede Nennung von „Fressnapf“, wenn die Marke im Zielmarkt {{brand}} heißt (category "angebot")
- deutschen Quellen, Studien, Websites und Quellenangaben (category "quelle")
- sonstigen Aussagen mit Deutschlandbezug, z. B. „in Deutschland“, deutsche Regionen, Feiertage, Klima (category "sonstiges")

ENTSCHEIDUNG je Fund:
1. "ersetzen": Im Zielland gibt es ein passendes, real existierendes Gegenstück. Nenne es in "target_equivalent" in der Zielsprache. Eine Zuordnung aus <institutionen_zuordnung> oder <lokalisierungshinweise> hat immer Vorrang.
2. "neutral": Es gibt kein Gegenstück. Die Aussage bleibt erhalten, wird aber allgemein formuliert, ohne die deutsche Institution, das Gesetz oder den Service zu nennen. Steht ein Begriff in <institutionen_zuordnung> auf null, ist die Entscheidung immer "neutral".
3. "streichen": Die Aussage ist für {{country}} nicht relevant (z. B. ein Service, den es dort nicht gibt, oder eine rein deutsche Quellenangabe) und ein allgemeiner Satz ergäbe keinen Sinn.
4. Im Zweifel nichts erfinden: lieber "neutral" als ein unsicheres Gegenstück.

REGELN:
- "block_ids" enthält nur IDs aus <bloecke>, in denen die Stelle vorkommt.
- "de_reference" ist der wörtliche, kurze deutsche Ausdruck aus dem Text (z. B. „VDH“, „Brauchbarkeitsprüfung“, „In Deutschland“).
- "instruction" ist eine konkrete Anweisung für die Übersetzung in einem Satz (auf Deutsch).
- Allgemeingültige Inhalte (Rassebeschreibung, Pflege, Verhalten, Gesundheit) sind KEINE Funde.
- Begriffe aus <verbotene_begriffe> sind immer ein Fund.
- Wenn es keine Funde gibt, antworte mit {"findings":[]}.

Antworte nur mit JSON:
{"findings":[{"block_ids":["b12"],"de_reference":"...","category":"behoerde|gesetz|organisation|service|zahl_einheit|waehrung|angebot|quelle|sonstiges","decision":"ersetzen|neutral|streichen","target_equivalent":"Gegenstück in der Zielsprache oder null","instruction":"..."}]}$usr$,
  'gpt-4o', 0.2, 4000, NULL, 'json',
  '["country","language","language_variant","brand","address_form","market_profile","institutions","forbidden_claims","localization_notes","source_title","source_meta_description","blocks"]'::jsonb,
  1, true, 1
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Schritt 3 · localize_document
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'localize_document',
  '3 · Lokalisieren',
  'Übersetzt das Dokument blockweise und wendet die Funde an. Liefert je Block-ID nur Inhalt; die Struktur bleibt beim Code.',
  $sys$Du bist professionelle:r Übersetzer:in und Lokalisierer:in für Tierratgeber-Content. Du übersetzt Block für Block vollständig und treu und lieferst nur den Inhalt je Block-ID. Du erfindest keine Struktur. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$Übersetze und lokalisiere Blöcke eines deutschen Ratgeberartikels nach {{language}} ({{language_variant}}) für {{country}}. Marke: {{brand}}. Anrede: {{address_form}}.
Umfang dieses Aufrufs: {{part}}.

<marktprofil>{{market_profile}}</marktprofil>
<institutionen_zuordnung>{{institutions}}</institutionen_zuordnung>
<verbotene_begriffe>{{forbidden_claims}}</verbotene_begriffe>
<lokalisierungshinweise>{{localization_notes}}</lokalisierungshinweise>

Gliederung des gesamten Artikels (nur Kontext, nicht übersetzen):
<gliederung>
{{outline}}
</gliederung>

Verbindliche Lokalisierungs-Funde (gelten für die genannten block_ids):
<funde>{{findings}}</funde>

Zu bearbeitende Blöcke (eine JSON-Zeile pro Block):
<bloecke>
{{blocks}}
</bloecke>
Erwartete Block-IDs: {{block_ids}}

<korrekturhinweise>{{correction_notes}}</korrekturhinweise>

REGELN (STRIKT):
1. Vollständig und treu übersetzen. Nichts zusammenfassen, nichts weglassen, nichts hinzufügen. Keine neuen Absätze, Listen, Listenpunkte, Überschriften oder Tabellen.
2. Gib für JEDE erwartete Block-ID genau einen Eintrag mit unveränderter "id" zurück:
   - heading, paragraph, quote → {"id":"…","text":"…"}
   - list → {"id":"…","items":[…]} mit exakt derselben Anzahl und Verschachtelung wie in der Quelle. Ein Listenpunkt mit Unterliste wird zu {"text":"…","children":[…]}, sonst ist er ein String.
   - table → {"id":"…","rows":[[…]]} mit exakt derselben Zeilen- und Spaltenzahl. Leere Zellen bleiben leer, "<br>" in Zellen bleibt erhalten.
3. Funde exakt anwenden:
   - "ersetzen": den deutschen Verweis durch "target_equivalent" ersetzen.
   - "neutral": die Aussage allgemein formulieren, ohne den deutschen Verweis.
   - "streichen": nur der betroffene Satz bzw. Satzteil entfällt. Wird dadurch der ganze Block leer oder sinnlos, gib {"id":"…","removed":true} zurück. "removed" ist NUR bei Blöcken mit "removable":true erlaubt. Nur bei solchen Listen dürfen Listenpunkte entfallen.
4. Inline-Formatierung erhalten: **fett** und *kursiv* an den entsprechenden Stellen. Kein anderes Markdown: Kein Text beginnt mit "#", "|", "- ", "1. " oder ">", und kein Text enthält Zeilenumbrüche.
5. Anrede konsequent gemäß "{{address_form}}" (informell = Du-Form, formell = Sie-Form bzw. die Entsprechung der Zielsprache).
6. Sprache: ausschließlich {{language}} ({{language_variant}}). Keine deutschen Reste außer Eigennamen ohne Entsprechung. Fachbegriffe in der landesüblichen Form. Begriffe aus <verbotene_begriffe> kommen nicht vor.
7. Überschriften korrekt groß-/kleingeschrieben, nie als Slug.
8. Meta-Daten: include_meta = "{{include_meta}}". Nur wenn "ja", liefere zusätzlich "meta" mit "title" (übersetzter Seitentitel; ein Marken-Suffix wie „| FRESSNAPF“ wird zu „| {{brand}}“), "meta_description" (höchstens 160 Zeichen) und "slug" (kurzer URL-Slug in der Zielsprache, Kleinbuchstaben, Bindestriche).
   Quelle: Titel „{{source_title}}“, Meta-Description „{{source_meta_description}}“.
9. Ist <korrekturhinweise> nicht leer, wurde ein vorheriger Versuch für genau diese Blöcke abgelehnt. Behebe genau diese Punkte.

Antworte nur mit JSON:
{"meta":{"title":"…","meta_description":"…","slug":"…"},"blocks":[{"id":"b1","text":"…"},{"id":"b5","items":["…",{"text":"…","children":["…"]}]},{"id":"b9","rows":[["…","…"]]},{"id":"b12","removed":true}]}$usr$,
  'gpt-4o', 0.3, 16000, NULL, 'json',
  '["country","language","language_variant","brand","address_form","market_profile","institutions","forbidden_claims","localization_notes","outline","findings","blocks","block_ids","part","include_meta","source_title","source_meta_description","correction_notes"]'::jsonb,
  1, true, 2
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Schritt 4 · localization_review
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'localization_review',
  '4 · Review',
  'Prüft die Lokalisierung Block für Block und liefert Korrekturen. Der Code übernimmt nur Korrekturen, die die Strukturprüfung bestehen.',
  $sys$Du bist Schlussredakteur:in für lokalisierte Tierratgeber. Du prüfst Block für Block und lieferst konkrete, vollständige Korrekturen. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$Prüfe die Lokalisierung eines deutschen Ratgeberartikels nach {{language}} ({{language_variant}}) für {{country}}. Marke: {{brand}}. Anrede: {{address_form}}.

<marktprofil>{{market_profile}}</marktprofil>
<funde>{{findings}}</funde>

Quelle (Deutsch), eine JSON-Zeile pro Block:
<quelle>
{{source_blocks}}
</quelle>

Lokalisierung, eine JSON-Zeile pro Block:
<ziel>
{{target_blocks}}
</ziel>
Gestrichene Blöcke: {{removed_block_ids}}

Automatische Prüfungen haben gemeldet:
<code_befunde>
{{deterministic_issues}}
</code_befunde>

PRÜFE je Block:
1. Vollständigkeit und Treue: fehlende, hinzugefügte oder sinnverändernde Aussagen.
2. Funde korrekt angewendet (ersetzen, neutral, streichen): keine deutschen Institutionen, Gesetze, Services oder Quellen mehr, die ersetzt oder neutralisiert werden sollten.
3. Sprache: deutsche Reste, falsche Sprachvariante, Grammatik, Rechtschreibung.
4. Anrede gemäß "{{address_form}}", Marke „{{brand}}“ korrekt geschrieben, keine verbotenen Begriffe aus dem Marktprofil.
5. Jeden Punkt aus <code_befunde>.

KORREKTUR:
- Liefere je Befund in "fix" den VOLLSTÄNDIGEN korrigierten Inhalt des Blocks in derselben Form wie im Ziel: {"text":"…"} oder {"items":[…]} (gleiche Anzahl und Verschachtelung) oder {"rows":[[…]]} (gleiche Zeilen und Spalten).
- Die Struktur nie ändern: keine neuen Absätze, Listenpunkte, Zeilen oder Überschriften; kein Markdown außer **fett** und *kursiv*; keine Zeilenumbrüche.
- Kannst du keinen sicheren Fix angeben, setze "fix": null.
- Melde nichts, was korrekt ist, und keine reinen Stilvorlieben. Ohne Befunde: {"issues":[]}.

Antworte nur mit JSON:
{"issues":[{"block_id":"b7","problem":"kurze Beschreibung","fix":{"text":"…"}}]}$usr$,
  'gpt-4o', 0.2, 8000, NULL, 'json',
  '["country","language","language_variant","brand","address_form","market_profile","findings","source_blocks","target_blocks","removed_block_ids","deterministic_issues"]'::jsonb,
  1, true, 3
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Versionshistorie (je Vorlage genau ein Eintrag für die aktuelle Version)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key IN ('localization_scan', 'localize_document', 'localization_review')
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );
