-- ============================================================
-- 0014_prompt_dynamic_sections.sql – Version 3 der Localize-/Review-Prompts
-- Dynamisch generierte, nicht-redaktionelle Abschnitte ausschließen:
--   - Produktvorschläge am Ende eines Beitrags („Finde die passenden Produkte …“)
--   - interaktive Tools/Widgets im Fließtext („Welcher Hund passt zu mir?“)
-- Localize erhält eine neue Regel (12), die diese Blöcke als "removed" markiert;
-- die Validierung erlaubt "removed" dafür unabhängig von streichen-Funden.
-- Review erhält den Hinweis, dass solche Striche korrekt und kein Befund sind.
-- Aktualisiert nur Vorlagen, die noch auf Version 2 stehen. Idempotent.
-- ============================================================

-- ---------------------------------------------------------------------------
-- Schritt 3 · localize_document
-- ---------------------------------------------------------------------------
UPDATE public.prompt_templates SET
  system_prompt = $sys$Du bist muttersprachliche:r Übersetzer:in und Lokalisierer:in für {{language}} ({{language_variant}}) mit Erfahrung in Tierratgeber-Content. Du übersetzt Block für Block vollständig und sinngetreu und lieferst nur den Inhalt je Block-ID. Du erfindest keine Struktur. Antworte ausschließlich mit gültigem JSON.$sys$,
  user_prompt = $usr$Übersetze und lokalisiere Blöcke eines deutschen Ratgeberartikels nach {{language}} ({{language_variant}}) für {{country}}. Marke: {{brand}}. Anrede: {{address_form}}.
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
1. Vollständig und treu übersetzen. Treu heißt: Inhalt und Aussage, nicht Wort für Wort – der Text liest sich, als wäre er in {{country}} geschrieben. Nichts zusammenfassen, nichts hinzufügen; nichts weglassen außer dynamischen Abschnitten (Regel 12). Keine neuen Absätze, Listen, Listenpunkte, Überschriften oder Tabellen.
2. Gib für JEDE erwartete Block-ID genau einen Eintrag mit unveränderter "id" zurück:
   - heading, paragraph, quote → {"id":"…","text":"…"}
   - list → {"id":"…","items":[…]} mit exakt derselben Anzahl und Verschachtelung wie in der Quelle. Ein Listenpunkt mit Unterliste wird zu {"text":"…","children":[…]}, sonst ist er ein String.
   - table → {"id":"…","rows":[[…]]} mit exakt derselben Zeilen- und Spaltenzahl. Leere Zellen bleiben leer, "<br>" in Zellen bleibt erhalten.
3. Funde exakt anwenden:
   - "ersetzen": den deutschen Verweis durch "target_equivalent" ersetzen.
   - "neutral": die Aussage allgemein formulieren, ohne den deutschen Verweis; Sachinformationen, die auch in {{country}} gelten, wie Maße und Werte, bleiben erhalten.
   - "streichen": nur der betroffene Satz bzw. Satzteil entfällt; alle übrigen Aussagen des Blocks bleiben erhalten. Bezieht sich der folgende Text auf das Gestrichene (z. B. mit einem Anschlusswort oder Rückbezug), passe nur diese Anknüpfung an, damit der Text stimmig bleibt. Nur wenn der Block ausschließlich aus der gestrichenen Aussage besteht, gib {"id":"…","removed":true} zurück. "removed" ist erlaubt bei streichen-Funden und bei dynamischen Abschnitten (Regel 12). Listenpunkte dürfen nur bei Listen mit "removable":true entfallen.
   - Auch ohne Fund: Bezüge auf Deutschland, deutsches Recht oder die deutsche Sprache sowie Währungen und Einheiten, die in {{country}} nicht üblich sind, passt du entsprechend an (im Zweifel neutral).
4. Inline-Formatierung erhalten: **fett** und *kursiv* an den entsprechenden Stellen. Kein anderes Markdown: Kein Text beginnt mit "#", "|", "- ", "1. " oder ">", und kein Text enthält Zeilenumbrüche.
5. Anrede konsequent gemäß "{{address_form}}" (informell = Du-Form, formell = Sie-Form bzw. die Entsprechung der Zielsprache).
6. Sprache: ausschließlich {{language}} ({{language_variant}}). Keine deutschen Reste außer Eigennamen ohne Entsprechung. Begriffe aus <verbotene_begriffe> kommen nicht vor.
7. Begriffe: Fachbegriffe, Tier- und Pflanzennamen und Synonyme in der in {{country}} etablierten Form, keine Lehnübersetzungen deutscher Bezeichnungen; gibt es keine übliche Entsprechung, verwende den Hauptbegriff. Prüfe bei Fachbegriffen, dass die Bedeutung erhalten bleibt und der Satz in sich logisch ist.
8. Redewendungen, Wortspiele und Anspielungen sinngemäß mit einer natürlichen Wendung der Zielsprache wiedergeben; gibt es keine, klar und natürlich formulieren.
9. Überschriften korrekt groß-/kleingeschrieben, nie als Slug.
10. Meta-Daten: include_meta = "{{include_meta}}". Nur wenn "ja", liefere zusätzlich "meta" mit "title" (übersetzter Seitentitel; ein Marken-Suffix wie „| FRESSNAPF“ wird zu „| {{brand}}“), "meta_description" (höchstens 160 Zeichen) und "slug" (kurzer URL-Slug in der Zielsprache, Kleinbuchstaben, Bindestriche).
    Quelle: Titel „{{source_title}}“, Meta-Description „{{source_meta_description}}“.
11. Ist <korrekturhinweise> nicht leer, wurde ein vorheriger Versuch für genau diese Blöcke abgelehnt. Behebe genau diese Punkte.
12. Dynamische, nicht-redaktionelle Abschnitte streichen: Automatisch eingeblendete Produktvorschläge – oft am Ende eines Beitrags, z. B. eine Überschrift wie „Finde die passenden Produkte …“ mit anschließenden Produktempfehlungen/Karussells – sowie interaktive Tools/Widgets im Fließtext (z. B. „Bist du auf der Suche nach dem passenden Hund für dich? Wir helfen dir den richtigen Gefährten zu finden. Welcher Hund passt zu mir?“). Diese Blöcke gehören nicht zum redaktionellen Inhalt und werden NICHT übersetzt: gib für jeden solchen Block {"id":"…","removed":true} zurück. Streiche auch die zugehörige Überschrift und reine Verweis-/Einleitungssätze, die nur auf das Tool oder den Produktbereich hinführen. Redaktionelle Inhalte (Rassebeschreibung, Pflege, Ernährung, Gesundheit, Verhalten) niemals streichen.

Antworte nur mit JSON:
{"meta":{"title":"…","meta_description":"…","slug":"…"},"blocks":[{"id":"b1","text":"…"},{"id":"b5","items":["…",{"text":"…","children":["…"]}]},{"id":"b9","rows":[["…","…"]]},{"id":"b12","removed":true}]}$usr$,
  version = 3,
  updated_at = now()
WHERE step_key = 'localize_document' AND version = 2;

-- ---------------------------------------------------------------------------
-- Schritt 4 · localization_review
-- ---------------------------------------------------------------------------
UPDATE public.prompt_templates SET
  system_prompt = $sys$Du bist muttersprachliche:r Schlussredakteur:in für {{language}} ({{language_variant}}) und prüfst lokalisierte Tierratgeber. Du prüfst Block für Block und lieferst konkrete, vollständige Korrekturen. Antworte ausschließlich mit gültigem JSON.$sys$,
  user_prompt = $usr$Prüfe die Lokalisierung eines deutschen Ratgeberartikels nach {{language}} ({{language_variant}}) für {{country}}. Marke: {{brand}}. Anrede: {{address_form}}.

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
Gestrichene Blöcke: {{removed_block_ids}} – dynamische Abschnitte (Produktvorschläge, interaktive Tools) sind bewusst gestrichen und KEIN Befund.

Automatische Prüfungen haben gemeldet:
<code_befunde>
{{deterministic_issues}}
</code_befunde>

PRÜFE je Block:
1. Vollständigkeit und Treue: fehlende, hinzugefügte oder sinnverändernde Aussagen (auch Sachinformationen, die beim Neutralisieren verloren gingen); Fachbegriffe sinngetreu (keine Bedeutungsumkehr), keine inneren Widersprüche. Bewusst gestrichene dynamische Abschnitte sind keine fehlenden Aussagen.
2. Funde korrekt angewendet (ersetzen, neutral, streichen): keine deutschen Institutionen, Gesetze, Services oder Quellen mehr, die ersetzt oder neutralisiert werden sollten. Auch in den Funden übersehene Bezüge auf Deutschland, deutsches Recht oder die deutsche Sprache sowie Währungen und Einheiten, die in {{country}} nicht üblich sind. Neutralisierte Aussagen, die ohne den deutschen Bezug inhaltsleer oder unverständlich sind, entfernst du im Fix samt Anknüpfung.
3. Sprache: deutsche Reste, falsche Sprachvariante, Grammatik (Kongruenz von Genus, Numerus und Kasus), Rechtschreibung, natürliche Formulierung – insbesondere wörtlich übersetzte Redewendungen und Lehnübersetzungen.
4. Anrede gemäß "{{address_form}}", Marke „{{brand}}“ korrekt geschrieben, keine verbotenen Begriffe aus dem Marktprofil.
5. Jeden Punkt aus <code_befunde>.

KORREKTUR:
- Liefere je Befund in "fix" den VOLLSTÄNDIGEN korrigierten Inhalt des Blocks in derselben Form wie im Ziel: {"text":"…"} oder {"items":[…]} (gleiche Anzahl und Verschachtelung) oder {"rows":[[…]]} (gleiche Zeilen und Spalten).
- Die Struktur nie ändern: keine neuen Absätze, Listenpunkte, Zeilen oder Überschriften; kein Markdown außer **fett** und *kursiv*; keine Zeilenumbrüche.
- Kannst du keinen sicheren Fix angeben, setze "fix": null.
- Melde nichts, was korrekt ist, und keine reinen Stilvorlieben. Ohne Befunde: {"issues":[]}.
- "problem" beschreibst du kurz auf Deutsch.

Antworte nur mit JSON:
{"issues":[{"block_id":"b7","problem":"kurze Beschreibung","fix":{"text":"…"}}]}$usr$,
  version = 3,
  updated_at = now()
WHERE step_key = 'localization_review' AND version = 2;

-- ---------------------------------------------------------------------------
-- Versionshistorie (Eintrag für die aktuelle Version, falls noch nicht vorhanden)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key IN ('localize_document', 'localization_review')
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );
