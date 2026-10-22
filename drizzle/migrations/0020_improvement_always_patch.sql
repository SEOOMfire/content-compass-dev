-- ============================================================
-- 0020_improvement_always_patch.sql – Prompt v4 für Schritt 8
-- "verbesserung"-Vorschläge müssen immer einen konkreten, vollständig
-- korrigierten Blockinhalt ("patch") mitliefern, damit der Nutzer den
-- besseren Vorschlag direkt übernehmen (oder anpassen) kann.
-- Idempotent.
-- ============================================================

UPDATE public.prompt_templates SET
  user_prompt = $usr$# Verbesserungen & Quellen

Analysiere den lokalisierten Zieltext gegen das deutsche Original und schlage gezielte inhaltliche Verbesserungen sowie Hinweise zu externen Quellen vor. Du änderst keinen Text; dein Ergebnis ist ausschließlich die JSON-Liste mit Vorschlägen.

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

## Externe Quellen im Original
Diese externen Quellen (Block-ID, Ankertext, URL) werden im Original je Block genutzt:
<externe_quellen>
{{EXTERNAL_SOURCES}}
</externe_quellen>
Ein "quelle"-Vorschlag ist NUR für Blöcke erlaubt, die in dieser Liste stehen – also dort, wo das Original bereits eine externe Quelle nutzt.

## Lokalisierter Export (Zieltext)
<export>
{{EXPORT}}
</export>

## Bewusst entfernte Blöcke
Diese Block-IDs wurden absichtlich NICHT lokalisiert (dynamische Abschnitte wie Produktvorschläge und interaktive Tools, die im Zielmarkt anders oder nicht vorhanden sein können): {{REMOVED_BLOCK_IDS}}
Sie sind KEIN Befund und dürfen nicht als „fehlender Inhalt“ gemeldet werden.

## Prüfauftrag
1. Nimm die blockierenden Befunde aus dem Check auf: Liefere für jeden blockierenden Befund einen konkreten "patch" (vollständiger korrigierter Blockinhalt). Ist keine sichere Korrektur möglich, beschreibe ihn als "quelle" bzw. Hinweis mit klarer Empfehlung.
2. Ergänze anschließend nur NEUE Vorschläge, die der Check nicht bereits abdeckt:
   - Inhaltliche Verbesserungen ("verbesserung"): unpräzise, missverständlich, veraltet, redundant oder für den Zielmarkt unpassend. Liefere IMMER einen konkreten "patch" mit dem vollständig korrigierten Blockinhalt – keinen Verbesserungsvorschlag ohne "patch".
   - Externe Quellen ("quelle"): NUR für Blöcke, die laut „Externe Quellen im Original“ bereits eine externe Quelle nutzen und deren Quelle für den Zielmarkt ersetzt/geprüft werden sollte. Erfinde KEINE neuen Quellen und schlage KEINE Quellen für Blöcke ohne externe Quelle im Original vor.
3. Vermeide Duplikate zum Check: Ein Befund, der dort bereits steht, wird nicht erneut als eigener Vorschlag gemeldet – du arbeitest ihn als patch ab.

## Regeln
- Interne Links (hreflang- und semantische Links) sind NICHT Gegenstand.
- Bewusst entfernte Blöcke (siehe oben) nicht als fehlend melden.
- Kein Webzugriff: Für "quelle"-Vorschläge beschreibst du die fehlende/zu prüfende Quelle als Freitext – erfinde KEINE URLs.
- Nur echte, vertretbare Vorschläge; keine reinen Stilvorlieben. Ohne Vorschläge: {"proposals":[]}.
- "block_id": die ID aus dem Original, auf die sich der Vorschlag bezieht – oder null bei dokumentweiten/Meta-Vorschlägen.
- "patch": "verbesserung" → Pflicht (vollständig korrigierter Blockinhalt). "quelle" → immer null. Inhalt in derselben Form wie im Original:
  - heading, paragraph, quote → {"text":"…"}
  - list → {"items":[…]} (gleiche Anzahl und Verschachtelung)
  - table → {"rows":[[…]]} (gleiche Zeilen- und Spaltenzahl)
  Keine Struktur ändern, kein Markdown außer **fett** und *kursiv*, keine Zeilenumbrüche.

## Format (exakt dieses JSON)
{"proposals":[{"kind":"verbesserung","block_id":"b7","title":"Kurztitel","problem":"Was ist falsch/unpräzise?","suggestion":"Empfehlung","patch":{"text":"korrigierter Volltext"}},{"kind":"quelle","block_id":"b12","title":"Kurztitel","problem":"Welche externe Quelle aus dem Original ist für den Zielmarkt zu prüfen/ersetzen?","suggestion":"Empfehlung als Freitext","patch":null}]}

Antworte ausschließlich mit gültigem JSON.$usr$,
  version = 4,
  updated_at = now()
WHERE step_key = 'improvement_proposals' AND version = 3;

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
