-- ============================================================
-- 0021_improvement_sources_only.sql – Prompt v5 für Schritt 8
-- Entfernt den "Verbesserungsprozess" komplett: Schritt 8 erzeugt
-- nur noch "quelle"-Vorschläge (dort, wo das Original bereits eine
-- externe Quelle nutzt). Idempotent.
-- ============================================================

UPDATE public.prompt_templates SET
  system_prompt = $sys$Du bist erfahrene:r Content- und Lokalisierungsredakteur:in für internationale Heimtier-Marken. Du analysierst einen lokalisierten Zieltext gegen das deutsche Original und schlägst für externe Quellen im Original passende Zielmarkt-Quellen vor. Du änderst den Text nicht selbst – du lieferst ausschließlich Vorschläge als JSON.$sys$,
  user_prompt = $usr$# Quellen für den Zielmarkt

Analysiere den lokalisierten Zieltext gegen das deutsche Original und schlage für Blöcke, die im Original eine externe Quelle nutzen, eine zu prüfende oder zu ersetzende Zielmarkt-Quelle vor. Du änderst keinen Text; dein Ergebnis ist ausschließlich die JSON-Liste.

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
Für jede externe Quelle im Original, die für den Zielmarkt ersetzt oder geprüft werden sollte, erstelle einen "quelle"-Vorschlag:
- block_id: die ID des Blocks aus dem Original.
- title: Kurztitel.
- problem: Welche externe Quelle aus dem Original ist für den Zielmarkt zu prüfen/ersetzen?
- suggestion: Empfehlung als Freitext – welche Art lokaler Quelle/Behörde/Verband wäre passend?
- patch: immer null.

Erfinde KEINE neuen Quellen und schlage KEINE Quellen für Blöcke ohne externe Quelle im Original vor.

## Regeln
- Interne Links (hreflang- und semantische Links) sind NICHT Gegenstand.
- Bewusst entfernte Blöcke (siehe oben) nicht als fehlend melden.
- Kein Webzugriff: keine erfundenen URLs.
- Nur echte, vertretbare Vorschläge. Ohne Vorschläge: {"proposals":[]}.

## Format (exakt dieses JSON)
{"proposals":[{"kind":"quelle","block_id":"b12","title":"Kurztitel","problem":"Welche externe Quelle aus dem Original ist zu prüfen/ersetzen?","suggestion":"Empfehlung als Freitext","patch":null}]}

Antworte ausschließlich mit gültigem JSON.$usr$,
  version = 5,
  updated_at = now()
WHERE step_key = 'improvement_proposals' AND version = 4;

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
