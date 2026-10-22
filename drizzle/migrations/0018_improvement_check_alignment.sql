-- ============================================================
-- 0018_improvement_check_alignment.sql – Prompt v2 für Schritt 8
-- Koppelt Schritt 8 an den Lokalisierungs-Check (Schritt 7):
-- Das Check-Briefing wird als {{CHECK_BRIEFING}} mitgegeben; Schritt 8
-- arbeitet die blockierenden Befunde als konkrete Patches ab und ergänzt
-- nur neue Vorschläge (keine Duplikate zum Check).
-- Idempotent.
-- ============================================================

UPDATE public.prompt_templates SET
  user_prompt = $usr$# Verbesserungen & Quellen

Analysiere den lokalisierten Zieltext gegen das deutsche Original und schlage gezielte inhaltliche Verbesserungen sowie fehlende Zielmarkt-Quellen vor. Du änderst keinen Text; dein Ergebnis ist ausschließlich die JSON-Liste mit Vorschlägen.

## Eckdaten
- Quell-URL: {{QUELL_URL}}
- Zielsprache: {{ZIELSPRACHE}}
- Zielmarkt: {{ZIELMARKT}}
- Marke: {{brand}}

## Lokalisierungs-Funde (Schritt 2, Kontext)
<funde>
{{FINDINGS}}
</funde>

## Lokalisierungs-Check (Schritt 7)
Die folgenden Befunde wurden bereits im Check gemeldet. Baue darauf auf:
<check>
{{CHECK_BRIEFING}}
</check>

## Original (deutsche Quelle, Blockliste – die "id" je Block ist die block_id)
<original>
{{ORIGINAL}}
</original>

## Lokalisierter Export (Zieltext)
<export>
{{EXPORT}}
</export>

## Bewusst entfernte Blöcke
Diese Block-IDs wurden absichtlich NICHT lokalisiert (dynamische Abschnitte wie Produktvorschläge und interaktive Tools, die im Zielmarkt anders oder nicht vorhanden sein können): {{REMOVED_BLOCK_IDS}}
Sie sind KEIN Befund und dürfen nicht als „fehlender Inhalt“ gemeldet werden.

## Prüfauftrag
1. Nimm die blockierenden Befunde aus dem Check auf: Liefere für jeden blockierenden Befund einen konkreten "patch" (vollständiger korrigierter Blockinhalt), sofern eine Korrektur sicher möglich ist. Ist keine sichere Korrektur möglich, beschreibe ihn als "quelle" bzw. Hinweis mit klarer Empfehlung.
2. Ergänze anschließend nur NEUE Vorschläge, die der Check nicht bereits abdeckt:
   - Inhaltliche Verbesserungen (unpräzise, missverständlich, veraltet, redundant oder für den Zielmarkt unpassend).
   - Fehlende Zielmarkt-Quellen (lokale Entsprechung für einen deutschen Bezug, z. B. Gesetz/Behörde/Organisation/Studie).
3. Vermeide Duplikate zum Check: Ein Befund, der dort bereits steht, wird nicht erneut als eigener Vorschlag gemeldet – du arbeitest ihn als patch ab.

## Regeln
- Interne Links (hreflang- und semantische Links) sind NICHT Gegenstand.
- Bewusst entfernte Blöcke (siehe oben) nicht als fehlend melden.
- Kein Webzugriff: Für "quelle"-Vorschläge beschreibst du die fehlende Quelle als Freitext (z. B. „Verweis auf die österreichische Tierschutzverordnung“) – erfinde KEINE URLs.
- Nur echte, vertretbare Vorschläge; keine reinen Stilvorlieben. Ohne Vorschläge: {"proposals":[]}.
- "block_id": die ID aus dem Original, auf die sich der Vorschlag bezieht – oder null bei dokumentweiten/Meta-Vorschlägen.
- "patch": nur wenn du eine konkrete Korrektur sicher angeben kannst – der VOLLSTÄNDIGE korrigierte Blockinhalt in derselben Form wie im Original:
  - heading, paragraph, quote → {"text":"…"}
  - list → {"items":[…]} (gleiche Anzahl und Verschachtelung)
  - table → {"rows":[[…]]} (gleiche Zeilen- und Spaltenzahl)
  Keine Struktur ändern, kein Markdown außer **fett** und *kursiv*, keine Zeilenumbrüche. Sonst "patch": null.

## Format (exakt dieses JSON)
{"proposals":[{"kind":"verbesserung","block_id":"b7","title":"Kurztitel","problem":"Was ist falsch/unpräzise?","suggestion":"Empfehlung bzw. fehlende Quelle","patch":{"text":"korrigierter Volltext"}},{"kind":"quelle","block_id":null,"title":"Kurztitel","problem":"Welche lokale Quelle fehlt?","suggestion":"Empfehlung als Freitext","patch":null}]}

Antworte ausschließlich mit gültigem JSON.$usr$,
  variables = '["QUELL_URL","ORIGINAL","EXPORT","ZIELSPRACHE","ZIELMARKT","brand","FINDINGS","REMOVED_BLOCK_IDS","CHECK_BRIEFING"]'::jsonb,
  version = 2,
  updated_at = now()
WHERE step_key = 'improvement_proposals' AND version = 1;

-- ---------------------------------------------------------------------------
-- Versionshistorie (Eintrag für die aktuelle Version, falls noch nicht vorhanden)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key = 'improvement_proposals'
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );
