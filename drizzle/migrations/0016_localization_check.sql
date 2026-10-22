-- ============================================================
-- 0016_localization_check.sql – Prompt für Schritt 7 (Lokalisierungs-Check)
-- Der Schritt vergleicht den lokalisierten Export gegen das Original und
-- erstellt ein Markdown-Briefing. Er verändert keinen Text und blockiert nie.
-- Das Modell antwortet als Rohtext (response_format 'text'), da runPrompt
-- keinen Webzugriff hat und das Original als Blockliste ({{ORIGINAL}}) mitgegeben
-- wird. Idempotent.
-- ============================================================

INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'localization_check',
  '7 · Lokalisierungs-Check',
  'Vergleicht den lokalisierten Zieltext gegen das deutsche Original und erstellt ein Briefing mit blockierenden Funden und Hinweisen. Ändert keinen Text.',
  $sys$Du bist erfahrene:r Lokalisierungs- und Qualitätssicherungs-Redakteur:in für internationale Heimtier-Marken. Du prüfst einen lokalisierten Zieltext gegen das deutsche Original. Du veränderst den Text nicht, sondern erstellst ausschließlich ein Markdown-Briefing.$sys$,
  $usr$# Lokalisierungs-Check

Prüfe den lokalisierten Zieltext gegen das deutsche Original. Du änderst keinen Text; dein Ergebnis ist ausschließlich das Briefing im unten vorgegebenen Format.

## Eckdaten
- Quell-URL: {{QUELL_URL}}
- Zielsprache: {{ZIELSPRACHE}}
- Zielmarkt: {{ZIELMARKT}}
- Marke: {{brand}}

## Original (deutsche Quelle, Blockliste)
<original>
{{ORIGINAL}}
</original>

## Lokalisierter Export (Zieltext)
<export>
{{EXPORT}}
</export>

## Ausnahmen – nicht zu prüfen
Diese Bereiche der Quelle werden technisch entfernt und dürfen im Zieltext fehlen:
<ausnahmen>
{{AUSNAHMEN}}
</ausnahmen>

## Prüfauftrag
Vergleiche Original und Zieltext und melde Funde. Prüfe insbesondere:

1. Vollständigkeit: Fehlen im Zieltext Absätze, Listenpunkte, Tabellen oder Überschriften, die im Original stehen (außer den unter „Ausnahmen“ genannten Bereichen)?
2. Korrekte Lokalisierung: Wurden deutschlandspezifische Bezüge (Behörden, Gesetze, Organisationen, Services, Währungen, Einheiten, Angebote) richtig auf {{ZIELMARKT}} übertragen oder neutral gestrichen? Stehen noch deutsche Bezüge im Text?
3. Marke: Ist die Schreibweise der Marke „{{brand}}“ korrekt und einheitlich?
4. Sprache: Entspricht der Text der Zielsprache {{ZIELSPRACHE}}? Enthält er noch deutsche Formulierungen?
5. Aussagentreue: Wurden Aussagen ergänzt, verfälscht oder unzulässig verallgemeinert?
6. Struktur: Stimmen Reihenfolge, Überschriften-Ebenen, Listen und Tabellen mit dem Original überein?

## Klassifizierung
- „Blockierend“ = Fehler, der vor der Veröffentlichung korrigiert werden muss (z. B. fehlender Inhalt, falsche Aussage, verbliebener DE-Bezug, falsche Marke).
- „Hinweise“ = Verbesserungsvorschläge ohne Korrekturpflicht.
- Interne Links (hreflang- und semantische Links) sind NICHT Gegenstand der Prüfung.

## Format (exakt dieses Markdown)
# Lokalisierungs-Check: <Titel des Zieltexts>

## Quelle
- URL: {{QUELL_URL}}
- abgerufen: ja

### Blockierend
Nummerierte Liste; jeder Fund nennt das Problem, die Stelle (Block-ID bzw. Abschnitt) und ein wörtliches Zitat aus dem Zieltext. Ohne Funde: „Keine Funde“.

### Hinweise
Nummerierte Liste; jeder Fund nennt das Problem, die Stelle (Block-ID bzw. Abschnitt) und ein wörtliches Zitat aus dem Zieltext. Ohne Funde: „Keine Funde“.

Antworte ausschließlich mit diesem Briefing – ohne weiteren Text davor oder danach.$usr$,
  'gpt-4o', 0.1, 4000, NULL, 'text',
  '["QUELL_URL","ORIGINAL","EXPORT","ZIELSPRACHE","ZIELMARKT","brand","AUSNAHMEN"]'::jsonb,
  1, true, 6
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Versionshistorie (Eintrag für die aktuelle Version, falls noch nicht vorhanden)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key = 'localization_check'
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );
