-- ============================================================
-- 0017_improvement_proposals.sql – Prompt für Schritt 8 (Verbesserungen & Quellen)
-- Die KI analysiert Original und Zieltext und schlägt inhaltliche
-- Verbesserungen sowie fehlende Zielmarkt-Quellen vor. Sie ändert keinen Text –
-- die Vorschläge werden gespeichert und erst nach Bestätigung angewendet.
-- Ohne externe API: "quelle"-Vorschläge sind Freitext, keine erfundenen URLs.
-- Idempotent.
-- ============================================================

INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'improvement_proposals',
  '8 · Verbesserungen & Quellen',
  'Analysiert den lokalisierten Zieltext und schlägt inhaltliche Verbesserungen sowie fehlende Zielmarkt-Quellen vor. Änderungen werden erst nach Bestätigung angewendet.',
  $sys$Du bist erfahrene:r Content- und Lokalisierungsredakteur:in für internationale Heimtier-Marken. Du analysierst einen lokalisierten Zieltext gegen das deutsche Original und schlägst inhaltliche Verbesserungen sowie fehlende Zielmarkt-Quellen vor. Du änderst den Text nicht selbst – du lieferst ausschließlich Vorschläge als JSON.$sys$,
  $usr$# Verbesserungen & Quellen

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
Suche nach:
1. Inhaltliche Verbesserungen: Stellen, an denen der Zieltext unpräzise, missverständlich, inhaltlich veraltet, redundant oder für den Zielmarkt unpassend ist – und wo eine konkrete Umformulierung den Text verbessert.
2. Fehlende Zielmarkt-Quellen: Stellen, an denen das Original einen deutschlandspezifischen Bezug (Gesetz, Behörde, Organisation, Studie, Service) enthält, der für den Zielmarkt durch eine lokale Entsprechung ersetzt oder ergänzt werden sollte – oder an denen ein relevanter lokaler Beleg sinnvoll wäre.

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
  'gpt-4o', 0.2, 4000, NULL, 'json',
  '["QUELL_URL","ORIGINAL","EXPORT","ZIELSPRACHE","ZIELMARKT","brand","FINDINGS","REMOVED_BLOCK_IDS"]'::jsonb,
  1, true, 7
)
ON CONFLICT (step_key) DO NOTHING;

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
