-- ============================================================
-- 0013_content_pages.sql – semantische interne Verlinkung (Schritt 6)
-- Neue Tabelle public.content_pages (Ziel-Index für semantische Links),
-- pgvector-Ähnlichkeits-RPC public.match_content_pages und Prompt
-- semantic_link_keywords. Nur additiv und idempotent. Die Altlast
-- url_index bleibt unangetastet. NUR gegen die DEV-DB (pgvector) –
-- ein Prod-Rollout ist außerhalb dieses Plans.
-- ============================================================

create extension if not exists vector with schema extensions;

create table if not exists public.content_pages (
  id              bigint generated always as identity primary key,
  url             text not null unique,
  market_id       uuid not null references public.markets(id) on delete cascade,
  country         text not null,             -- 'ch'  (aus markets.locale fr-CH)
  language        text not null,             -- 'fr'
  content_type    text not null default 'ratgeber',  -- 'ratgeber' | 'hub'
  title           text,
  h1              text,
  meta_description text,
  content_payload text not null,             -- H1 + Meta + H2/H3 + Fließtext (TOAST-komprimiert)
  content_hash    text not null,             -- sha256(payload) → Re-Embedding nur bei Änderung
  embedding       extensions.halfvec(1536) not null,
  embedding_model text not null,
  sitemap_lastmod date,
  http_status     int,
  is_active       boolean not null default true,     -- nicht mehr in Sitemap → false
  last_crawled_at timestamptz not null default now()
);

create index if not exists content_pages_filter_idx
  on public.content_pages (country, language, content_type) where is_active;

create index if not exists content_pages_embedding_hnsw
  on public.content_pages using hnsw (embedding extensions.halfvec_cosine_ops);

alter table public.content_pages enable row level security;  -- keine Policies: nur service_role

-- ---------------------------------------------------------------------------
-- RPC: nächstgelegene Zielseiten eines Markts. Wird ausschließlich über
-- supabaseAdmin (service_role) aufgerufen; für anon/authenticated entzogen.
-- ---------------------------------------------------------------------------
create or replace function public.match_content_pages(
  query_embedding extensions.halfvec,
  p_country text,
  p_language text,
  p_match_count int default 20,
  p_content_types text[] default array['ratgeber']::text[],
  p_exclude_urls text[] default array[]::text[]
)
returns table (
  url text,
  title text,
  content_payload text,
  similarity double precision
)
language sql
stable
as $$
  select
    cp.url,
    cp.title,
    cp.content_payload,
    1 - (cp.embedding <=> query_embedding) as similarity
  from public.content_pages cp
  where cp.is_active
    and cp.country = p_country
    and cp.language = p_language
    and cp.content_type = any(p_content_types)
    and cp.url <> all(p_exclude_urls)
  order by cp.embedding <=> query_embedding
  limit p_match_count;
$$;

revoke execute on function public.match_content_pages(extensions.halfvec, text, text, int, text[], text[])
  from anon, authenticated;
grant execute on function public.match_content_pages(extensions.halfvec, text, text, int, text[], text[])
  to service_role;

-- ---------------------------------------------------------------------------
-- Suchoptionen der Funktion: höhere Recall bei gefiltertem HNSW. hnsw.ef_search
-- existiert seit pgvector 0.5, hnsw.iterative_scan erst ab 0.8. Fehler beim
-- Setzen (z. B. ältere pgvector-Version) brechen die Migration nicht ab.
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
begin
  select extversion into v from pg_extension where extname = 'vector';
  if v is not null then
    begin
      execute 'alter function public.match_content_pages(extensions.halfvec, text, text, int, text[], text[]) set hnsw.ef_search = 100';
    exception when others then
      raise notice 'hnsw.ef_search konnte nicht gesetzt werden: %', sqlerrm;
    end;
    begin
      if (string_to_array(v, '.')::int[]) >= array[0,8,0] then
        execute 'alter function public.match_content_pages(extensions.halfvec, text, text, int, text[], text[]) set hnsw.iterative_scan = ''relaxed_order''';
      end if;
    exception when others then
      raise notice 'hnsw.iterative_scan konnte nicht gesetzt werden: %', sqlerrm;
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Prompt für Schritt 6: geeignete Ankertexte (Keywords) + Suchintention aus
-- den verlinkbaren Blöcken. Produkt-/Kategoriebegriffe werden ausgeschlossen.
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'semantic_link_keywords',
  '6 · Semantische Links (Keywords)',
  'Wählt für die semantische Verlinkung geeignete Ankertexte (Keywords) mit Suchintention aus den verlinkbaren Blöcken. Produkt-/Kategoriebegriffe werden ausgeschlossen.',
  $sys$Du bist SEO-Redakteur:in für internationale Heimtier-Marken. Du wählst in lokalisierten Ratgebertexten geeignete Ankertexte für weiterführende interne Links aus. Du übersetzt und veränderst nichts. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$Für einen lokalisierten Ratgeberartikel für {{country}} ({{language}}, {{language_variant}}) sollen weiterführende interne Links gesetzt werden. Marke: {{brand}}.

Zu prüfende Blöcke (eine JSON-Zeile pro Block, "id" = Block-ID):
<bloecke>
{{blocks}}
</bloecke>

AUFGABE:
- Wähle für höchstens 10 Blöcke genau ein Keyword (Ankertext) und eine Suchintention.
- "keyword" ist ein kurzer, wörtlich im Block vorkommender Ausdruck (2–6 Wörter) in {{language}}, der sich als Linktext für einen weiterführenden Ratgeber eignet (z. B. „Fellpflege beim Hund“, „Ernährung von Welpen“).
- "intent" beschreibt in einem Satz auf Deutsch, welche Frage ein weiterführender Artikel beantworten soll.
- Keine Produkt-, Kategorie- oder Shop-Begriffe (z. B. Markenprodukte, „im Shop“, „Angebote“), keine Überschriften als Anker, keine reinen Navigationswörter.
- Genau ein Keyword pro Block. Lasse Blöcke ohne passendes Keyword aus. Ohne passende Blöcke: {"keywords":[]}.

Antworte nur mit JSON:
{"keywords":[{"block_id":"b2","keyword":"Fellpflege beim Hund","intent":"Wie pflegt man das Fell eines Hundes richtig?"}]}$usr$,
  'gpt-4o', 0.2, 4000, NULL, 'json',
  '["country","language","language_variant","brand","blocks"]'::jsonb,
  1, true, 5
)
ON CONFLICT (step_key) DO NOTHING;

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
