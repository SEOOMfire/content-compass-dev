-- ============================================================
-- 0022_semantic_keywords_max3.sql – Prompt für Schritt 6
-- Ankertexte (Keywords) auf maximal 3 Wörter begrenzen.
-- Idempotent (replace + version bump).
-- ============================================================

UPDATE public.prompt_templates
SET user_prompt = replace(user_prompt, '2–6 Wörter', 'maximal 3 Wörter'),
    version = version + 1,
    updated_at = now()
WHERE step_key = 'semantic_link_keywords'
  AND user_prompt LIKE '%2–6 Wörter%';

-- ---------------------------------------------------------------------------
-- Versionshistorie (Eintrag für die aktuelle Version, falls noch nicht vorhanden)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key = 'semantic_link_keywords'
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );
