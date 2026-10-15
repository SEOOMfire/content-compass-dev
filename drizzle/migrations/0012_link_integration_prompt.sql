-- ============================================================
-- 0012_link_integration_prompt.sql – Prompt für Schritt 5 (Interner Link, hreflang)
-- Der Code prüft die internen Links der deutschen Quelle auf ein hreflang-Pendant für
-- das Zielland und lässt den ersten Treffer genau einmal in den lokalisierten Block
-- setzen. Der Code übernimmt die Antwort nur, wenn genau ein neuer Link auf die
-- vorgegebene URL entsteht und der übrige Text unverändert bleibt. Idempotent.
-- ============================================================

INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'link_integration',
  '5 · Interner Link (hreflang)',
  'Setzt den gefundenen internen Link für das Zielland genau einmal in den lokalisierten Block. Der Code prüft, dass nur der Link ergänzt wurde.',
  $sys$Du bist muttersprachliche:r Redakteur:in für {{language}} ({{language_variant}}). Du setzt einen vorgegebenen internen Link in einen fertigen Text, ohne den Text zu verändern. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$In einem lokalisierten Ratgeberartikel für {{country}} (Marke: {{brand}}) soll genau ein interner Link gesetzt werden.

Lokalisierter Block (Zieltext, {{language}}):
<ziel>{{target_block}}</ziel>

Deutscher Quellblock, in dem der Link ursprünglich stand:
<quelle>{{source_block}}</quelle>
Ankertext des Links in der Quelle: „{{anchor_de}}“

Link-URL für {{country}}: {{target_url}}

<korrekturhinweise>{{correction_notes}}</korrekturhinweise>

AUFGABE:
1. Finde im Zieltext die Stelle, die dem deutschen Ankertext „{{anchor_de}}“ entspricht. Gibt es keine genaue Entsprechung, wähle eine kurze, inhaltlich passende Wortgruppe (2–6 Wörter) im selben Block.
2. Mache genau diese Wortgruppe zum Markdown-Link: [Wortgruppe]({{target_url}}).
3. Verändere sonst NICHTS: kein Wort ergänzen, entfernen oder umstellen; **fett** und *kursiv* bleiben, wie sie sind. Die URL übernimmst du exakt.
4. Genau ein Link, nie mehr. Kein Link in einem anderen Listenpunkt als dem passenden.
5. Gleiche Form wie der Zieltext:
   - paragraph/quote → {"text":"…"}
   - list → {"items":[…]} mit exakt derselben Anzahl und Verschachtelung; ein Listenpunkt mit Unterliste wird zu {"text":"…","children":[…]}, sonst ist er ein String.
6. Ist <korrekturhinweise> nicht leer, wurde ein vorheriger Versuch abgelehnt. Behebe genau diese Punkte.

Antworte nur mit JSON:
{"text":"… [Wortgruppe]({{target_url}}) …"}$usr$,
  'gpt-4o', 0.1, 2000, NULL, 'json',
  '["country","language","language_variant","brand","target_block","source_block","anchor_de","target_url","correction_notes"]'::jsonb,
  1, true, 4
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Versionshistorie (Eintrag für die aktuelle Version, falls noch nicht vorhanden)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key = 'link_integration'
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );
