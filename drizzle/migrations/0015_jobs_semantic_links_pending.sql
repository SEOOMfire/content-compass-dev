-- ============================================================
-- 0015_jobs_semantic_links_pending.sql – Übersichts-Badge für Schritt 6
-- Zähler offener (≥ 80 %, noch nicht übernommener) semantischer Links je Job.
-- Wird von der Pipeline geschrieben: Schritt 6 setzt die Anzahl eligible
-- Keywords, „Übernehmen“ setzt den Zähler auf 0. Idempotent.
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS semantic_links_pending integer NOT NULL DEFAULT 0;
