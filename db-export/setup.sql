-- ============================================================
-- setup.sql – vollstaendiger Nachbau der Datenbank
-- Quelle: Supabase-Projekt vjajpeuxefjxxmluffbe (Schema public)
-- Erzeugt aus pg_dump der echten Datenbank.
-- Ausfuehren im SQL-Editor eines LEEREN Supabase-Projekts.
-- Die Datei ist idempotent (mehrfaches Ausfuehren ist unschaedlich).
-- ============================================================

-- ============================================================
-- 1. Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 2. Enum-Typen
-- ============================================================

DO $do$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;


-- ============================================================
-- 3. Tabellen
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    step_key text NOT NULL,
    step_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    input jsonb,
    output jsonb,
    prompt_snapshot text,
    model text,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    error text,
    run_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    prompt_vars jsonb
);

CREATE TABLE IF NOT EXISTS public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_url text NOT NULL,
    market_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    current_step text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.link_pool (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    content_type text DEFAULT 'magazine'::text NOT NULL,
    source_page text NOT NULL,
    url text NOT NULL,
    anchor_text text,
    path_type text DEFAULT 'other'::text NOT NULL,
    origin text DEFAULT 'hub'::text NOT NULL,
    http_status integer,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    fetched boolean DEFAULT true NOT NULL,
    intent text,
    scope text DEFAULT 'target'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.market_paths (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    de_segment text NOT NULL,
    target_segment text NOT NULL,
    origin text DEFAULT 'manual'::text NOT NULL,
    http_status integer,
    confirmed_at timestamp with time zone,
    sample_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.markets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country text NOT NULL,
    language text NOT NULL,
    locale text,
    domain text NOT NULL,
    path_prefix text DEFAULT '/'::text NOT NULL,
    brand text NOT NULL,
    language_variant text DEFAULT ''::text NOT NULL,
    magazine_root text DEFAULT ''::text NOT NULL,
    category_root text DEFAULT ''::text NOT NULL,
    path_map jsonb DEFAULT '{}'::jsonb NOT NULL,
    institutions jsonb DEFAULT '{}'::jsonb NOT NULL,
    forbidden_claims jsonb DEFAULT '[]'::jsonb NOT NULL,
    address_form text,
    closing_note text,
    crawl_delay_ms integer DEFAULT 800 NOT NULL,
    index_last_run timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    search_url_pattern text,
    localization_notes text
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.prompt_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    step_key text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    system_prompt text DEFAULT ''::text NOT NULL,
    user_prompt text DEFAULT ''::text NOT NULL,
    model text DEFAULT 'gpt-4o-mini'::text NOT NULL,
    temperature numeric DEFAULT 0.4 NOT NULL,
    max_tokens integer DEFAULT 4000 NOT NULL,
    reasoning_effort text,
    response_format text DEFAULT 'json'::text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.prompt_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    version integer NOT NULL,
    system_prompt text DEFAULT ''::text NOT NULL,
    user_prompt text DEFAULT ''::text NOT NULL,
    model text,
    temperature numeric,
    max_tokens integer,
    reasoning_effort text,
    response_format text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);

CREATE TABLE IF NOT EXISTS public.style_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    content_type text DEFAULT 'magazine'::text NOT NULL,
    profile jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.url_index (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    url text NOT NULL,
    path_type text DEFAULT 'unknown'::text NOT NULL,
    h1 text,
    title text,
    meta_description text,
    breadcrumb text,
    intro_text text,
    http_status integer,
    canonical text,
    last_seen timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.verified_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    anchor text NOT NULL,
    target_url text NOT NULL,
    http_status integer,
    canonical_ok boolean DEFAULT false NOT NULL,
    confidence text,
    source text DEFAULT 'index'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    summary text,
    page_type text
);


-- ============================================================
-- 4. Primaer-/Unique-Constraints
-- ============================================================

DO $do$ BEGIN
  ALTER TABLE ONLY public.job_steps
      ADD CONSTRAINT job_steps_job_id_step_key_key UNIQUE (job_id, step_key);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.job_steps
      ADD CONSTRAINT job_steps_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.jobs
      ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.link_pool
      ADD CONSTRAINT link_pool_market_id_content_type_url_key UNIQUE (market_id, content_type, url);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.link_pool
      ADD CONSTRAINT link_pool_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.market_paths
      ADD CONSTRAINT market_paths_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.markets
      ADD CONSTRAINT markets_country_language_key UNIQUE (country, language);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.markets
      ADD CONSTRAINT markets_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.profiles
      ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.prompt_templates
      ADD CONSTRAINT prompt_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.prompt_templates
      ADD CONSTRAINT prompt_templates_step_key_key UNIQUE (step_key);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.prompt_versions
      ADD CONSTRAINT prompt_versions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.style_profiles
      ADD CONSTRAINT style_profiles_market_id_content_type_key UNIQUE (market_id, content_type);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.style_profiles
      ADD CONSTRAINT style_profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.url_index
      ADD CONSTRAINT url_index_market_id_url_key UNIQUE (market_id, url);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.url_index
      ADD CONSTRAINT url_index_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.user_roles
      ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.user_roles
      ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.verified_links
      ADD CONSTRAINT verified_links_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;


-- ============================================================
-- 5. Indexe
-- ============================================================

CREATE INDEX IF NOT EXISTS jobs_created_idx ON public.jobs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS link_pool_market_idx ON public.link_pool USING btree (market_id, content_type, fetched_at DESC);

CREATE INDEX IF NOT EXISTS link_pool_scope_idx ON public.link_pool USING btree (market_id, scope, fetched);

CREATE INDEX IF NOT EXISTS market_paths_market_idx ON public.market_paths USING btree (market_id);

CREATE UNIQUE INDEX IF NOT EXISTS market_paths_market_segment_key ON public.market_paths USING btree (market_id, de_segment);

CREATE INDEX IF NOT EXISTS url_index_market_idx ON public.url_index USING btree (market_id);

CREATE INDEX IF NOT EXISTS url_index_search_idx ON public.url_index USING gin (to_tsvector('simple'::regconfig, ((((((COALESCE(h1, ''::text) || ' '::text) || COALESCE(title, ''::text)) || ' '::text) || COALESCE(meta_description, ''::text)) || ' '::text) || COALESCE(url, ''::text))));

CREATE INDEX IF NOT EXISTS url_index_status_idx ON public.url_index USING btree (market_id, http_status);


-- ============================================================
-- 6. Fremdschluessel
-- ============================================================

DO $do$ BEGIN
  ALTER TABLE ONLY public.job_steps
      ADD CONSTRAINT job_steps_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.jobs
      ADD CONSTRAINT jobs_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.link_pool
      ADD CONSTRAINT link_pool_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.market_paths
      ADD CONSTRAINT market_paths_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.prompt_versions
      ADD CONSTRAINT prompt_versions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.prompt_templates(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.style_profiles
      ADD CONSTRAINT style_profiles_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.url_index
      ADD CONSTRAINT url_index_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ONLY public.verified_links
      ADD CONSTRAINT verified_links_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;


-- ============================================================
-- 7. Funktionen
-- ============================================================

CREATE OR REPLACE FUNCTION public.grant_first_user_admin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


-- ============================================================
-- 8. Trigger auf auth.users
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_first_user_admin();


-- ============================================================
-- 9. Row Level Security aktivieren
-- ============================================================

ALTER TABLE public.job_steps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.link_pool ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.market_paths ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.style_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.url_index ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.verified_links ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 10. Policies
-- ============================================================

DROP POLICY IF EXISTS "Authenticated can read link pool" ON public.link_pool;
CREATE POLICY "Authenticated can read link pool" ON public.link_pool FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "job steps read" ON public.job_steps;
CREATE POLICY "job steps read" ON public.job_steps FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = job_steps.job_id) AND ((j.created_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role))))));

DROP POLICY IF EXISTS "jobs delete admin" ON public.jobs;
CREATE POLICY "jobs delete admin" ON public.jobs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "jobs insert own" ON public.jobs;
CREATE POLICY "jobs insert own" ON public.jobs FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));

DROP POLICY IF EXISTS "jobs read" ON public.jobs;
CREATE POLICY "jobs read" ON public.jobs FOR SELECT TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "jobs update own" ON public.jobs;
CREATE POLICY "jobs update own" ON public.jobs FOR UPDATE TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "market paths admin write" ON public.market_paths;
CREATE POLICY "market paths admin write" ON public.market_paths TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "market paths read" ON public.market_paths;
CREATE POLICY "market paths read" ON public.market_paths FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "markets admin write" ON public.markets;
CREATE POLICY "markets admin write" ON public.markets TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "markets read" ON public.markets;
CREATE POLICY "markets read" ON public.markets FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid()));

DROP POLICY IF EXISTS "prompt versions admin only" ON public.prompt_versions;
CREATE POLICY "prompt versions admin only" ON public.prompt_versions TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "prompts admin only" ON public.prompt_templates;
CREATE POLICY "prompts admin only" ON public.prompt_templates TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "roles readable by authenticated" ON public.user_roles;
CREATE POLICY "roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "style profiles read" ON public.style_profiles;
CREATE POLICY "style profiles read" ON public.style_profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "url index admin write" ON public.url_index;
CREATE POLICY "url index admin write" ON public.url_index TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "url index read" ON public.url_index;
CREATE POLICY "url index read" ON public.url_index FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "verified links read" ON public.verified_links;
CREATE POLICY "verified links read" ON public.verified_links FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = verified_links.job_id) AND ((j.created_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role))))));


-- ============================================================
-- 11. Grants
-- ============================================================

GRANT ALL ON FUNCTION public.grant_first_user_admin() TO anon;

GRANT ALL ON FUNCTION public.grant_first_user_admin() TO authenticated;

GRANT ALL ON FUNCTION public.grant_first_user_admin() TO service_role;

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;

GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO anon;

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;

GRANT ALL ON TABLE public.job_steps TO anon;

GRANT ALL ON TABLE public.job_steps TO authenticated;

GRANT ALL ON TABLE public.job_steps TO service_role;

GRANT ALL ON TABLE public.jobs TO anon;

GRANT ALL ON TABLE public.jobs TO authenticated;

GRANT ALL ON TABLE public.jobs TO service_role;

GRANT ALL ON TABLE public.link_pool TO anon;

GRANT ALL ON TABLE public.link_pool TO authenticated;

GRANT ALL ON TABLE public.link_pool TO service_role;

GRANT ALL ON TABLE public.market_paths TO anon;

GRANT ALL ON TABLE public.market_paths TO authenticated;

GRANT ALL ON TABLE public.market_paths TO service_role;

GRANT ALL ON TABLE public.markets TO anon;

GRANT ALL ON TABLE public.markets TO authenticated;

GRANT ALL ON TABLE public.markets TO service_role;

GRANT ALL ON TABLE public.profiles TO anon;

GRANT ALL ON TABLE public.profiles TO authenticated;

GRANT ALL ON TABLE public.profiles TO service_role;

GRANT ALL ON TABLE public.prompt_templates TO anon;

GRANT ALL ON TABLE public.prompt_templates TO authenticated;

GRANT ALL ON TABLE public.prompt_templates TO service_role;

GRANT ALL ON TABLE public.prompt_versions TO anon;

GRANT ALL ON TABLE public.prompt_versions TO authenticated;

GRANT ALL ON TABLE public.prompt_versions TO service_role;

GRANT ALL ON TABLE public.style_profiles TO anon;

GRANT ALL ON TABLE public.style_profiles TO authenticated;

GRANT ALL ON TABLE public.style_profiles TO service_role;

GRANT ALL ON TABLE public.url_index TO anon;

GRANT ALL ON TABLE public.url_index TO authenticated;

GRANT ALL ON TABLE public.url_index TO service_role;

GRANT ALL ON TABLE public.user_roles TO anon;

GRANT ALL ON TABLE public.user_roles TO authenticated;

GRANT ALL ON TABLE public.user_roles TO service_role;

GRANT ALL ON TABLE public.verified_links TO anon;

GRANT ALL ON TABLE public.verified_links TO authenticated;

GRANT ALL ON TABLE public.verified_links TO service_role;


-- ============================================================
-- 12. Seed-Daten (Stammdaten) – idempotent via ON CONFLICT DO NOTHING
-- ============================================================

-- 12.1 markets

INSERT INTO public.markets VALUES ('069d4688-4973-4608-839d-9bcfda87564f', 'Belgien', 'Französisch', 'fr-BE', 'maxizoo.be', '/fr/', 'Maxi Zoo', 'Belgisches Französisch, formeller Stil', '/fr/magazine/', '/fr/', '{"hund": "chien", "katze": "chat", "rassen": "races", "magazin": "magazine"}', '{"VDH": null, "Hundefuehrerschein": null, "Brauchbarkeitspruefung": null}', '[]', 'formell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.markets VALUES ('d92b7b68-97e1-493f-998e-45b3717e6cae', 'Belgien', 'Niederländisch', 'nl-BE', 'maxizoo.be', '/nl/', 'Maxi Zoo', 'Belgisches Niederländisch (Vlaams)', '/nl/magazine/', '/nl/', '{"hund": "hond", "katze": "kat", "rassen": "rassen", "magazin": "magazine"}', '{"VDH": null, "Hundefuehrerschein": null, "Brauchbarkeitspruefung": null}', '[]', 'informell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.markets VALUES ('76ab74dd-a8af-43f8-a2d3-67eb35f630fc', 'Österreich', 'Deutsch', 'de-AT', 'fressnapf.at', '/', 'Fressnapf', 'Österreichisches Deutsch', '/magazin/', '/', '{"hund": "hund", "katze": "katze", "rassen": "rassen", "magazin": "magazin"}', '{"VDH": "ÖKV"}', '[]', 'informell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.markets VALUES ('4e43b8be-a2ec-4077-a279-0d9b21659fa9', 'Frankreich', 'Französisch', 'fr-FR', 'maxizoo.fr', '/', 'Maxi Zoo', 'Standard-Französisch', '/magazine/', '/', '{"hund": "chien", "katze": "chat", "rassen": "races", "magazin": "magazine"}', '{"VDH": "Société Centrale Canine", "Hundefuehrerschein": null, "Brauchbarkeitspruefung": null}', '["Fressnapf"]', 'formell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.markets VALUES ('9f2fffaf-2358-471e-aa59-36fe2701be7a', 'Polen', 'Polnisch', 'pl-PL', 'maxizoo.pl', '/', 'Maxi Zoo', 'Standardpolnisch', '/magazyn/', '/', '{"hund": "pies", "katze": "kot", "rassen": "rasy", "magazin": "magazyn"}', '{"VDH": "ZKwP (Związek Kynologiczny w Polsce)", "Hundefuehrerschein": null, "Brauchbarkeitspruefung": "próby pracy / Polski Związek Łowiecki"}', '["Fressnapf"]', 'informell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.markets VALUES ('a1755b70-f2da-4e41-9897-5c2a66235fbf', 'Irland', 'Englisch', 'en-IE', 'maxizoo.ie', '/', 'Maxi Zoo', 'Irisches Englisch', '/magazine/', '/', '{"hund": "dog", "katze": "cat", "rassen": "breeds", "magazin": "magazine"}', '{"VDH": "Irish Kennel Club", "Hundefuehrerschein": null}', '["Fressnapf"]', 'informell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.markets VALUES ('50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'Schweiz', 'Französisch', 'fr-CH', 'fressnapf.ch', '/fr', 'Fressnapf', 'Schweizer Französisch', '/fr/magazine/', '/fr/', '{"hund": "chien", "katze": "chat", "rassen": "races", "magazin": "magazine"}', '{"VDH": "SCS", "Hundefuehrerschein": null}', '[]', 'formell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.markets VALUES ('33db49a9-c6d6-4aeb-949e-63cdc9b0fa67', 'Schweiz', 'Deutsch', 'de-CH', 'fressnapf.ch', '/de', 'Fressnapf', 'Schweizer Hochdeutsch, kein „ß"', '/magazin/', '/', '{"hund": "hund", "katze": "katze", "rassen": "rassen", "magazin": "magazin"}', '{"VDH": "SKG", "Hundefuehrerschein": null}', '["ß"]', 'informell', NULL, 800, NULL, true, '2026-09-03 09:03:41.16803+00', NULL) ON CONFLICT DO NOTHING;


--
--


-- 12.2 prompt_templates (einzige Quelle der Prompts – vollstaendig)

INSERT INTO public.prompt_templates VALUES ('aa13d2dd-1e34-465f-840d-2aa3055346ce', 'compare', 'S4 · Vergleich DE ↔ Ziel', 'Entscheidet, ob der bestehende Zielcontent ausreicht oder neu erstellt werden muss.', 'Du bist erfahrener SEO-Content-Analyst. Antworte ausschließlich mit gültigem JSON.', 'Vergleiche zwei Ratgeberartikel zum selben Thema.

<de_struktur>{{de_structure}}</de_struktur>
<de_wortzahl>{{de_word_count}}</de_wortzahl>
<ziel_struktur>{{target_structure}}</ziel_struktur>
<ziel_wortzahl>{{target_word_count}}</ziel_wortzahl>
<ziel_auszug>{{target_excerpt}}</ziel_auszug>

Der Zielcontent ist nur AUSREICHEND, wenn alle Bedingungen erfüllt sind:
- mindestens 300 Wörter redaktioneller Fließtext
- mehrere thematische Abschnitte mit H2/H3
- keine reine FAQ-Sammlung
- qualitativ mit der deutschen Seite vergleichbar

Antworte nur mit JSON:
{"verdict":"AUSREICHEND"|"NEU_ERSTELLEN","word_count":0,
 "missing_topics":["..."],"reason":"max. 2 Sätze"}', 'gpt-4o-mini', 0.2, 2000, NULL, 'json', '["de_structure", "de_word_count", "target_structure", "target_word_count", "target_excerpt"]', 1, true, 40, NULL, '2026-09-03 09:04:33.884925+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('e05ac10c-8246-4cfd-b553-76e2fbd125fd', 'style_profile', 'S5 · Stilprofil', 'Leitet aus Bestandsseiten des Zielmarkts ein Stilprofil ab (gecacht pro Markt und Content-Typ).', 'Du bist Sprach- und Stilanalyst. Antworte ausschließlich mit gültigem JSON.', 'Analysiere den Schreibstil dieser vorhandenen Ratgeberartikel eines Tierbedarf-Shops.

{{reference_texts}}

Antworte nur mit JSON:
{"address_form":"informell"|"formell"|"gemischt",
 "address_examples":["..."],
 "sentence_length":"kurz"|"mittel"|"lang",
 "heading_style":"Frage"|"Aussage"|"gemischt",
 "tone_notes":["max. 5 kurze Beobachtungen"],
 "recurring_phrases":["..."]}', 'gpt-4o-mini', 0.3, 2000, NULL, 'json', '["reference_texts"]', 1, true, 50, NULL, '2026-09-03 09:04:33.884925+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('57bdd23a-5d1b-4a8a-b2e7-5a5ec71d335e', 'resolve_target_slug', 'S2 · Ziel-Slug vorschlagen', 'Fallback in S2: schlägt mögliche URL-Slugs in der Zielsprache vor, wenn hreflang und Path-Map nichts liefern.', 'Du bist SEO-Spezialist für Tierbedarf-Onlineshops. Antworte ausschließlich mit gültigem JSON.', 'Zielsprache: {{language}}. Zielland: {{country}}.
Deutsches URL-Segment: "{{term}}".
Überschrift der Quellseite (nur als Kontext, nicht als Übersetzungsgrundlage): "{{h1}}".

Nenne 5 mögliche URL-Slugs in der Zielsprache, wie sie ein Tierbedarf-Onlineshop
für eine Kategorie- oder Ratgeberseite verwenden würde. Berücksichtige die
landesübliche Fachbezeichnung, nicht die wörtliche Übersetzung. Keine
Headline-Slugs mit Zusätzen wie "zuverlaessiger-bewacher".

Antworte nur mit JSON:
{"term_translated":"landesübliche Bezeichnung",
 "slug_candidates":["...","...","...","...","..."]}', 'gpt-4o-mini', 0.3, 1000, NULL, 'json', '["term", "h1", "title", "language", "country"]', 2, true, 20, NULL, '2026-09-03 10:39:08.81511+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('b51ad427-e939-4a70-aa7c-bcf54079134f', 'link_select', 'S8 · Linkauswahl', 'Wählt aus einer nummerierten Kandidatenliste. Gibt nur Nummern zurück, niemals URLs.', 'Du wählst interne Verlinkungen aus. Du gibst niemals URLs aus, nur Nummern. Antworte ausschließlich mit gültigem JSON.', 'Wähle die beste interne Verlinkung für einen Ankertext.

<ankertext>{{anchor}}</ankertext>
<kontext>{{context_sentence}}</kontext>

<kandidaten>
{{candidates}}
</kandidaten>

Wähle nur eine Seite, deren HAUPTTHEMA dem entspricht, was der Ankertext verspricht.
Eine thematische Nachbarschaft reicht nicht: Wenn der Ankertext ein Symptom nennt,
die Seite aber eine mögliche Ursache oder eine Behandlung behandelt, ist das ein
Mismatch und du antwortest mit null. Der Nutzer muss nach dem Klick genau das finden,
was der Ankertext ankündigt.
Wenn keine Seite wirklich passt, antworte mit null. Rate nicht und wähle nicht
„die am wenigsten schlechte".

Bevorzuge spezifische redaktionelle Artikel. Kategorie- und Produktübersichtsseiten sind zu allgemein und nur zu wählen, wenn der Ankertext ausdrücklich ein Produktsortiment meint. Im Zweifel null.

Antworte nur mit JSON:
{"choice": <nummer>|null, "confidence":"hoch"|"mittel"|"niedrig", "reason":"1 Satz"}', 'gpt-4o-mini', 0.1, 1500, NULL, 'json', '["anchor", "context_sentence", "candidates"]', 3, true, 80, NULL, '2026-09-10 10:08:23.153227+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('6063ff65-72ec-40d3-9e71-647906d1ed2e', 'generate_content', 'S11 · Content erzeugen', 'Finaler Content-Schritt. Wird pro Abschnitt aus dem Lokalisierungsplan angewandt.', 'Du bist erfahrene:r Redakteur:in fuer Tierratgeber-Content und schreibst ausschliesslich in der Zielsprache. Du erzeugst niemals eigene Tabellen. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
{{action}}
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<bereits_geschriebener_artikel>{{previous_content}}</bereits_geschriebener_artikel>
<bereits_gesetzte_links>{{used_links}}</bereits_gesetzte_links>
<geprüfte_links>{{verified_links}}</geprüfte_links>
<tabellenmarker>{{table_markers}}</tabellenmarker>
<wortzahl_quelle>{{source_word_count}}</wortzahl_quelle>
<wortlimit_ziel>{{max_target_words}}</wortlimit_ziel>
<listenpunkte_quelle>{{source_list_items}}</listenpunkte_quelle>
<absaetze_quelle>{{source_paragraphs}}</absaetze_quelle>
<korrekturhinweise>{{correction_notes}}</korrekturhinweise>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (haerteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklaerung, keine deutschen Ueberschriften, Listenpunkte, Bildhinweise oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbaende, Gesetze, Studien) nur, wenn sie der offizielle Name sind UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklaeren.

Fachbegriffe in der landesueblichen Form der Zielsprache, nicht woertlich aus dem Deutschen. Pruefe deinen Text vor der Ausgabe Wort fuer Wort auf deutsche Reste.

MARKEN- UND SERVICE-AUSSAGEN:

Services der Marke (z. B. Online-Tierarzt, Hotline, Kundenkarte, Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT automatisch im Zielmarkt, nur weil sie im deutschen Original stehen. Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> fuer {{country}} bestaetigt ist. Sonst neutral umformulieren oder ersatzlos streichen. Niemals raten.

Aussagen aus <verbotene_aussagen> kommen nicht vor. Dasselbe gilt fuer Rechtslage, Verbaende, Pflichten, Preise und Verfuegbarkeiten: keine Uebernahme deutscher Gegebenheiten ohne Bestaetigung. Markt- und Rechtsaussagen im Fliesstext duerfen den Aussagen in Tabellen niemals widersprechen.

UEBERSCHRIFT:

Die erste Zeile deines Outputs ist exakt: {{heading_markup}} (Ebene H{{heading_level}}, genau so viele Rauten, niemals eine andere Ebene, niemals zwei Rautenfolgen hintereinander). Verwende exakt die vorgegebene <ziel_ueberschrift> in korrekter Gross-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug. Der Abschnitt enthaelt genau diese eine Ueberschrift und keine weitere.

Uebernimm keine Meta-Zeilen (Datum, Lesezeit, Autor). Muss eine Lesezeit vorkommen, berechne sie aus der Wortzahl deines Zieltextes (ca. 200 Woerter pro Minute).

TABELLEN (STRIKT):

Du erzeugst unter keinen Umstaenden eine eigene Tabelle. Keine Markdown-Tabelle, keine Pipe-Zeilen, keine tabellenaehnliche Aufzaehlung, auch nicht als Ersatz oder Zusammenfassung.

In <de_original> koennen Positionsmarker der Form [[OMFIRE_TABLE_n]] stehen. Die erwarteten Marker stehen in <tabellenmarker>. Gib jeden dieser Marker exakt einmal, unveraendert und an derselben Stelle wie im Original aus, in einer eigenen Zeile. Erfinde keine weiteren Marker, lasse keinen weg und schreibe keinen Inhalt dazu.

Die Tabellen werden nach deiner Ausgabe automatisch eingesetzt. Ein selbst erzeugter oder umformulierter Tabelleninhalt gilt als Fehler und fuehrt zur Wiederholung des Abschnitts.

STRUKTUR EXAKT BEIBEHALTEN (STRIKT):

Dein Abschnitt hat exakt {{source_paragraphs}} Absaetze und exakt {{source_list_items}} Listenpunkte. Zaehle vor der Ausgabe nach.

Ein Absatz der Quelle bleibt ein Absatz, ein Listenpunkt (Zeile beginnt mit "- ") bleibt ein Listenpunkt in derselben Reihenfolge. Fasse niemals zwei Absaetze zusammen und teile niemals einen Absatz auf. Kurze eigenstaendige Zeilen der Quelle (z. B. Bildhinweise, Bildnachweise, Einleitungszeilen) sind ebenfalls eigene Absaetze und bleiben eigene Absaetze. Bildhinweise gibst du als [Image – kurze Bildbeschreibung in der Zielsprache] aus.

Wandle niemals Fliesstext in Stichpunkte um oder umgekehrt. Erfinde keine zusaetzlichen Listen, Zwischenueberschriften oder Aufzaehlungen. Fettungen bleiben an denselben Stellen.

UMFANG (STRIKT):

Die Quelle hat {{source_word_count}} Woerter. Dein Abschnitt hat hoechstens {{max_target_words}} Woerter und liegt idealerweise nahe an der Quellwortzahl. Blaehe den Text nicht auf.

KEINE INHALTLICHEN ZUSAETZE (STRIKT):

Uebertrage ausschliesslich die Aussagen des <de_original>. Jede Aussage muss sich einem Satz des Originals zuordnen lassen. Fuege keine zusaetzlichen Beispiele, Begriffe, Mengenangaben oder Kategorien hinzu, auch wenn sie fachlich naheliegen.

Ergaenze keine Einschraenkungen, Bedingungen, Warnungen, Empfehlungen oder Voraussetzungen, die im Original fehlen. Schwaeche und verschaerfe Aussagen nicht: allgemein bleibt allgemein, eingeschraenkt bleibt genauso eingeschraenkt. Ziehe keine eigenen Schlussfolgerungen. Nur ausdrueckliche Lokalisierungshinweise duerfen den Inhalt veraendern.

SPRACHBILDER VERMEIDEN (STRIKT):

Formuliere so sachlich wie das Original. Keine Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen, Wortspiele oder ausgeschmueckten Umschreibungen ohne Entsprechung im Original. Nenne Tiere, Personen und Sachverhalte mit ihrer normalen Bezeichnung. Verzichte auf uebermaessige Gedankenstriche und Fuellwoerter.

Elemente am Ende des Textes (z. B. Produkt- oder Beitragslisten) werden nur uebersetzt, nie um eigene Einleitungen erweitert.

ANSCHLUSS AN DIE VORHERIGEN ABSCHNITTE (STRIKT):

In <bereits_geschriebener_artikel> steht der komplette bisher geschriebene Artikel. Lies ihn vor dem Schreiben. Wiederhole keine Aussage und kein Beispiel daraus.

Allgemeine Sicherheits- und Gesundheitshinweise kommen im gesamten Artikel GENAU EINMAL vor. Steht ein solcher Hinweis schon im bisherigen Text, wiederhole ihn nicht, auch nicht umformuliert. Dasselbe gilt fuer wiederkehrende Standardsaetze zu Ernaehrung, Versicherung, Kosten oder Eignung.

VERLINKUNG (STRIKT):

Jede Ziel-URL wird im gesamten Artikel im Idealfall genau einmal verlinkt, maximal zweimal und ein zweites Mal nur mit komplett anderem Ankertext. URLs aus <bereits_gesetzte_links> mit zwei Verwendungen verlinkst du nicht mehr.

Nicht jeder Abschnitt braucht einen Link. Setze Links nur natuerlich fliessend mitten im Satz, mit einem Ankertext aus 2 bis 5 Woertern, der thematisch exakt zur Zielseite passt. Keine kuenstlichen Hinweis- oder Call-to-Action-Saetze. Bevorzuge spezifische redaktionelle Zielseiten gegenueber allgemeinen Uebersichtsseiten. Passt kein Link grammatikalisch unsichtbar, lass ihn weg. Erfinde niemals eine URL.

KORREKTUR:

In <korrekturhinweise> stehen die Gruende, warum ein vorheriger Versuch abgelehnt wurde. Behebe genau diese Punkte, ohne neue Abweichungen einzufuehren.

Gib nur den fertigen Abschnitt aus, keine Erklaerungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '["language", "language_variant", "country", "brand", "address_form", "style_profile", "style_example", "target_heading", "heading_level", "heading_markup", "de_section", "action", "localization_notes", "written_headings", "previous_content", "used_links", "verified_links", "table_markers", "source_word_count", "max_target_words", "source_list_items", "source_paragraphs", "correction_notes", "institutions", "forbidden_claims"]', 11, true, 110, 'ffa437a1-a834-4236-a389-78e1a3fde288', '2026-09-17 07:37:54.787851+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('4ef0b0de-19d1-4b9d-b283-500033c73269', 'localization_plan', 'S6 · Lokalisierungsplan', 'Qualitätsentscheidender Schritt: legt pro Abschnitt fest, ob übersetzt, lokalisiert, umgeschrieben oder gestrichen wird.', 'Du bist Lokalisierungs-Stratege für internationale Retail-Marken. Antworte ausschließlich mit gültigem JSON.', 'Du planst die Lokalisierung eines deutschen Ratgeberartikels für {{country}} ({{language}}).
Du schreibst hier noch keinen Fließtext.

<de_gliederung>{{de_outline}}</de_gliederung>
<marktprofil>{{market_profile}}</marktprofil>

Entscheide für jeden Abschnitt:
- "uebersetzen"  = inhaltlich unverändert übertragen
- "lokalisieren" = Inhalt bleibt, aber Institutionen, Rechtslage, Verbreitungsangaben anpassen
- "umschreiben"  = das deutsche Konzept existiert im Zielmarkt nicht, Abschnitt inhaltlich ersetzen
- "streichen"    = im Zielmarkt irrelevant

Achte besonders auf: Zuchtverbände, Prüfungs- und Rechtsvorschriften, Serviceangebote
der Marke, Aussagen über Verbreitung „in Deutschland", Quellenangaben deutscher Verbände.
Institutionen, die im Marktprofil auf null stehen, existieren im Zielmarkt nicht.

Serviceangebote der Marke (Online-Tierarzt, Hotline, Kundenkarte, App, Lieferdienst,
Versicherung) gelten NICHT automatisch für {{country}}. Steht ein solcher Service nicht
im Marktprofil, notiere ausdrücklich: Aussage neutral formulieren oder streichen.

Schlage pro Abschnitt 0–4 Anker vor, die sich intern verlinken lassen. Gib keine URLs an.

Antworte nur mit JSON:
{"sections":[{"de_heading":"...","target_heading":"Überschrift in der Zielsprache, korrekt groß-/kleingeschrieben, kein Slug",
  "action":"uebersetzen|lokalisieren|umschreiben|streichen",
  "notes":["konkrete Anweisung für den Schreibschritt"],
  "has_table":true|false,
  "anchors":[{"anchor":"Begriff in der Zielsprache, der im Text vorkommen soll",
    "intent":"rasse|produktkategorie|ratgeber",
    "search_terms":["2-4 Suchbegriffe in der Zielsprache"],
    "path_type":"magazine|category"}]}]}', 'gpt-4o', 0.3, 8000, NULL, 'json', '["de_outline", "market_profile", "country", "language"]', 3, true, 60, NULL, '2026-09-04 09:50:42.381974+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('fda17a6c-e226-4d20-b23b-931d9fa583ec', 'localize_table', 'S10 · Tabellen lokalisieren', 'Ein Call pro Tabelle. Zeilenzahl wird danach im Code geprüft.', 'Du lokalisierst Tabellen. Antworte ausschliesslich mit gueltigem JSON.', 'Lokalisiere diese Tabelle nach {{language}}.

<tabelle>{{table_markdown}}</tabelle>
<hinweise>{{market_notes}}</hinweise>

Regeln:
- Zeilenzahl, Spaltenzahl und Reihenfolge exakt beibehalten; identische Markdown-Struktur inklusive Trennzeile
- Keine Zeile, Spalte oder Zelle hinzufuegen, zusammenfassen oder auslassen
- Nur den Zellinhalt uebersetzen; keine zusaetzlichen Erklaerungen, Klammerzusaetze, Fussnoten oder Hinweise
- Masseinheiten und Zahlenwerte beibehalten; Formate an die landesuebliche Schreibweise anpassen, ohne Werte zu aendern
- Fachbegriffe und Rassebezeichnungen in die landesuebliche Form der Zielsprache bringen
- Marktgebundene Aussagen (Rechtslage, Schutzstatus, Verbaende, Pflichten, Verfuegbarkeiten) nur dann uebernehmen, wenn sie fuer das Zielland bestaetigt sind. Ist das nicht der Fall, formuliere die Zelle neutral, ohne die Aussage auf ein anderes Land zu uebertragen und ohne neue Aussagen zu erfinden. Die Tabelle darf dem uebrigen Artikel nicht widersprechen.
- Kein Text ausserhalb der Tabelle

Antworte nur mit JSON:
{"table_markdown":"die vollstaendige lokalisierte Tabelle als Markdown, gleiche Zeilen- und Spaltenzahl wie das Original"}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '["table_markdown", "language", "market_notes"]', 4, true, 100, NULL, '2026-09-17 07:37:54.787851+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('c31e473e-20e4-4bf7-9708-b75aaebca149', 'serp_gap_queries', 'S7b · SERP-Suchanfragen', 'Formuliert bis zu 5 Suchanfragen für DataForSEO, um Lücken im Link-Pool zu schließen.', 'Du bist SEO-Analyst für den Zielmarkt {{country}} (Sprache: {{language}}, Domain: {{host}}).
Aufgabe: Finde heraus, welche thematisch passenden Artikel im Zielmarkt fehlen könnten, und formuliere dafür Suchanfragen.

Regeln:
- Maximal {{max_queries}} Suchanfragen, jede in der Sprache {{language}}.
- Schreibe NUR den Suchbegriff, ohne Operatoren wie site: – die Domain-Einschränkung wird technisch ergänzt.
- Keine Anfragen zu Themen, die im vorhandenen Link-Pool bereits gut abgedeckt sind.
- Konzentriere dich auf redaktionelle Magazin-Themen, nicht auf Produkte oder Kategorien.
- Jede Anfrage muss ein anderes Thema abdecken (keine Varianten derselben Suche).

Antworte ausschließlich als JSON: {"queries": ["...", "..."]}', 'Thema des Artikels: {{topic}}

Gliederung der deutschen Quelle:
{{de_outline}}

Im deutschen Text verlinkte Themen:
{{de_content_links}}

Bereits im Link-Pool des Zielmarkts vorhanden:
{{pool_urls}}', 'gpt-4o-mini', 0.4, 1500, NULL, 'json', '["country", "language", "host", "topic", "max_queries", "de_outline", "de_content_links", "pool_urls"]', 1, true, 75, NULL, '2026-09-10 07:24:48.036251+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('9dbaf538-f50e-4cb6-a460-c86f573f08e4', 'serp_gap_select', 'S7b · SERP-Treffer auswählen', 'Wählt aus den DataForSEO-Ergebnissen nur die potentiell nützlichen Ziel-URLs aus.', 'Du prüfst Suchergebnisse der Domain {{host}} für den Markt {{country}} (Sprache: {{language}}).
Aufgabe: Wähle ausschließlich die Ergebnisse aus, die als interner Link zum Thema „{{topic}}" wirklich nützlich sein können.

Regeln:
- Nur redaktionelle Magazin-/Ratgeberartikel. Keine Produktseiten, Kategorieseiten, Kontakt-, Filial- oder Serviceseiten.
- Kein Ergebnis wählen, dessen Titel/Beschreibung thematisch nicht klar passt. Lieber nichts wählen als etwas Unpassendes.
- anchor_text: kurzer, natürlicher Linktext in der Sprache {{language}}.
- intent: ein Satz in Deutsch, worum es auf der Seite geht (aus Titel und Beschreibung).

Antworte ausschließlich als JSON: {"selected": [{"index": 1, "url": "...", "anchor_text": "...", "intent": "..."}]}', 'Suchergebnisse (Nummer, Titel, URL, Beschreibung):
{{serp_results}}', 'gpt-4o-mini', 0.2, 2000, NULL, 'json', '["country", "language", "host", "topic", "serp_results"]', 1, true, 76, NULL, '2026-09-10 07:24:48.036251+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('0a51ca43-5001-4656-b5d9-a5f9106c53a3', 'link_summary', 'S9 · Zielseite zusammenfassen', 'Fasst jede verifizierte Zielseite in einem Absatz zusammen, damit S11 den echten Inhalt kennt.', 'Du fasst Webseiten für die interne Verlinkung zusammen. Antworte ausschließlich mit gültigem JSON.', 'Fasse den Inhalt dieser Seite zusammen.

<url>{{url}}</url>
<titel>{{title}}</titel>
<h1>{{h1}}</h1>
<meta_description>{{meta_description}}</meta_description>
<gliederung>{{outline}}</gliederung>
<seitentext>{{page_text}}</seitentext>

Aufgaben:
1. summary: EIN Absatz (max. 60 Wörter) in {{language}}, der konkret sagt, welche Frage die Seite beantwortet und welche Themen sie NICHT behandelt.
2. page_type: "ratgeber" (redaktioneller Artikel), "kategorie" (Produktübersicht/PLP), "produkt" (PDP) oder "sonstige".
3. topics: 3–6 Stichworte zum tatsächlichen Seiteninhalt.
4. good_anchor: kurzer, natürlicher Ankertext in {{language}}, der exakt das Seitenthema trifft.

Antworte nur mit JSON:
{"summary":"...","page_type":"ratgeber|kategorie|produkt|sonstige","topics":["..."],"good_anchor":"..."}', 'gpt-4o-mini', 0.2, 1200, NULL, 'json', '["url", "title", "h1", "meta_description", "outline", "page_text", "language"]', 1, true, 95, NULL, '2026-09-10 10:07:10.592762+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('4d6f23ac-0200-40cf-9cfb-dc436e4cf88b', 'translate_path_segment', 'Pfadsegmente übersetzen', 'Schlägt Übersetzungen für fehlende Verzeichnissegmente vor (S3). Vorschläge werden live geprüft, bevor sie gespeichert werden.', 'Du bist SEO-Spezialist für internationale Onlineshops. Antworte ausschließlich mit gültigem JSON.', 'Zielsprache: {{language}}. Zielland: {{country}}. Zieldomain: {{domain}}.
Quell-URL: {{source_url}}

Bereits bekannte Segmentpaare (deutsch → Zielsprache):
{{known_pairs}}

Fehlende deutsche URL-Verzeichnissegmente:
{{segments}}

Nenne je Segment bis zu 3 wahrscheinliche Verzeichnisnamen in der Zielsprache,
so wie sie ein Tierbedarf-Onlineshop in der URL verwenden würde
(Kleinbuchstaben, keine Akzente, Bindestriche statt Leerzeichen).
Orientiere dich am Stil der bekannten Paare.

Antworte nur mit JSON:
{"segments":[{"de":"segment","candidates":["...","...","..."]}]}', 'gpt-4o-mini', 0.3, 1000, NULL, 'json', '["language", "country", "domain", "source_url", "known_pairs", "segments"]', 1, true, 35, NULL, '2026-09-11 07:12:06.422842+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('fb19edab-4b64-44fa-aad8-fde6585a3d28', 'serp_opportunity_queries', 'S7c · SERP-Linkchancen', 'Leitet aus dem deutschen Quelltext bis zu 10 zusätzliche Linkchancen ab und formuliert dafür Suchbegriffe in der Zielsprache.', 'Du bist SEO-Analyst für den Zielmarkt {{country}} (Sprache: {{language}}, Domain-Einschränkung: {{site}}).
Aufgabe: Lies den deutschen Quelltext und überlege, an welchen Stellen zusätzlich ein interner Link sinnvoll wäre. Formuliere für jede dieser Chancen einen Suchbegriff, mit dem sich prüfen lässt, ob es dazu eine passende Seite auf der Zieldomain gibt.

Regeln:
- Maximal {{max_queries}} Chancen, jede zu einem anderen Thema.
- Suchbegriff ausschließlich in der Sprache {{language}}, so wie im Zielmarkt gesucht wird – keine wörtliche Übersetzung deutscher Slugs.
- Schreibe NUR den Suchbegriff, ohne Operatoren wie site: – die Einschränkung auf {{site}} (inklusive Sprachverzeichnis {{path_prefix}}) wird technisch ergänzt.
- Wähle Themen mit hoher Wahrscheinlichkeit, dass es dazu einen redaktionellen Magazin-/Ratgeberartikel im Zielmarkt gibt (typische Standardthemen der Tierhaltung).
- Keine Themen, die im vorhandenen Link-Pool bereits gut abgedeckt sind, und keine Wiederholung der bereits gestellten Suchanfragen.
- Keine Produkt-, Kategorie- oder Serviceseiten anpeilen.

Antworte ausschließlich als JSON:
{"opportunities":[{"topic":"Thema in Deutsch","query":"Suchbegriff in der Zielsprache","reason":"kurz, warum hier ein Link passt"}]}', 'Thema des Artikels: {{topic}}

Gliederung der deutschen Quelle:
{{de_outline}}

Abschnitte der deutschen Quelle (gekürzt):
{{de_sections}}

Bereits im Link-Pool des Zielmarkts vorhanden:
{{pool_urls}}

Bereits gestellte Suchanfragen (nicht wiederholen):
{{existing_queries}}', 'gpt-4o-mini', 0.4, 2000, NULL, 'json', '["country", "language", "host", "site", "path_prefix", "topic", "max_queries", "de_outline", "de_sections", "pool_urls", "existing_queries"]', 1, true, 77, NULL, '2026-09-11 09:23:02.289687+00') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_templates VALUES ('22c13880-85b2-4cae-ad6f-9d2e4753fc39', 'qa', 'S12 · QA', 'LLM-Qualitätsprüfung, ergänzt um deterministische Code-Checks.', 'Du bist Schlussredakteur:in und pruefst lokalisierten Content. Antworte ausschliesslich mit gueltigem JSON.', 'Pruefe diesen lokalisierten Artikel auf Fehler.

<artikel>{{full_text}}</artikel>
<quelle>{{source_text}}</quelle>
<lokalisierte_tabellen>{{localized_tables}}</lokalisierte_tabellen>
<strukturbericht>{{structure_report}}</strukturbericht>
<zielsprache>{{language}}</zielsprache>
<zielland>{{country}}</zielland>
<marke>{{brand}}</marke>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_begriffe>{{forbidden_terms}}</verbotene_begriffe>

Pruefe streng auf:
1. SPRACHE: jedes Wort, jeden Halbsatz, jede Ueberschrift, jeden Bildhinweis und jede Tabellenzelle in einer anderen Sprache als der Zielsprache (type: "sprache").
2. SERVICE-AUSSAGEN: Behauptungen ueber Angebote der Marke, die nicht in <institutionen_im_zielmarkt> bestaetigt sind, sowie Rechtslage, Verbaende oder Pflichten ohne Bestaetigung fuer {{country}} (type: "unbestaetigter_service").
3. LINKS: Ankertext passt thematisch nicht zur Ziel-URL, erfundene oder unvollstaendige Links, dieselbe URL oefter als zweimal oder zweimal mit aehnlichem Ankertext, kuenstliche Hinweissaetze rund um Links (type: "link_mismatch").
4. UEBERSCHRIFTEN: komplett kleingeschriebene Ueberschriften oder Slugs, doppelte Ueberschriften, zusammengezogene Woerter, verschachtelte Rautenfolgen, abweichende Ebenen gegenueber der Quelle (type: "ueberschrift").
5. META: Lesezeit oder Datum aus der Quelle uebernommen. Berechne die Lesezeit aus der Wortzahl des vorliegenden Textes (ca. 200 Woerter/Minute) und melde Abweichungen mit dem korrekten Wert als suggestion (type: "lesezeit").
6. INHALTLICHE ZUSAETZE: Aussagen, Beispiele, Begriffe, Einschraenkungen, Bedingungen, Warnungen oder Empfehlungen, die ueber die Quelle hinausgehen oder deren Reichweite veraendern (type: "inhaltlicher_zusatz").
7. SPRACHBILDER: Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen und Wortspiele ohne Entsprechung in der Quelle (type: "sprachbild").
8. FORMATABWEICHUNG: Listen, wo die Quelle Fliesstext hat, und umgekehrt; abweichende Anzahl an Listenpunkten oder Absaetzen gegenueber dem <strukturbericht> (type: "format").
9. MARKE UND BEGRIFFE: falscher Markenname, inkonsistente Ansprache, verbotene Begriffe (type: "marke").
10. TABELLEN: Jede Tabelle aus <lokalisierte_tabellen> muss exakt einmal, unveraendert und im zugehoerigen Abschnitt stehen. Zusaetzliche, doppelte, umformulierte oder frei erzeugte Tabellen und abweichende Zeilen- oder Spaltenzahlen sind Fehler (type: "tabelle").
11. UMFANG: Vergleiche Quelle und Ziel je Abschnitt und insgesamt. Melde deutliche Verlaengerungen, neue Absaetze oder wiederholte Hinweise (type: "laenge").
12. LOKALISIERUNGSKONSISTENZ: widerspruechliche Markt-, Rechts- oder Institutionsaussagen zwischen Fliesstext und Tabelle sowie nicht lokalisierte marktgebundene Aussagen (type: "lokalisierung").

Melde jeden Fund einzeln mit dem gefundenen Wortlaut. Melde nichts, was korrekt ist.

Antworte nur mit JSON:
{"issues":[{"type":"...","location":"...","found":"...","suggestion":"..."}]}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '["full_text", "source_text", "localized_tables", "structure_report", "language", "country", "brand", "institutions", "forbidden_terms"]', 5, true, 120, NULL, '2026-09-17 07:37:54.787851+00') ON CONFLICT DO NOTHING;


--
--


-- 12.3 prompt_versions (Prompt-Historie)

INSERT INTO public.prompt_versions VALUES ('05aa56c3-99db-4f15-94cf-3aa54ff95cd3', '57bdd23a-5d1b-4a8a-b2e7-5a5ec71d335e', 1, 'Du bist SEO-Spezialist für Tierbedarf-Onlineshops. Antworte ausschließlich mit gültigem JSON.', 'Zielsprache: {{language}}. Zielland: {{country}}.
Deutscher Begriff aus der URL: "{{term}}".

Nenne 5 mögliche URL-Slugs in der Zielsprache, wie sie ein Tierbedarf-Onlineshop
verwenden würde. Berücksichtige die landesübliche Fachbezeichnung, nicht die
wörtliche Übersetzung.

Antworte nur mit JSON:
{"slugs": ["...", "...", "...", "...", "..."]}', 'gpt-4o-mini', 0.3, 1000, NULL, 'json', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('7f64dbc3-95c8-44ed-8177-1d83d8613de4', 'aa13d2dd-1e34-465f-840d-2aa3055346ce', 1, 'Du bist erfahrener SEO-Content-Analyst. Antworte ausschließlich mit gültigem JSON.', 'Vergleiche zwei Ratgeberartikel zum selben Thema.

<de_struktur>{{de_structure}}</de_struktur>
<de_wortzahl>{{de_word_count}}</de_wortzahl>
<ziel_struktur>{{target_structure}}</ziel_struktur>
<ziel_wortzahl>{{target_word_count}}</ziel_wortzahl>
<ziel_auszug>{{target_excerpt}}</ziel_auszug>

Der Zielcontent ist nur AUSREICHEND, wenn alle Bedingungen erfüllt sind:
- mindestens 300 Wörter redaktioneller Fließtext
- mehrere thematische Abschnitte mit H2/H3
- keine reine FAQ-Sammlung
- qualitativ mit der deutschen Seite vergleichbar

Antworte nur mit JSON:
{"verdict":"AUSREICHEND"|"NEU_ERSTELLEN","word_count":0,
 "missing_topics":["..."],"reason":"max. 2 Sätze"}', 'gpt-4o-mini', 0.2, 2000, NULL, 'json', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('95a4ec37-2045-4f39-8948-a5df14cb009a', 'e05ac10c-8246-4cfd-b553-76e2fbd125fd', 1, 'Du bist Sprach- und Stilanalyst. Antworte ausschließlich mit gültigem JSON.', 'Analysiere den Schreibstil dieser vorhandenen Ratgeberartikel eines Tierbedarf-Shops.

{{reference_texts}}

Antworte nur mit JSON:
{"address_form":"informell"|"formell"|"gemischt",
 "address_examples":["..."],
 "sentence_length":"kurz"|"mittel"|"lang",
 "heading_style":"Frage"|"Aussage"|"gemischt",
 "tone_notes":["max. 5 kurze Beobachtungen"],
 "recurring_phrases":["..."]}', 'gpt-4o-mini', 0.3, 2000, NULL, 'json', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('56f549b9-c729-4465-b40c-955aca3248da', '4ef0b0de-19d1-4b9d-b283-500033c73269', 1, 'Du bist Lokalisierungs-Stratege für internationale Retail-Marken. Antworte ausschließlich mit gültigem JSON.', 'Du planst die Lokalisierung eines deutschen Ratgeberartikels für {{country}} ({{language}}).
Du schreibst hier noch keinen Fließtext.

<de_gliederung>{{de_outline}}</de_gliederung>
<marktprofil>{{market_profile}}</marktprofil>

Entscheide für jeden Abschnitt:
- "uebersetzen"  = inhaltlich unverändert übertragen
- "lokalisieren" = Inhalt bleibt, aber Institutionen, Rechtslage, Verbreitungsangaben anpassen
- "umschreiben"  = das deutsche Konzept existiert im Zielmarkt nicht, Abschnitt inhaltlich ersetzen
- "streichen"    = im Zielmarkt irrelevant

Achte besonders auf: Zuchtverbände, Prüfungs- und Rechtsvorschriften, Serviceangebote
der Marke, Aussagen über Verbreitung „in Deutschland", Quellenangaben deutscher Verbände.
Institutionen, die im Marktprofil auf null stehen, existieren im Zielmarkt nicht.

Antworte nur mit JSON:
{"sections":[{"de_heading":"...","target_heading":"...",
  "action":"uebersetzen|lokalisieren|umschreiben|streichen",
  "notes":["konkrete Anweisung für den Schreibschritt"],
  "has_table":true|false}]}', 'gpt-4o', 0.3, 8000, NULL, 'json', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('ed5f0f8d-0597-429c-8bb4-76bd2cf6d094', 'b51ad427-e939-4a70-aa7c-bcf54079134f', 1, 'Du wählst interne Verlinkungen aus. Du gibst niemals URLs aus, nur Nummern. Antworte ausschließlich mit gültigem JSON.', 'Wähle die beste interne Verlinkung für einen Ankertext.

<ankertext>{{anchor}}</ankertext>
<kontext>{{context_sentence}}</kontext>

<kandidaten>
{{candidates}}
</kandidaten>

Wähle die thematisch am besten passende Seite. Wenn keine Seite wirklich passt,
antworte mit null. Rate nicht und wähle nicht „die am wenigsten schlechte".

Antworte nur mit JSON:
{"choice": <nummer>|null, "confidence":"hoch"|"mittel"|"niedrig", "reason":"1 Satz"}', 'gpt-4o-mini', 0.1, 1500, NULL, 'json', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('d2b71570-9698-42ba-806b-b578f245ef4d', 'fda17a6c-e226-4d20-b23b-931d9fa583ec', 1, 'Du lokalisierst Tabellen. Antworte ausschließlich mit gültigem JSON.', 'Lokalisiere diese Tabelle nach {{language}}.

<tabelle>{{table_markdown}}</tabelle>
<hinweise>{{market_notes}}</hinweise>

Regeln:
- Zeilenzahl und Reihenfolge exakt beibehalten
- Maßeinheiten beibehalten
- Rassebezeichnungen und Fachbegriffe in die landesübliche Form bringen
- Keine Zeile zusammenfassen oder auslassen

Antworte nur mit JSON:
{"rows":[{"label":"...","value":"..."}]}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('5a03d3a0-b0eb-4244-a77b-003ed3597c21', '6063ff65-72ec-40d3-9e71-647906d1ed2e', 1, 'Du bist erfahrene:r Redakteur:in für Tierratgeber-Content und schreibst in der Zielsprache. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Marke: {{brand}}. Ansprache: {{address_form}}.

<stilprofil>{{style_profile}}</stilprofil>
<stilbeispiel>{{style_example}}</stilbeispiel>

<de_original>{{de_section}}</de_original>
<aktion>{{action}}</aktion>
<lokalisierungshinweise>{{localization_notes}}</lokalisierungshinweise>
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<geprüfte_links>{{verified_links}}</geprüfte_links>
<tabelle>{{table_markdown}}</tabelle>

Regeln:
- Nicht 1:1 übersetzen, sondern lokalisieren. Kein Übersetzungston.
- Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog.
  Keine bürokratischen oder akademischen Formulierungen.
- Alle inhaltlichen Kernaussagen, Checklisten, Material- und Produkthinweise erhalten.
- Keine Fakten erfinden, die nicht im Original stehen — außer die
  Lokalisierungshinweise fordern es ausdrücklich.
- Fettungen (**) an denselben Stellen wie im Original.
- VERLINKUNG: Verwende ausschließlich Anker aus <geprüfte_links>. Erfinde niemals
  eine URL. Setze einen Anker nur dort, wo er inhaltlich passt — lieber weglassen
  als erzwingen.
- Falls eine Tabelle übergeben wurde, füge sie unverändert an der passenden Stelle ein.
- Format: [H2: ...] bzw. [H3: ...], darunter Fließtext, Listen als Bullets,
  Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('bf36e7ab-405d-4468-ba7a-f2bc79a80222', '22c13880-85b2-4cae-ad6f-9d2e4753fc39', 1, 'Du bist Schlussredakteur:in und prüfst lokalisierten Content. Antworte ausschließlich mit gültigem JSON.', 'Prüfe diesen lokalisierten Artikel auf Fehler.

<artikel>{{full_text}}</artikel>
<zielsprache>{{language}}</zielsprache>
<marke>{{brand}}</marke>
<verbotene_begriffe>{{forbidden_terms}}</verbotene_begriffe>

Prüfe auf: deutsche Restwörter, falschen Markennamen, inkonsistente Ansprache,
marktfremde Aussagen, defekte Markdown-Tabellen, doppelte Überschriften,
erfundene oder unvollständige Links.

Antworte nur mit JSON:
{"issues":[{"type":"...","location":"...","found":"...","suggestion":"..."}]}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '2026-09-03 09:04:33.884925+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('a444b7b7-b05d-48b6-b549-02f923312ad1', 'b51ad427-e939-4a70-aa7c-bcf54079134f', 2, 'Du wählst interne Verlinkungen aus. Du gibst niemals URLs aus, nur Nummern. Antworte ausschließlich mit gültigem JSON.', 'Wähle die beste interne Verlinkung für einen Ankertext.

<ankertext>{{anchor}}</ankertext>
<kontext>{{context_sentence}}</kontext>

<kandidaten>
{{candidates}}
</kandidaten>

Wähle nur eine Seite, deren HAUPTTHEMA dem entspricht, was der Ankertext verspricht.
Eine thematische Nachbarschaft reicht nicht: Wenn der Ankertext ein Symptom nennt,
die Seite aber eine mögliche Ursache oder eine Behandlung behandelt, ist das ein
Mismatch und du antwortest mit null. Der Nutzer muss nach dem Klick genau das finden,
was der Ankertext ankündigt.
Wenn keine Seite wirklich passt, antworte mit null. Rate nicht und wähle nicht
„die am wenigsten schlechte".

Antworte nur mit JSON:
{"choice": <nummer>|null, "confidence":"hoch"|"mittel"|"niedrig", "reason":"1 Satz"}', 'gpt-4o-mini', 0.1, 1500, NULL, 'json', '2026-09-04 09:50:42.381974+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('fd0376aa-1f0c-4cef-b80f-bc5020081863', '22c13880-85b2-4cae-ad6f-9d2e4753fc39', 2, 'Du bist Schlussredakteur:in und prüfst lokalisierten Content. Antworte ausschließlich mit gültigem JSON.', 'Prüfe diesen lokalisierten Artikel auf Fehler.

<artikel>{{full_text}}</artikel>
<zielsprache>{{language}}</zielsprache>
<zielland>{{country}}</zielland>
<marke>{{brand}}</marke>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_begriffe>{{forbidden_terms}}</verbotene_begriffe>

Prüfe streng auf:
1. SPRACHE: jedes deutsche Wort, jeden deutschen Halbsatz, deutsche Überschriften,
   Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen. Liste jeden Fund einzeln
   mit dem gefundenen Wortlaut auf (type: "sprache").
2. SERVICE-AUSSAGEN: Behauptungen über Angebote der Marke (Online-Tierarzt, Hotline,
   Kundenkarte, App, Lieferdienst, Versicherung, Filialservice), die nicht in
   <institutionen_im_zielmarkt> bestätigt sind (type: "unbestaetigter_service").
   Ebenso deutsche Rechtslage, Verbände oder Pflichten ohne Bestätigung für {{country}}.
3. LINKS: Ankertext passt thematisch nicht zur Ziel-URL (type: "link_mismatch"),
   erfundene oder unvollständige Links.
4. FORMAT: Überschriften komplett kleingeschrieben oder als Slug (type: "ueberschrift"),
   doppelte Überschriften, defekte Markdown-Tabellen.
5. META: Lesezeit oder Datum offensichtlich aus dem deutschen Original übernommen.
   Berechne die Lesezeit aus der Wortzahl des vorliegenden Textes (ca. 200 Wörter/Minute)
   und melde eine Abweichung (type: "lesezeit") mit dem korrekten Wert als suggestion.
6. Falscher Markenname, inkonsistente Ansprache, verbotene Begriffe.

Antworte nur mit JSON:
{"issues":[{"type":"...","location":"...","found":"...","suggestion":"..."}]}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '2026-09-04 09:50:42.381974+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('1a5e3617-43ad-423e-a1f4-5e4285906b29', '4ef0b0de-19d1-4b9d-b283-500033c73269', 3, 'Du bist Lokalisierungs-Stratege für internationale Retail-Marken. Antworte ausschließlich mit gültigem JSON.', 'Du planst die Lokalisierung eines deutschen Ratgeberartikels für {{country}} ({{language}}).
Du schreibst hier noch keinen Fließtext.

<de_gliederung>{{de_outline}}</de_gliederung>
<marktprofil>{{market_profile}}</marktprofil>

Entscheide für jeden Abschnitt:
- "uebersetzen"  = inhaltlich unverändert übertragen
- "lokalisieren" = Inhalt bleibt, aber Institutionen, Rechtslage, Verbreitungsangaben anpassen
- "umschreiben"  = das deutsche Konzept existiert im Zielmarkt nicht, Abschnitt inhaltlich ersetzen
- "streichen"    = im Zielmarkt irrelevant

Achte besonders auf: Zuchtverbände, Prüfungs- und Rechtsvorschriften, Serviceangebote
der Marke, Aussagen über Verbreitung „in Deutschland", Quellenangaben deutscher Verbände.
Institutionen, die im Marktprofil auf null stehen, existieren im Zielmarkt nicht.

Serviceangebote der Marke (Online-Tierarzt, Hotline, Kundenkarte, App, Lieferdienst,
Versicherung) gelten NICHT automatisch für {{country}}. Steht ein solcher Service nicht
im Marktprofil, notiere ausdrücklich: Aussage neutral formulieren oder streichen.

Schlage pro Abschnitt 0–4 Anker vor, die sich intern verlinken lassen. Gib keine URLs an.

Antworte nur mit JSON:
{"sections":[{"de_heading":"...","target_heading":"Überschrift in der Zielsprache, korrekt groß-/kleingeschrieben, kein Slug",
  "action":"uebersetzen|lokalisieren|umschreiben|streichen",
  "notes":["konkrete Anweisung für den Schreibschritt"],
  "has_table":true|false,
  "anchors":[{"anchor":"Begriff in der Zielsprache, der im Text vorkommen soll",
    "intent":"rasse|produktkategorie|ratgeber",
    "search_terms":["2-4 Suchbegriffe in der Zielsprache"],
    "path_type":"magazine|category"}]}]}', 'gpt-4o', 0.3, 8000, NULL, 'json', '2026-09-04 09:50:42.381974+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('cdadde4c-58b8-4b31-a0d7-15208ef8afae', '6063ff65-72ec-40d3-9e71-647906d1ed2e', 3, 'Du bist erfahrene:r Redakteur:in für Tierratgeber-Content und schreibst ausschließlich in der Zielsprache. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

<stilprofil>{{style_profile}}</stilprofil>
<stilbeispiel>{{style_example}}</stilbeispiel>

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
<aktion>{{action}}</aktion>
<lokalisierungshinweise>{{localization_notes}}</lokalisierungshinweise>
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<geprüfte_links>{{verified_links}}</geprüfte_links>
<tabelle>{{table_markdown}}</tabelle>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (härteste Regel):
- Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches
  Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklärung, keine deutschen
  Überschriften, Listenpunkte, Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen.
- Deutsche Eigennamen (Verbände, Gesetze, Studien) nur, wenn sie der offizielle Name sind
  UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklären.
- Fachbegriffe in der landesüblichen Form der Zielsprache, nicht wörtlich aus dem Deutschen.
- Prüfe deinen Text vor der Ausgabe Wort für Wort auf deutsche Reste und ersetze sie.

MARKEN- UND SERVICE-AUSSAGEN:
- Services der Marke (z. B. Online-Tierarzt/Online-Doc, Tierarzt-Hotline, Kundenkarte,
  Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT
  automatisch im Zielmarkt, nur weil sie im deutschen Original stehen.
- Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> oder in den
  <lokalisierungshinweise> ausdrücklich für {{country}} bestätigt ist.
- Sonst: Aussage neutral umformulieren (z. B. „wende dich an deine Tierärztin oder
  deinen Tierarzt") oder ersatzlos streichen. Niemals raten, niemals „vermutlich".
- Aussagen aus <verbotene_aussagen> kommen nicht vor.
- Genauso für Rechtslage, Zuchtverbände, Versicherungspflichten, Preise und
  Verfügbarkeiten: keine Übernahme deutscher Gegebenheiten ohne Bestätigung.

ÜBERSCHRIFTEN UND META:
- Verwende exakt die vorgegebene <ziel_ueberschrift> als H2, aber in korrekter
  Groß-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug.
- Übernimm keine Meta-Zeilen aus dem Original (Datum, Lesezeit, Autor). Falls der Abschnitt
  eine Lesezeit enthalten muss, berechne sie aus der tatsächlichen Wortzahl deines
  Zieltextes (ca. 200 Wörter pro Minute), nie aus dem deutschen Text.

INHALT:
- Nicht 1:1 übersetzen, sondern lokalisieren. Kein Übersetzungston.
- Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog.
- Alle inhaltlichen Kernaussagen, Checklisten, Material- und Produkthinweise erhalten.
- Keine Fakten erfinden, die nicht im Original stehen — außer die Lokalisierungshinweise
  fordern es ausdrücklich.
- Fettungen (**) an denselben Stellen wie im Original.

VERLINKUNG:
- Verwende ausschließlich Anker aus <geprüfte_links>. Erfinde niemals eine URL.
- Der Ankertext muss zum Thema der Zielseite passen. Wenn die Zielseite ein anderes
  Thema behandelt als der Ankertext verspricht (z. B. Anker „Schlittenfahren beim Hund",
  Ziel ist ein Entwurmungsartikel), formuliere den Ankertext auf das tatsächliche
  Thema der Zielseite um oder lass den Link weg. Lieber kein Link als ein irreführender.
- Falls eine Tabelle übergeben wurde, füge sie unverändert an passender Stelle ein.
  Wenn keine Tabelle übergeben wurde, erzeuge keine.
- Format: [H2: ...] bzw. [H3: ...], darunter Fließtext, Listen als Bullets,
  Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '2026-09-04 09:50:42.381974+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('6e7de136-aeb2-4e77-90cb-50367ffcb082', '6063ff65-72ec-40d3-9e71-647906d1ed2e', 4, 'Du bist erfahrene:r Redakteur:in für Tierratgeber-Content und schreibst ausschließlich in der Zielsprache. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
{{action}}
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<geprüfte_links>{{verified_links}}</geprüfte_links>
{{table_markdown}}
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (härteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches
Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklärung, keine deutschen
Überschriften, Listenpunkte, Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbände, Gesetze, Studien) nur, wenn sie der offizielle Name sind
UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklären.

Fachbegriffe in der landesüblichen Form der Zielsprache, nicht wörtlich aus dem Deutschen.

Prüfe deinen Text vor der Ausgabe Wort für Wort auf deutsche Reste und ersetze sie.

MARKEN- UND SERVICE-AUSSAGEN:

Services der Marke (z. B. Online-Tierarzt/Online-Doc, Tierarzt-Hotline, Kundenkarte,
Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT
automatisch im Zielmarkt, nur weil sie im deutschen Original stehen.

Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> oder in den
 ausdrücklich für {{country}} bestätigt ist.

Sonst: Aussage neutral umformulieren (z. B. „wende dich an deine Tierärztin oder
deinen Tierarzt") oder ersatzlos streichen. Niemals raten, niemals „vermutlich".

Aussagen aus <verbotene_aussagen> kommen nicht vor.

Genauso für Rechtslage, Zuchtverbände, Versicherungspflichten, Preise und
Verfügbarkeiten: keine Übernahme deutscher Gegebenheiten ohne Bestätigung.

ÜBERSCHRIFTEN UND META:

Verwende exakt die vorgegebene <ziel_ueberschrift> als H2, aber in korrekter
Groß-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug.

Übernimm keine Meta-Zeilen aus dem Original (Datum, Lesezeit, Autor). Falls der Abschnitt
eine Lesezeit enthalten muss, berechne sie aus der tatsächlichen Wortzahl deines
Zieltextes (ca. 200 Wörter pro Minute), nie aus dem deutschen Text.

INHALT & LÄNGE (STRIKT):

Textlänge wahren: Lokalisieren bedeutet NICHT, den Text künstlich aufzublähen. Bleibe in der Wortanzahl so nah wie möglich am deutschen Original. Dichte keine neuen Sätze, eigenen Tipps, Ratschläge oder Erklärungen hinzu, die nicht im Original stehen.

Scannbarkeit: Halte Stichpunktlisten kurz, prägnant und übersichtlich. Formuliere Stichpunkte nicht zu langen Fließtexten aus.

Keine Footer-Erweiterungen: Elemente am Ende des Textes (wie „Passende Produkte", „Weitere Beiträge", „Weitere Themen") werden, falls vorhanden, nur exakt übersetzt. Schreibe hierzu niemals eigenständig neue Einleitungen oder erklärende Sätze.

Zeichensetzung: Verzichte auf den übermäßigen Gebrauch von Gedankenstrichen (–). Nutze eine klare, direkte Satzstruktur.

Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog, aber ohne den Text durch Füllwörter zu verlängern.

Fettungen () an denselben Stellen wie im Original belassen.

VERLINKUNG (STRIKT):

Maximale Link-Anzahl: Setze jeden Link aus <geprüfte_links> maximal ein einziges Mal im gesamten Abschnitt, auch wenn das Thema öfter vorkommt.

Organische Integration: Integriere Links ausschließlich natürlich fließend in den bestehenden Satzbau. Erschaffe niemals künstliche Call-to-Action-Sätze (wie z. B. „Weitere Tipps findest du im Artikel über X" oder „Mehr dazu liest du hier:").

Wenn sich ein Link-Ankertext nicht grammatikalisch sinnvoll und unsichtbar in den bestehenden Fließtext einbauen lässt, lass den Link komplett weg!

Der Ankertext muss zwingend zum Thema der Zielseite passen. Lieber kein Link als ein irreführender.

Erfinde niemals eine URL. Verwende nur die aus <geprüfte_links>.

Falls eine Tabelle übergeben wurde, füge sie unverändert an passender Stelle ein. Erzeuge keine eigenen Tabellen.

Format: [H2: ...] bzw. [H3: ...], darunter Fließtext, Listen als Bullets,
Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '2026-09-10 06:24:41.69294+00', 'ffa437a1-a834-4236-a389-78e1a3fde288') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('44399b98-dafb-475c-80df-c780875a44ba', '6063ff65-72ec-40d3-9e71-647906d1ed2e', 5, 'Du bist erfahrene:r Redakteur:in für Tierratgeber-Content und schreibst ausschließlich in der Zielsprache. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
{{action}}
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<bereits_geschriebener_artikel>{{previous_content}}</bereits_geschriebener_artikel>
<bereits_gesetzte_links>{{used_links}}</bereits_gesetzte_links>
<geprüfte_links>{{verified_links}}</geprüfte_links>
{{table_markdown}}
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (härteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches
Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklärung, keine deutschen
Überschriften, Listenpunkte, Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbände, Gesetze, Studien) nur, wenn sie der offizielle Name sind
UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklären.

Fachbegriffe in der landesüblichen Form der Zielsprache, nicht wörtlich aus dem Deutschen.

Prüfe deinen Text vor der Ausgabe Wort für Wort auf deutsche Reste und ersetze sie.

MARKEN- UND SERVICE-AUSSAGEN:

Services der Marke (z. B. Online-Tierarzt/Online-Doc, Tierarzt-Hotline, Kundenkarte,
Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT
automatisch im Zielmarkt, nur weil sie im deutschen Original stehen.

Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> oder in den
 ausdrücklich für {{country}} bestätigt ist.

Sonst: Aussage neutral umformulieren (z. B. „wende dich an deine Tierärztin oder
deinen Tierarzt") oder ersatzlos streichen. Niemals raten, niemals „vermutlich".

Aussagen aus <verbotene_aussagen> kommen nicht vor.

Genauso für Rechtslage, Zuchtverbände, Versicherungspflichten, Preise und
Verfügbarkeiten: keine Übernahme deutscher Gegebenheiten ohne Bestätigung.

ÜBERSCHRIFTEN UND META:

Verwende exakt die vorgegebene <ziel_ueberschrift> als H2, aber in korrekter
Groß-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug.

Übernimm keine Meta-Zeilen aus dem Original (Datum, Lesezeit, Autor). Falls der Abschnitt
eine Lesezeit enthalten muss, berechne sie aus der tatsächlichen Wortzahl deines
Zieltextes (ca. 200 Wörter pro Minute), nie aus dem deutschen Text.

INHALT & LÄNGE (STRIKT):

Textlänge wahren: Lokalisieren bedeutet NICHT, den Text künstlich aufzublähen. Bleibe in der Wortanzahl so nah wie möglich am deutschen Original. Dichte keine neuen Sätze, eigenen Tipps, Ratschläge oder Erklärungen hinzu, die nicht im Original stehen.

Scannbarkeit: Halte Stichpunktlisten kurz, prägnant und übersichtlich. Formuliere Stichpunkte nicht zu langen Fließtexten aus.

Keine Footer-Erweiterungen: Elemente am Ende des Textes (wie „Passende Produkte", „Weitere Beiträge", „Weitere Themen") werden, falls vorhanden, nur exakt übersetzt. Schreibe hierzu niemals eigenständig neue Einleitungen oder erklärende Sätze.

Zeichensetzung: Verzichte auf den übermäßigen Gebrauch von Gedankenstrichen (–). Nutze eine klare, direkte Satzstruktur.

Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog, aber ohne den Text durch Füllwörter zu verlängern.

Fettungen () an denselben Stellen wie im Original belassen.

ANSCHLUSS AN DIE VORHERIGEN ABSCHNITTE (STRIKT):

Die Abschnitte werden von oben nach unten geschrieben. In <bereits_geschriebener_artikel> steht der komplette bisher geschriebene Artikel. Lies ihn vor dem Schreiben.

Wiederhole keine Aussage, keinen Hinweis und kein Beispiel, das dort schon steht. Baue auf dem bisherigen Text auf, statt ihn neu zu erzaehlen.

Allgemeine Sicherheits- und Gesundheitshinweise (z. B. "bei Problemen tieraerztlichen Rat einholen", "im Zweifel die Tierarztpraxis aufsuchen") kommen im gesamten Artikel GENAU EINMAL vor. Steht ein solcher Hinweis bereits in <bereits_geschriebener_artikel>, wiederhole ihn nicht, auch nicht umformuliert, auch nicht als Nebensatz. Nur wenn er noch nirgends vorkommt und in diesen Abschnitt inhaltlich am besten passt, schreibe ihn hier.

Dasselbe gilt fuer wiederkehrende Standardsaetze zu Ernaehrung, Versicherung, Anschaffungskosten oder Rasseeignung: einmal im Artikel, nicht pro Abschnitt.

VERLINKUNG (STRIKT):

Maximale Link-Anzahl: Jede Ziel-URL wird im GESAMTEN Artikel im Idealfall genau einmal verlinkt, maximal zweimal - und ein zweites Mal nur dann, wenn der Ankertext sich komplett vom ersten unterscheidet und der Link an dieser Stelle wirklich hilft.

In <bereits_gesetzte_links> stehen alle URLs, die in frueheren Abschnitten schon verlinkt wurden, samt Ankertext. Eine dort mit 2 Verwendungen aufgefuehrte URL verlinkst du nicht mehr. Eine dort mit 1 Verwendung aufgefuehrte URL verlinkst du nur mit einem komplett anderen Ankertext.

In <geprüfte_links> sind bereits einmal genutzte Links entsprechend markiert. Nicht jeder Abschnitt braucht einen Link: Wenn kein passender, noch freier Link existiert, setze in diesem Abschnitt keinen.

Organische Integration: Integriere Links ausschließlich natürlich fließend in den bestehenden Satzbau. Erschaffe niemals künstliche Call-to-Action-Sätze (wie z. B. „Weitere Tipps findest du im Artikel über X" oder „Mehr dazu liest du hier:").

Wenn sich ein Link-Ankertext nicht grammatikalisch sinnvoll und unsichtbar in den bestehenden Fließtext einbauen lässt, lass den Link komplett weg!

Der Ankertext muss zwingend zum Thema der Zielseite passen. Lieber kein Link als ein irreführender.

Erfinde niemals eine URL. Verwende nur die aus <geprüfte_links>.

Falls eine Tabelle übergeben wurde, füge sie unverändert an passender Stelle ein. Erzeuge keine eigenen Tabellen.

Format: [H2: ...] bzw. [H3: ...], darunter Fließtext, Listen als Bullets,
Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '2026-09-10 09:56:21.094023+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('2e0a439c-2120-4081-8135-a56d13a1ce64', '6063ff65-72ec-40d3-9e71-647906d1ed2e', 5, 'Du bist erfahrene:r Redakteur:in für Tierratgeber-Content und schreibst ausschließlich in der Zielsprache. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
{{action}}
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<bereits_geschriebener_artikel>{{previous_content}}</bereits_geschriebener_artikel>
<bereits_gesetzte_links>{{used_links}}</bereits_gesetzte_links>
<geprüfte_links>{{verified_links}}</geprüfte_links>
{{table_markdown}}
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (härteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches
Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklärung, keine deutschen
Überschriften, Listenpunkte, Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbände, Gesetze, Studien) nur, wenn sie der offizielle Name sind
UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklären.

Fachbegriffe in der landesüblichen Form der Zielsprache, nicht wörtlich aus dem Deutschen.

Prüfe deinen Text vor der Ausgabe Wort für Wort auf deutsche Reste und ersetze sie.

MARKEN- UND SERVICE-AUSSAGEN:

Services der Marke (z. B. Online-Tierarzt/Online-Doc, Tierarzt-Hotline, Kundenkarte,
Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT
automatisch im Zielmarkt, nur weil sie im deutschen Original stehen.

Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> oder in den
 ausdrücklich für {{country}} bestätigt ist.

Sonst: Aussage neutral umformulieren (z. B. „wende dich an deine Tierärztin oder
deinen Tierarzt") oder ersatzlos streichen. Niemals raten, niemals „vermutlich".

Aussagen aus <verbotene_aussagen> kommen nicht vor.

Genauso für Rechtslage, Zuchtverbände, Versicherungspflichten, Preise und
Verfügbarkeiten: keine Übernahme deutscher Gegebenheiten ohne Bestätigung.

ÜBERSCHRIFTEN UND META:

Verwende exakt die vorgegebene <ziel_ueberschrift> als H2, aber in korrekter
Groß-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug.

Übernimm keine Meta-Zeilen aus dem Original (Datum, Lesezeit, Autor). Falls der Abschnitt
eine Lesezeit enthalten muss, berechne sie aus der tatsächlichen Wortzahl deines
Zieltextes (ca. 200 Wörter pro Minute), nie aus dem deutschen Text.

INHALT & LÄNGE (STRIKT):

Textlänge wahren: Lokalisieren bedeutet NICHT, den Text künstlich aufzublähen. Bleibe in der Wortanzahl so nah wie möglich am deutschen Original. Dichte keine neuen Sätze, eigenen Tipps, Ratschläge oder Erklärungen hinzu, die nicht im Original stehen.

Scannbarkeit: Halte Stichpunktlisten kurz, prägnant und übersichtlich. Formuliere Stichpunkte nicht zu langen Fließtexten aus.

Keine Footer-Erweiterungen: Elemente am Ende des Textes (wie „Passende Produkte", „Weitere Beiträge", „Weitere Themen") werden, falls vorhanden, nur exakt übersetzt. Schreibe hierzu niemals eigenständig neue Einleitungen oder erklärende Sätze.

Zeichensetzung: Verzichte auf den übermäßigen Gebrauch von Gedankenstrichen (–). Nutze eine klare, direkte Satzstruktur.

Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog, aber ohne den Text durch Füllwörter zu verlängern.

Fettungen () an denselben Stellen wie im Original belassen.

ANSCHLUSS AN DIE VORHERIGEN ABSCHNITTE (STRIKT):

Die Abschnitte werden von oben nach unten geschrieben. In <bereits_geschriebener_artikel> steht der komplette bisher geschriebene Artikel. Lies ihn vor dem Schreiben.

Wiederhole keine Aussage, keinen Hinweis und kein Beispiel, das dort schon steht. Baue auf dem bisherigen Text auf, statt ihn neu zu erzaehlen.

Allgemeine Sicherheits- und Gesundheitshinweise (z. B. "bei Problemen tieraerztlichen Rat einholen", "im Zweifel die Tierarztpraxis aufsuchen") kommen im gesamten Artikel GENAU EINMAL vor. Steht ein solcher Hinweis bereits in <bereits_geschriebener_artikel>, wiederhole ihn nicht, auch nicht umformuliert, auch nicht als Nebensatz. Nur wenn er noch nirgends vorkommt und in diesen Abschnitt inhaltlich am besten passt, schreibe ihn hier.

Dasselbe gilt fuer wiederkehrende Standardsaetze zu Ernaehrung, Versicherung, Anschaffungskosten oder Rasseeignung: einmal im Artikel, nicht pro Abschnitt.

VERLINKUNG (STRIKT):

Maximale Link-Anzahl: Jede Ziel-URL wird im GESAMTEN Artikel im Idealfall genau einmal verlinkt, maximal zweimal - und ein zweites Mal nur dann, wenn der Ankertext sich komplett vom ersten unterscheidet und der Link an dieser Stelle wirklich hilft.

In <bereits_gesetzte_links> stehen alle URLs, die in frueheren Abschnitten schon verlinkt wurden, samt Ankertext. Eine dort mit 2 Verwendungen aufgefuehrte URL verlinkst du nicht mehr. Eine dort mit 1 Verwendung aufgefuehrte URL verlinkst du nur mit einem komplett anderen Ankertext.

In <geprüfte_links> sind bereits einmal genutzte Links entsprechend markiert. Nicht jeder Abschnitt braucht einen Link: Wenn kein passender, noch freier Link existiert, setze in diesem Abschnitt keinen.

Organische Integration: Integriere Links ausschließlich natürlich fließend in den bestehenden Satzbau. Erschaffe niemals künstliche Call-to-Action-Sätze (wie z. B. „Weitere Tipps findest du im Artikel über X" oder „Mehr dazu liest du hier:").

Wenn sich ein Link-Ankertext nicht grammatikalisch sinnvoll und unsichtbar in den bestehenden Fließtext einbauen lässt, lass den Link komplett weg!

Der Ankertext muss zwingend zum Thema der Zielseite passen. Lieber kein Link als ein irreführender.

Erfinde niemals eine URL. Verwende nur die aus <geprüfte_links>.

Falls eine Tabelle übergeben wurde, füge sie unverändert an passender Stelle ein. Erzeuge keine eigenen Tabellen.

Format: [H2: ...] bzw. [H3: ...], darunter Fließtext, Listen als Bullets,
Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '2026-09-10 10:08:15.327166+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('fa27bf8b-df4f-457e-bb0f-e24a08079666', 'b51ad427-e939-4a70-aa7c-bcf54079134f', 2, 'Du wählst interne Verlinkungen aus. Du gibst niemals URLs aus, nur Nummern. Antworte ausschließlich mit gültigem JSON.', 'Wähle die beste interne Verlinkung für einen Ankertext.

<ankertext>{{anchor}}</ankertext>
<kontext>{{context_sentence}}</kontext>

<kandidaten>
{{candidates}}
</kandidaten>

Wähle nur eine Seite, deren HAUPTTHEMA dem entspricht, was der Ankertext verspricht.
Eine thematische Nachbarschaft reicht nicht: Wenn der Ankertext ein Symptom nennt,
die Seite aber eine mögliche Ursache oder eine Behandlung behandelt, ist das ein
Mismatch und du antwortest mit null. Der Nutzer muss nach dem Klick genau das finden,
was der Ankertext ankündigt.
Wenn keine Seite wirklich passt, antworte mit null. Rate nicht und wähle nicht
„die am wenigsten schlechte".

Antworte nur mit JSON:
{"choice": <nummer>|null, "confidence":"hoch"|"mittel"|"niedrig", "reason":"1 Satz"}', 'gpt-4o-mini', 0.1, 1500, NULL, 'json', '2026-09-10 10:08:23.153227+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('55a25342-28fd-47e6-b9e2-5256354f7ef1', 'fda17a6c-e226-4d20-b23b-931d9fa583ec', 2, 'Du lokalisierst Tabellen. Antworte ausschließlich mit gültigem JSON.', 'Lokalisiere diese Tabelle nach {{language}}.

<tabelle>{{table_markdown}}</tabelle>
<hinweise>{{market_notes}}</hinweise>

Regeln:
- Zeilenzahl und Reihenfolge exakt beibehalten
- Maßeinheiten beibehalten
- Rassebezeichnungen und Fachbegriffe in die landesübliche Form bringen
- Keine Zeile zusammenfassen oder auslassen

Antworte nur mit JSON:
{"table_markdown":"die vollständige lokalisierte Tabelle als Markdown, gleiche Zeilenzahl wie das Original"}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '2026-09-17 07:37:54.787851+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('f7d1eaf9-20c5-490d-be98-d4711e60d05f', '6063ff65-72ec-40d3-9e71-647906d1ed2e', 9, 'Du bist erfahrene:r Redakteur:in für Tierratgeber-Content und schreibst ausschließlich in der Zielsprache. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
{{action}}
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<bereits_geschriebener_artikel>{{previous_content}}</bereits_geschriebener_artikel>
<bereits_gesetzte_links>{{used_links}}</bereits_gesetzte_links>
<geprüfte_links>{{verified_links}}</geprüfte_links>
{{table_markdown}}
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (härteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches
Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklärung, keine deutschen
Überschriften, Listenpunkte, Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbände, Gesetze, Studien) nur, wenn sie der offizielle Name sind
UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklären.

Fachbegriffe in der landesüblichen Form der Zielsprache, nicht wörtlich aus dem Deutschen.

Prüfe deinen Text vor der Ausgabe Wort für Wort auf deutsche Reste und ersetze sie.

MARKEN- UND SERVICE-AUSSAGEN:

Services der Marke (z. B. Online-Tierarzt/Online-Doc, Tierarzt-Hotline, Kundenkarte,
Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT
automatisch im Zielmarkt, nur weil sie im deutschen Original stehen.

Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> oder in den
 ausdrücklich für {{country}} bestätigt ist.

Sonst: Aussage neutral umformulieren (z. B. „wende dich an deine Tierärztin oder
deinen Tierarzt") oder ersatzlos streichen. Niemals raten, niemals „vermutlich".

Aussagen aus <verbotene_aussagen> kommen nicht vor.

Genauso für Rechtslage, Zuchtverbände, Versicherungspflichten, Preise und
Verfügbarkeiten: keine Übernahme deutscher Gegebenheiten ohne Bestätigung.

ÜBERSCHRIFTEN UND META:

Die erste Zeile deines Outputs ist die Überschrift, exakt in dieser Form: {{heading_markup}} (Ebene H{{heading_level}} – genau so viele Rauten, niemals eine andere Ebene). Verwende exakt die vorgegebene <ziel_ueberschrift>, aber in korrekter
Groß-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug.

Übernimm keine Meta-Zeilen aus dem Original (Datum, Lesezeit, Autor). Falls der Abschnitt
eine Lesezeit enthalten muss, berechne sie aus der tatsächlichen Wortzahl deines
Zieltextes (ca. 200 Wörter pro Minute), nie aus dem deutschen Text.

INHALT & LÄNGE (STRIKT):

Textlänge wahren: Lokalisieren bedeutet NICHT, den Text künstlich aufzublähen. Bleibe in der Wortanzahl so nah wie möglich am deutschen Original. Dichte keine neuen Sätze, eigenen Tipps, Ratschläge oder Erklärungen hinzu, die nicht im Original stehen.

FORMAT EXAKT BEIBEHALTEN (STRIKT): Übernimm die Struktur des Originals 1:1. Was im <de_original> ein Absatz ist (Zeile ohne "- " am Anfang), bleibt Fließtext. Was dort ein Listenpunkt ist (Zeile beginnt mit "- "), bleibt ein Listenpunkt in derselben Reihenfolge und Anzahl.

Stichpunkte stehen ausschließlich dort, wo im <de_original> Stichpunkte stehen. Gibt es im Abschnitt keinen einzigen Listenpunkt, enthält dein Abschnitt keine Liste. Gibt es Listenpunkte, bleiben sie Listenpunkte und werden nicht zu Fließtext zusammengezogen. Zähle vor der Ausgabe die Listenpunkte im Original und in deinem Text: die Anzahl muss übereinstimmen.

Wandle niemals Fließtext oder einzelne Absätze in Stichpunkte um und niemals Stichpunkte in Fließtext. Erfinde keine zusätzlichen Listen, Zwischenüberschriften oder Aufzählungen. Auch die Anzahl der Absätze bleibt gleich. Bestehende Listenpunkte bleiben kurz und prägnant.

KEINE INHALTLICHEN ZUSÄTZE (STRIKT): Übertrage ausschließlich die Aussagen des <de_original>. Jede Aussage deines Textes muss sich einem Satz des Originals zuordnen lassen.

Füge keine zusätzlichen Beispiele, Begriffe, Aufzählungsglieder, Mengenangaben oder Kategorien hinzu, auch wenn sie fachlich naheliegen oder die Aussage vollständiger wirken ließen.

Ergänze keine Einschränkungen, Bedingungen, Warnungen, Empfehlungen oder Voraussetzungen, die im Original nicht stehen. Schwäche und verschärfe Aussagen nicht: eine im Original allgemein formulierte Aussage bleibt allgemein, eine eingeschränkte bleibt genau so eingeschränkt.

Erweitere keine Begriffe um weitere Bestandteile und ziehe keine eigenen Schlussfolgerungen. Was im Original offen bleibt, bleibt auch im Zieltext offen. Nur ausdrückliche Anweisungen aus den Lokalisierungshinweisen dürfen den Inhalt verändern.

SPRACHBILDER VERMEIDEN (STRIKT): Formuliere so sachlich und nüchtern wie das Original. Verwende keine Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen, Wortspiele oder ausgeschmückten Umschreibungen, die im Original keine Entsprechung haben.

Nenne Tiere, Personen, Produkte und Sachverhalte mit ihrer normalen Bezeichnung. Steht im Original ein Bild oder eine bildhafte Wendung, übertrage sie sinngemäß in eine landesübliche Form, erfinde aber keine neuen.

Keine Footer-Erweiterungen: Elemente am Ende des Textes (wie „Passende Produkte", „Weitere Beiträge", „Weitere Themen") werden, falls vorhanden, nur exakt übersetzt. Schreibe hierzu niemals eigenständig neue Einleitungen oder erklärende Sätze.

Zeichensetzung: Verzichte auf den übermäßigen Gebrauch von Gedankenstrichen (–). Nutze eine klare, direkte Satzstruktur.

Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog, aber ohne den Text durch Füllwörter, Ausschmückungen oder bildhafte Vergleiche zu verlängern.

Fettungen () an denselben Stellen wie im Original belassen.

ANSCHLUSS AN DIE VORHERIGEN ABSCHNITTE (STRIKT):

Die Abschnitte werden von oben nach unten geschrieben. In <bereits_geschriebener_artikel> steht der komplette bisher geschriebene Artikel. Lies ihn vor dem Schreiben.

Wiederhole keine Aussage, keinen Hinweis und kein Beispiel, das dort schon steht. Baue auf dem bisherigen Text auf, statt ihn neu zu erzaehlen.

Allgemeine Sicherheits- und Gesundheitshinweise (z. B. "bei Problemen tieraerztlichen Rat einholen", "im Zweifel die Tierarztpraxis aufsuchen") kommen im gesamten Artikel GENAU EINMAL vor. Steht ein solcher Hinweis bereits in <bereits_geschriebener_artikel>, wiederhole ihn nicht, auch nicht umformuliert, auch nicht als Nebensatz. Nur wenn er noch nirgends vorkommt und in diesen Abschnitt inhaltlich am besten passt, schreibe ihn hier.

Dasselbe gilt fuer wiederkehrende Standardsaetze zu Ernaehrung, Versicherung, Anschaffungskosten oder Rasseeignung: einmal im Artikel, nicht pro Abschnitt.

VERLINKUNG (STRIKT):

Maximale Link-Anzahl: Jede Ziel-URL wird im GESAMTEN Artikel im Idealfall genau einmal verlinkt, maximal zweimal - und ein zweites Mal nur dann, wenn der Ankertext sich komplett vom ersten unterscheidet und der Link an dieser Stelle wirklich hilft.

In <bereits_gesetzte_links> stehen alle URLs, die in frueheren Abschnitten schon verlinkt wurden, samt Ankertext. Eine dort mit 2 Verwendungen aufgefuehrte URL verlinkst du nicht mehr. Eine dort mit 1 Verwendung aufgefuehrte URL verlinkst du nur mit einem komplett anderen Ankertext.

In <geprüfte_links> sind bereits einmal genutzte Links entsprechend markiert. Nicht jeder Abschnitt braucht einen Link: Wenn kein passender, noch freier Link existiert, setze in diesem Abschnitt keinen.

Organische Integration: Integriere Links ausschließlich natürlich fließend in den bestehenden Satzbau. Erschaffe niemals künstliche Call-to-Action-Sätze (wie z. B. „Weitere Tipps findest du im Artikel über X" oder „Mehr dazu liest du hier:").

Wenn sich ein Link-Ankertext nicht grammatikalisch sinnvoll und unsichtbar in den bestehenden Fließtext einbauen lässt, lass den Link komplett weg!

Der Ankertext muss zwingend zum Thema der Zielseite passen. Lieber kein Link als ein irreführender.

Erfinde niemals eine URL. Verwende nur die aus <geprüfte_links>.

TABELLE (PFLICHT):

Wenn <tabelle_pflicht> eine Tabelle enthält, MUSS diese Tabelle vollständig und Zeile für Zeile unverändert im Abschnitt stehen. Weglassen, Kürzen, Umschreiben oder Auflösen in Stichpunkte ist nicht erlaubt.

Die Stelle [TABELLE HIER EINFÜGEN] im <de_original> zeigt die Position. Gib den Marker selbst nie aus, sondern setze dort die Tabelle ein.

Enthält <tabelle_pflicht> keine Tabelle, erzeuge auch keine.

Format: Überschrift wie oben vorgegeben, darunter Fließtext und Listen exakt wie im Original, Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '2026-09-17 07:37:54.787851+00', 'ffa437a1-a834-4236-a389-78e1a3fde288') ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('86f19331-4666-4379-9400-00905b8194c4', '22c13880-85b2-4cae-ad6f-9d2e4753fc39', 3, 'Du bist Schlussredakteur:in und prüfst lokalisierten Content. Antworte ausschließlich mit gültigem JSON.', 'Prüfe diesen lokalisierten Artikel auf Fehler.

<artikel>{{full_text}}</artikel>
<zielsprache>{{language}}</zielsprache>
<zielland>{{country}}</zielland>
<marke>{{brand}}</marke>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_begriffe>{{forbidden_terms}}</verbotene_begriffe>

Prüfe streng auf:
1. SPRACHE: jedes deutsche Wort, jeden deutschen Halbsatz, deutsche Überschriften,
   Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen. Liste jeden Fund einzeln
   mit dem gefundenen Wortlaut auf (type: "sprache").
2. SERVICE-AUSSAGEN: Behauptungen über Angebote der Marke (Online-Tierarzt, Hotline,
   Kundenkarte, App, Lieferdienst, Versicherung, Filialservice), die nicht in
   <institutionen_im_zielmarkt> bestätigt sind (type: "unbestaetigter_service").
   Ebenso deutsche Rechtslage, Verbände oder Pflichten ohne Bestätigung für {{country}}.
3. LINKS: Ankertext passt thematisch nicht zur Ziel-URL (type: "link_mismatch"),
   erfundene oder unvollständige Links.
4. FORMAT: Überschriften komplett kleingeschrieben oder als Slug (type: "ueberschrift"),
   doppelte Überschriften, defekte Markdown-Tabellen.
5. META: Lesezeit oder Datum offensichtlich aus dem deutschen Original übernommen.
   Berechne die Lesezeit aus der Wortzahl des vorliegenden Textes (ca. 200 Wörter/Minute)
   und melde eine Abweichung (type: "lesezeit") mit dem korrekten Wert als suggestion.
6. INHALTLICHE ZUSÄTZE: Aussagen, Beispiele, Begriffe, Einschränkungen, Bedingungen,
   Warnungen oder Empfehlungen, die über den Inhalt der Quelle hinausgehen oder deren
   Reichweite verändern (type: "inhaltlicher_zusatz").
7. SPRACHBILDER: Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen und
   Wortspiele ohne Entsprechung in der Quelle (type: "sprachbild").
8. FORMATABWEICHUNG: Stichpunktlisten, wo die Quelle Fließtext hat, oder Fließtext,
   wo die Quelle Stichpunkte hat; abweichende Anzahl an Listenpunkten (type: "format").
9. Falscher Markenname, inkonsistente Ansprache, verbotene Begriffe.

Antworte nur mit JSON:
{"issues":[{"type":"...","location":"...","found":"...","suggestion":"..."}]}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '2026-09-17 07:37:54.787851+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('b563038b-e6cb-493d-a17f-be6b17ddd0eb', 'fda17a6c-e226-4d20-b23b-931d9fa583ec', 3, 'Du lokalisierst Tabellen. Antworte ausschließlich mit gültigem JSON.', 'Lokalisiere diese Tabelle nach {{language}}.

<tabelle>{{table_markdown}}</tabelle>
<hinweise>{{market_notes}}</hinweise>

Regeln:
- Zeilenzahl und Reihenfolge exakt beibehalten
- Maßeinheiten beibehalten
- Rassebezeichnungen und Fachbegriffe in die landesübliche Form bringen
- Keine Zeile zusammenfassen oder auslassen

Antworte nur mit JSON:
{"table_markdown":"die vollständige lokalisierte Tabelle als Markdown, gleiche Zeilenzahl wie das Original"}', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '2026-09-17 07:53:11.919099+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('01c06090-93cc-42dc-851a-cb8c66b84cdd', '6063ff65-72ec-40d3-9e71-647906d1ed2e', 10, 'Du bist erfahrene:r Redakteur:in für Tierratgeber-Content und schreibst ausschließlich in der Zielsprache. Gib nur den fertigen Abschnitt aus.', 'Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<de_original>{{de_section}}</de_original>
{{action}}
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<bereits_geschriebener_artikel>{{previous_content}}</bereits_geschriebener_artikel>
<bereits_gesetzte_links>{{used_links}}</bereits_gesetzte_links>
<geprüfte_links>{{verified_links}}</geprüfte_links>
<tabellenmarker>{{table_markers}}</tabellenmarker>\n<wortzahl_quelle>{{source_word_count}}</wortzahl_quelle>\n<wortlimit_ziel>{{max_target_words}}</wortlimit_ziel>\n<listenpunkte_quelle>{{source_list_items}}</listenpunkte_quelle>\n<absaetze_quelle>{{source_paragraphs}}</absaetze_quelle>\n<korrekturhinweise>{{correction_notes}}</korrekturhinweise>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (härteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches
Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklärung, keine deutschen
Überschriften, Listenpunkte, Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbände, Gesetze, Studien) nur, wenn sie der offizielle Name sind
UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklären.

Fachbegriffe in der landesüblichen Form der Zielsprache, nicht wörtlich aus dem Deutschen.

Prüfe deinen Text vor der Ausgabe Wort für Wort auf deutsche Reste und ersetze sie.

MARKEN- UND SERVICE-AUSSAGEN:

Services der Marke (z. B. Online-Tierarzt/Online-Doc, Tierarzt-Hotline, Kundenkarte,
Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT
automatisch im Zielmarkt, nur weil sie im deutschen Original stehen.

Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> oder in den
 ausdrücklich für {{country}} bestätigt ist.

Sonst: Aussage neutral umformulieren (z. B. „wende dich an deine Tierärztin oder
deinen Tierarzt") oder ersatzlos streichen. Niemals raten, niemals „vermutlich".

Aussagen aus <verbotene_aussagen> kommen nicht vor.

Genauso für Rechtslage, Zuchtverbände, Versicherungspflichten, Preise und
Verfügbarkeiten: keine Übernahme deutscher Gegebenheiten ohne Bestätigung.

ÜBERSCHRIFTEN UND META:

Die erste Zeile deines Outputs ist die Überschrift, exakt in dieser Form: {{heading_markup}} (Ebene H{{heading_level}} – genau so viele Rauten, niemals eine andere Ebene). Verwende exakt die vorgegebene <ziel_ueberschrift>, aber in korrekter
Groß-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug.

Übernimm keine Meta-Zeilen aus dem Original (Datum, Lesezeit, Autor). Falls der Abschnitt
eine Lesezeit enthalten muss, berechne sie aus der tatsächlichen Wortzahl deines
Zieltextes (ca. 200 Wörter pro Minute), nie aus dem deutschen Text.

INHALT & LÄNGE (STRIKT):

Textlänge wahren: Lokalisieren bedeutet NICHT, den Text künstlich aufzublähen. Bleibe in der Wortanzahl so nah wie möglich am deutschen Original. Dichte keine neuen Sätze, eigenen Tipps, Ratschläge oder Erklärungen hinzu, die nicht im Original stehen.

FORMAT EXAKT BEIBEHALTEN (STRIKT): Übernimm die Struktur des Originals 1:1. Was im <de_original> ein Absatz ist (Zeile ohne "- " am Anfang), bleibt Fließtext. Was dort ein Listenpunkt ist (Zeile beginnt mit "- "), bleibt ein Listenpunkt in derselben Reihenfolge und Anzahl.

Stichpunkte stehen ausschließlich dort, wo im <de_original> Stichpunkte stehen. Gibt es im Abschnitt keinen einzigen Listenpunkt, enthält dein Abschnitt keine Liste. Gibt es Listenpunkte, bleiben sie Listenpunkte und werden nicht zu Fließtext zusammengezogen. Zähle vor der Ausgabe die Listenpunkte im Original und in deinem Text: die Anzahl muss übereinstimmen.

Wandle niemals Fließtext oder einzelne Absätze in Stichpunkte um und niemals Stichpunkte in Fließtext. Erfinde keine zusätzlichen Listen, Zwischenüberschriften oder Aufzählungen. Auch die Anzahl der Absätze bleibt gleich. Bestehende Listenpunkte bleiben kurz und prägnant.

KEINE INHALTLICHEN ZUSÄTZE (STRIKT): Übertrage ausschließlich die Aussagen des <de_original>. Jede Aussage deines Textes muss sich einem Satz des Originals zuordnen lassen.

Füge keine zusätzlichen Beispiele, Begriffe, Aufzählungsglieder, Mengenangaben oder Kategorien hinzu, auch wenn sie fachlich naheliegen oder die Aussage vollständiger wirken ließen.

Ergänze keine Einschränkungen, Bedingungen, Warnungen, Empfehlungen oder Voraussetzungen, die im Original nicht stehen. Schwäche und verschärfe Aussagen nicht: eine im Original allgemein formulierte Aussage bleibt allgemein, eine eingeschränkte bleibt genau so eingeschränkt.

Erweitere keine Begriffe um weitere Bestandteile und ziehe keine eigenen Schlussfolgerungen. Was im Original offen bleibt, bleibt auch im Zieltext offen. Nur ausdrückliche Anweisungen aus den Lokalisierungshinweisen dürfen den Inhalt verändern.

SPRACHBILDER VERMEIDEN (STRIKT): Formuliere so sachlich und nüchtern wie das Original. Verwende keine Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen, Wortspiele oder ausgeschmückten Umschreibungen, die im Original keine Entsprechung haben.

Nenne Tiere, Personen, Produkte und Sachverhalte mit ihrer normalen Bezeichnung. Steht im Original ein Bild oder eine bildhafte Wendung, übertrage sie sinngemäß in eine landesübliche Form, erfinde aber keine neuen.

Keine Footer-Erweiterungen: Elemente am Ende des Textes (wie „Passende Produkte", „Weitere Beiträge", „Weitere Themen") werden, falls vorhanden, nur exakt übersetzt. Schreibe hierzu niemals eigenständig neue Einleitungen oder erklärende Sätze.

Zeichensetzung: Verzichte auf den übermäßigen Gebrauch von Gedankenstrichen (–). Nutze eine klare, direkte Satzstruktur.

Ansprechender, freundlicher, lifestyle-orientierter Ton für einen Tierpflege-Blog, aber ohne den Text durch Füllwörter, Ausschmückungen oder bildhafte Vergleiche zu verlängern.

Fettungen () an denselben Stellen wie im Original belassen.

ANSCHLUSS AN DIE VORHERIGEN ABSCHNITTE (STRIKT):

Die Abschnitte werden von oben nach unten geschrieben. In <bereits_geschriebener_artikel> steht der komplette bisher geschriebene Artikel. Lies ihn vor dem Schreiben.

Wiederhole keine Aussage, keinen Hinweis und kein Beispiel, das dort schon steht. Baue auf dem bisherigen Text auf, statt ihn neu zu erzaehlen.

Allgemeine Sicherheits- und Gesundheitshinweise (z. B. "bei Problemen tieraerztlichen Rat einholen", "im Zweifel die Tierarztpraxis aufsuchen") kommen im gesamten Artikel GENAU EINMAL vor. Steht ein solcher Hinweis bereits in <bereits_geschriebener_artikel>, wiederhole ihn nicht, auch nicht umformuliert, auch nicht als Nebensatz. Nur wenn er noch nirgends vorkommt und in diesen Abschnitt inhaltlich am besten passt, schreibe ihn hier.

Dasselbe gilt fuer wiederkehrende Standardsaetze zu Ernaehrung, Versicherung, Anschaffungskosten oder Rasseeignung: einmal im Artikel, nicht pro Abschnitt.

VERLINKUNG (STRIKT):

Maximale Link-Anzahl: Jede Ziel-URL wird im GESAMTEN Artikel im Idealfall genau einmal verlinkt, maximal zweimal - und ein zweites Mal nur dann, wenn der Ankertext sich komplett vom ersten unterscheidet und der Link an dieser Stelle wirklich hilft.

In <bereits_gesetzte_links> stehen alle URLs, die in frueheren Abschnitten schon verlinkt wurden, samt Ankertext. Eine dort mit 2 Verwendungen aufgefuehrte URL verlinkst du nicht mehr. Eine dort mit 1 Verwendung aufgefuehrte URL verlinkst du nur mit einem komplett anderen Ankertext.

In <geprüfte_links> sind bereits einmal genutzte Links entsprechend markiert. Nicht jeder Abschnitt braucht einen Link: Wenn kein passender, noch freier Link existiert, setze in diesem Abschnitt keinen.

Organische Integration: Integriere Links ausschließlich natürlich fließend in den bestehenden Satzbau. Erschaffe niemals künstliche Call-to-Action-Sätze (wie z. B. „Weitere Tipps findest du im Artikel über X" oder „Mehr dazu liest du hier:").

Wenn sich ein Link-Ankertext nicht grammatikalisch sinnvoll und unsichtbar in den bestehenden Fließtext einbauen lässt, lass den Link komplett weg!

Der Ankertext muss zwingend zum Thema der Zielseite passen. Lieber kein Link als ein irreführender.

Erfinde niemals eine URL. Verwende nur die aus <geprüfte_links>.

TABELLE (PFLICHT):

Wenn <tabelle_pflicht> eine Tabelle enthält, MUSS diese Tabelle vollständig und Zeile für Zeile unverändert im Abschnitt stehen. Weglassen, Kürzen, Umschreiben oder Auflösen in Stichpunkte ist nicht erlaubt.

Die Stelle [TABELLE HIER EINFÜGEN] im <de_original> zeigt die Position. Gib den Marker selbst nie aus, sondern setze dort die Tabelle ein.

Enthält <tabelle_pflicht> keine Tabelle, erzeuge auch keine.

Format: Überschrift wie oben vorgegeben, darunter Fließtext und Listen exakt wie im Original, Bildhinweise als [Image – kurze Bildbeschreibung in der Zielsprache].

Gib nur den fertigen Abschnitt aus, keine Erklärungen.', 'gpt-4o', 0.6, 6000, NULL, 'text', '2026-09-17 07:53:11.919099+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.prompt_versions VALUES ('68e14770-6e7f-4d93-8fcb-18bb66346eb9', '22c13880-85b2-4cae-ad6f-9d2e4753fc39', 4, 'Du bist Schlussredakteur:in und prüfst lokalisierten Content. Antworte ausschließlich mit gültigem JSON.', 'Prüfe diesen lokalisierten Artikel auf Fehler.

<artikel>{{full_text}}</artikel>\n<quelle>{{source_text}}</quelle>\n<lokalisierte_tabellen>{{localized_tables}}</lokalisierte_tabellen>\n<strukturbericht>{{structure_report}}</strukturbericht>
<zielsprache>{{language}}</zielsprache>
<zielland>{{country}}</zielland>
<marke>{{brand}}</marke>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_begriffe>{{forbidden_terms}}</verbotene_begriffe>

Prüfe streng auf:
1. SPRACHE: jedes deutsche Wort, jeden deutschen Halbsatz, deutsche Überschriften,
   Bildhinweise, Tabellenzellen oder Einheitenbezeichnungen. Liste jeden Fund einzeln
   mit dem gefundenen Wortlaut auf (type: "sprache").
2. SERVICE-AUSSAGEN: Behauptungen über Angebote der Marke (Online-Tierarzt, Hotline,
   Kundenkarte, App, Lieferdienst, Versicherung, Filialservice), die nicht in
   <institutionen_im_zielmarkt> bestätigt sind (type: "unbestaetigter_service").
   Ebenso deutsche Rechtslage, Verbände oder Pflichten ohne Bestätigung für {{country}}.
3. LINKS: Ankertext passt thematisch nicht zur Ziel-URL (type: "link_mismatch"),
   erfundene oder unvollständige Links.
4. FORMAT: Überschriften komplett kleingeschrieben oder als Slug (type: "ueberschrift"),
   doppelte Überschriften, defekte Markdown-Tabellen.
5. META: Lesezeit oder Datum offensichtlich aus dem deutschen Original übernommen.
   Berechne die Lesezeit aus der Wortzahl des vorliegenden Textes (ca. 200 Wörter/Minute)
   und melde eine Abweichung (type: "lesezeit") mit dem korrekten Wert als suggestion.
6. INHALTLICHE ZUSÄTZE: Aussagen, Beispiele, Begriffe, Einschränkungen, Bedingungen,
   Warnungen oder Empfehlungen, die über den Inhalt der Quelle hinausgehen oder deren
   Reichweite verändern (type: "inhaltlicher_zusatz").
7. SPRACHBILDER: Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen und
   Wortspiele ohne Entsprechung in der Quelle (type: "sprachbild").
8. FORMATABWEICHUNG: Stichpunktlisten, wo die Quelle Fließtext hat, oder Fließtext,
   wo die Quelle Stichpunkte hat; abweichende Anzahl an Listenpunkten (type: "format").
9. Falscher Markenname, inkonsistente Ansprache, verbotene Begriffe.

Antworte nur mit JSON:
{"issues":[{"type":"...","location":"...","found":"...","suggestion":"..."}]}
10. TABELLEN: Jede lokalisierte Tabelle muss exakt einmal, unverändert und im zugehörigen Abschnitt stehen. Zusätzliche, doppelte, umformulierte oder widersprüchliche Tabellen sind Fehler (type: "tabelle").
11. UMFANG: Vergleiche Quelle und Ziel je Abschnitt. Melde eine deutliche Verlängerung, insbesondere neue Absätze oder wiederholte Hinweise (type: "laenge").
12. LOKALISIERUNGSKONSISTENZ: Melde widersprüchliche Markt-, Rechts- oder Institutionsaussagen zwischen Fließtext und Tabelle sowie nicht lokalisierte marktgebundene Aussagen (type: "lokalisierung").', 'gpt-4o-mini', 0.2, 4000, NULL, 'json', '2026-09-17 07:53:11.919099+00', NULL) ON CONFLICT DO NOTHING;


--
--


-- 12.3b Vereinfachte Pipeline (Migration 0010): Spalte localization_notes + Prompts
-- localization_scan, localize_document, localization_review (idempotent)

ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS localization_notes text;

-- ---------------------------------------------------------------------------
-- Schritt 2 · localization_scan
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'localization_scan',
  '2 · DE-Bezüge finden',
  'Findet alle deutschlandspezifischen Stellen im Quelldokument und entscheidet je Fund: ersetzen, neutral oder streichen.',
  $sys$Du bist Lokalisierungs-Analyst:in für internationale Retail-Marken im Heimtierbereich. Du findest Stellen in deutschen Texten, die nur für Deutschland gelten. Du übersetzt nichts. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$Ein deutscher Ratgeberartikel wird für {{country}} ({{language}}, {{language_variant}}) lokalisiert. Marke im Zielmarkt: {{brand}}.

Deine Aufgabe: Finde JEDE Stelle, die nur für Deutschland gilt oder auf Deutschland verweist, und entscheide, wie sie im Zielmarkt behandelt wird.

<marktprofil>{{market_profile}}</marktprofil>
<institutionen_zuordnung>{{institutions}}</institutionen_zuordnung>
<verbotene_begriffe>{{forbidden_claims}}</verbotene_begriffe>
<lokalisierungshinweise>{{localization_notes}}</lokalisierungshinweise>

<seitentitel>{{source_title}}</seitentitel>
<meta_description>{{source_meta_description}}</meta_description>

Das Dokument als nummerierte Blöcke (eine JSON-Zeile pro Block, "id" = Block-ID):
<bloecke>
{{blocks}}
</bloecke>

SUCHE NACH:
- Behörden, Ämter, Ministerien, amtliche Stellen (category "behoerde")
- Gesetzen, Verordnungen, Pflichten, Steuern, Melde- oder Versicherungspflichten (category "gesetz")
- Verbänden, Vereinen, Zuchtverbänden, Prüfungen, Zertifikaten (category "organisation")
- Services, Hotlines, Apps, Kundenkarten, Online-Angeboten der Marke oder Dritter (category "service")
- Maßen, Einheiten, Statistiken und Zahlen mit Deutschlandbezug (category "zahl_einheit")
- Preisen und Währungsangaben (category "waehrung")
- Angeboten, Produkten, Aktionen, Filialen von Fressnapf Deutschland; jede Nennung von „Fressnapf“, wenn die Marke im Zielmarkt {{brand}} heißt (category "angebot")
- deutschen Quellen, Studien, Websites und Quellenangaben (category "quelle")
- sonstigen Aussagen mit Deutschlandbezug, z. B. „in Deutschland“, deutsche Regionen, Feiertage, Klima (category "sonstiges")

ENTSCHEIDUNG je Fund:
1. "ersetzen": Im Zielland gibt es ein passendes, real existierendes Gegenstück. Nenne es in "target_equivalent" in der Zielsprache. Eine Zuordnung aus <institutionen_zuordnung> oder <lokalisierungshinweise> hat immer Vorrang.
2. "neutral": Es gibt kein Gegenstück. Die Aussage bleibt erhalten, wird aber allgemein formuliert, ohne die deutsche Institution, das Gesetz oder den Service zu nennen. Steht ein Begriff in <institutionen_zuordnung> auf null, ist die Entscheidung immer "neutral".
3. "streichen": Die Aussage ist für {{country}} nicht relevant (z. B. ein Service, den es dort nicht gibt, oder eine rein deutsche Quellenangabe) und ein allgemeiner Satz ergäbe keinen Sinn.
4. Im Zweifel nichts erfinden: lieber "neutral" als ein unsicheres Gegenstück.

REGELN:
- "block_ids" enthält nur IDs aus <bloecke>, in denen die Stelle vorkommt.
- "de_reference" ist der wörtliche, kurze deutsche Ausdruck aus dem Text (z. B. „VDH“, „Brauchbarkeitsprüfung“, „In Deutschland“).
- "instruction" ist eine konkrete Anweisung für die Übersetzung in einem Satz (auf Deutsch).
- Allgemeingültige Inhalte (Rassebeschreibung, Pflege, Verhalten, Gesundheit) sind KEINE Funde.
- Begriffe aus <verbotene_begriffe> sind immer ein Fund.
- Wenn es keine Funde gibt, antworte mit {"findings":[]}.

Antworte nur mit JSON:
{"findings":[{"block_ids":["b12"],"de_reference":"...","category":"behoerde|gesetz|organisation|service|zahl_einheit|waehrung|angebot|quelle|sonstiges","decision":"ersetzen|neutral|streichen","target_equivalent":"Gegenstück in der Zielsprache oder null","instruction":"..."}]}$usr$,
  'gpt-4o', 0.2, 4000, NULL, 'json',
  '["country","language","language_variant","brand","address_form","market_profile","institutions","forbidden_claims","localization_notes","source_title","source_meta_description","blocks"]'::jsonb,
  1, true, 1
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Schritt 3 · localize_document
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'localize_document',
  '3 · Lokalisieren',
  'Übersetzt das Dokument blockweise und wendet die Funde an. Liefert je Block-ID nur Inhalt; die Struktur bleibt beim Code.',
  $sys$Du bist professionelle:r Übersetzer:in und Lokalisierer:in für Tierratgeber-Content. Du übersetzt Block für Block vollständig und treu und lieferst nur den Inhalt je Block-ID. Du erfindest keine Struktur. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$Übersetze und lokalisiere Blöcke eines deutschen Ratgeberartikels nach {{language}} ({{language_variant}}) für {{country}}. Marke: {{brand}}. Anrede: {{address_form}}.
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
1. Vollständig und treu übersetzen. Nichts zusammenfassen, nichts weglassen, nichts hinzufügen. Keine neuen Absätze, Listen, Listenpunkte, Überschriften oder Tabellen.
2. Gib für JEDE erwartete Block-ID genau einen Eintrag mit unveränderter "id" zurück:
   - heading, paragraph, quote → {"id":"…","text":"…"}
   - list → {"id":"…","items":[…]} mit exakt derselben Anzahl und Verschachtelung wie in der Quelle. Ein Listenpunkt mit Unterliste wird zu {"text":"…","children":[…]}, sonst ist er ein String.
   - table → {"id":"…","rows":[[…]]} mit exakt derselben Zeilen- und Spaltenzahl. Leere Zellen bleiben leer, "<br>" in Zellen bleibt erhalten.
3. Funde exakt anwenden:
   - "ersetzen": den deutschen Verweis durch "target_equivalent" ersetzen.
   - "neutral": die Aussage allgemein formulieren, ohne den deutschen Verweis.
   - "streichen": nur der betroffene Satz bzw. Satzteil entfällt. Wird dadurch der ganze Block leer oder sinnlos, gib {"id":"…","removed":true} zurück. "removed" ist NUR bei Blöcken mit "removable":true erlaubt. Nur bei solchen Listen dürfen Listenpunkte entfallen.
4. Inline-Formatierung erhalten: **fett** und *kursiv* an den entsprechenden Stellen. Kein anderes Markdown: Kein Text beginnt mit "#", "|", "- ", "1. " oder ">", und kein Text enthält Zeilenumbrüche.
5. Anrede konsequent gemäß "{{address_form}}" (informell = Du-Form, formell = Sie-Form bzw. die Entsprechung der Zielsprache).
6. Sprache: ausschließlich {{language}} ({{language_variant}}). Keine deutschen Reste außer Eigennamen ohne Entsprechung. Fachbegriffe in der landesüblichen Form. Begriffe aus <verbotene_begriffe> kommen nicht vor.
7. Überschriften korrekt groß-/kleingeschrieben, nie als Slug.
8. Meta-Daten: include_meta = "{{include_meta}}". Nur wenn "ja", liefere zusätzlich "meta" mit "title" (übersetzter Seitentitel; ein Marken-Suffix wie „| FRESSNAPF“ wird zu „| {{brand}}“), "meta_description" (höchstens 160 Zeichen) und "slug" (kurzer URL-Slug in der Zielsprache, Kleinbuchstaben, Bindestriche).
   Quelle: Titel „{{source_title}}“, Meta-Description „{{source_meta_description}}“.
9. Ist <korrekturhinweise> nicht leer, wurde ein vorheriger Versuch für genau diese Blöcke abgelehnt. Behebe genau diese Punkte.

Antworte nur mit JSON:
{"meta":{"title":"…","meta_description":"…","slug":"…"},"blocks":[{"id":"b1","text":"…"},{"id":"b5","items":["…",{"text":"…","children":["…"]}]},{"id":"b9","rows":[["…","…"]]},{"id":"b12","removed":true}]}$usr$,
  'gpt-4o', 0.3, 16000, NULL, 'json',
  '["country","language","language_variant","brand","address_form","market_profile","institutions","forbidden_claims","localization_notes","outline","findings","blocks","block_ids","part","include_meta","source_title","source_meta_description","correction_notes"]'::jsonb,
  1, true, 2
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Schritt 4 · localization_review
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_templates
  (step_key, name, description, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format, variables, version, is_active, sort_order)
VALUES (
  'localization_review',
  '4 · Review',
  'Prüft die Lokalisierung Block für Block und liefert Korrekturen. Der Code übernimmt nur Korrekturen, die die Strukturprüfung bestehen.',
  $sys$Du bist Schlussredakteur:in für lokalisierte Tierratgeber. Du prüfst Block für Block und lieferst konkrete, vollständige Korrekturen. Antworte ausschließlich mit gültigem JSON.$sys$,
  $usr$Prüfe die Lokalisierung eines deutschen Ratgeberartikels nach {{language}} ({{language_variant}}) für {{country}}. Marke: {{brand}}. Anrede: {{address_form}}.

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
Gestrichene Blöcke: {{removed_block_ids}}

Automatische Prüfungen haben gemeldet:
<code_befunde>
{{deterministic_issues}}
</code_befunde>

PRÜFE je Block:
1. Vollständigkeit und Treue: fehlende, hinzugefügte oder sinnverändernde Aussagen.
2. Funde korrekt angewendet (ersetzen, neutral, streichen): keine deutschen Institutionen, Gesetze, Services oder Quellen mehr, die ersetzt oder neutralisiert werden sollten.
3. Sprache: deutsche Reste, falsche Sprachvariante, Grammatik, Rechtschreibung.
4. Anrede gemäß "{{address_form}}", Marke „{{brand}}“ korrekt geschrieben, keine verbotenen Begriffe aus dem Marktprofil.
5. Jeden Punkt aus <code_befunde>.

KORREKTUR:
- Liefere je Befund in "fix" den VOLLSTÄNDIGEN korrigierten Inhalt des Blocks in derselben Form wie im Ziel: {"text":"…"} oder {"items":[…]} (gleiche Anzahl und Verschachtelung) oder {"rows":[[…]]} (gleiche Zeilen und Spalten).
- Die Struktur nie ändern: keine neuen Absätze, Listenpunkte, Zeilen oder Überschriften; kein Markdown außer **fett** und *kursiv*; keine Zeilenumbrüche.
- Kannst du keinen sicheren Fix angeben, setze "fix": null.
- Melde nichts, was korrekt ist, und keine reinen Stilvorlieben. Ohne Befunde: {"issues":[]}.

Antworte nur mit JSON:
{"issues":[{"block_id":"b7","problem":"kurze Beschreibung","fix":{"text":"…"}}]}$usr$,
  'gpt-4o', 0.2, 8000, NULL, 'json',
  '["country","language","language_variant","brand","address_form","market_profile","findings","source_blocks","target_blocks","removed_block_ids","deterministic_issues"]'::jsonb,
  1, true, 3
)
ON CONFLICT (step_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Versionshistorie (je Vorlage genau ein Eintrag für die aktuelle Version)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key IN ('localization_scan', 'localize_document', 'localization_review')
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );


-- 12.3c Prompt-Version 2 (Migration 0011)
-- ============================================================
-- 0011_prompt_quality_v2.sql – Version 2 der drei Pipeline-Prompts
-- Allgemeingültige Schärfungen aus der Auswertung eines Laufs:
--   Scan:     Fremdwährung, Aussagen über die deutsche Sprache (inkl. eingeführter
--             Namen/Synonyme), stillschweigende DE-Bezüge (Recht, Vorgaben, Preise);
--             block_ids = alle Vorkommen.
--   Localize: muttersprachliche Rolle, „treu = sinngetreu“, Fachbegriffe/Namen/Synonyme
--             zielsprachlich üblich, Redewendungen sinngemäß, Sicherheitsnetz ohne Fund.
--   Review:   muttersprachliche Rolle, Bedeutungsumkehr/Widersprüche, übersehene
--             DE-Bezüge und Fremdwährung, Kongruenz, wörtliche Redewendungen.
-- Aktualisiert nur Vorlagen, die noch auf Version 1 (Stand 0010) stehen – im Admin
-- geänderte Prompts werden nicht überschrieben. Idempotent.
-- ============================================================

-- ---------------------------------------------------------------------------
-- Schritt 2 · localization_scan
-- ---------------------------------------------------------------------------
UPDATE public.prompt_templates SET
  system_prompt = $sys$Du bist Lokalisierungs-Analyst:in für internationale Retail-Marken im Heimtierbereich. Du findest Stellen in deutschen Texten, die nur für Deutschland oder den deutschen Sprachraum gelten. Du übersetzt nichts. Antworte ausschließlich mit gültigem JSON.$sys$,
  user_prompt = $usr$Ein deutscher Ratgeberartikel wird für {{country}} ({{language}}, {{language_variant}}) lokalisiert. Marke im Zielmarkt: {{brand}}.

Deine Aufgabe: Finde JEDE Stelle, die nur für Deutschland gilt oder auf Deutschland verweist, und entscheide, wie sie im Zielmarkt behandelt wird.

<marktprofil>{{market_profile}}</marktprofil>
<institutionen_zuordnung>{{institutions}}</institutionen_zuordnung>
<verbotene_begriffe>{{forbidden_claims}}</verbotene_begriffe>
<lokalisierungshinweise>{{localization_notes}}</lokalisierungshinweise>

<seitentitel>{{source_title}}</seitentitel>
<meta_description>{{source_meta_description}}</meta_description>

Das Dokument als nummerierte Blöcke (eine JSON-Zeile pro Block, "id" = Block-ID):
<bloecke>
{{blocks}}
</bloecke>

SUCHE NACH:
- Behörden, Ämter, Ministerien, amtliche Stellen (category "behoerde")
- Gesetzen, Verordnungen, Pflichten, Steuern, Melde- oder Versicherungspflichten (category "gesetz")
- Aussagen, die stillschweigend deutsches Recht, deutsche Vorgaben oder Verhältnisse voraussetzen, auch ohne das Wort „Deutschland“, z. B. „gesetzlich vorgeschrieben“, „ist Pflicht“, „hierzulande“ (category "gesetz" bzw. "sonstiges")
- Verbänden, Vereinen, Zuchtverbänden, Prüfungen, Zertifikaten (category "organisation")
- Services, Hotlines, Apps, Kundenkarten, Online-Angeboten der Marke oder Dritter (category "service")
- Maßen, Einheiten, Statistiken und Zahlen mit Deutschlandbezug (category "zahl_einheit")
- Preisen und Geldbeträgen in einer Währung, die in {{country}} nicht gilt (category "waehrung"): Entscheidung "ersetzen"; "target_equivalent" ist der zum ungefähren aktuellen Kurs umgerechnete, gerundete Betrag bzw. die Größenordnung in der Landeswährung, formuliert in der Zielsprache (nicht nur die Währungsbezeichnung tauschen)
- Angeboten, Produkten, Aktionen, Filialen von Fressnapf Deutschland; jede Nennung von „Fressnapf“, wenn die Marke im Zielmarkt {{brand}} heißt (category "angebot")
- deutschen Quellen, Studien, Websites und Quellenangaben (category "quelle")
- Aussagen über die deutsche Sprache, z. B. „im deutschsprachigen Raum“, „auf Deutsch heißt“, deutsche Bezeichnungen oder Wortspiele (category "sonstiges"). Führt der Text dabei einen deutschen Namen oder ein Synonym ein, das er weiterverwendet, ist dieser Name ein eigener Fund: "ersetzen" durch die in {{country}} übliche Bezeichnung oder, wenn es keine gibt, durch den Hauptbegriff
- sonstigen Aussagen mit Deutschlandbezug, z. B. „in Deutschland“, deutsche Regionen, Feiertage, Klima (category "sonstiges")

ENTSCHEIDUNG je Fund:
1. "ersetzen": Im Zielland gibt es ein passendes, real existierendes Gegenstück. Nenne es in "target_equivalent" in der Zielsprache. Eine Zuordnung aus <institutionen_zuordnung> oder <lokalisierungshinweise> hat immer Vorrang.
2. "neutral": Es gibt kein Gegenstück. Die Aussage bleibt erhalten, wird aber allgemein formuliert, ohne die deutsche Institution, das Gesetz oder den Service zu nennen. Sachinformationen, die auch in {{country}} gelten, wie Maße und Werte, bleiben erhalten (z. B. als Empfehlung statt als Vorschrift). Steht ein Begriff in <institutionen_zuordnung> auf null, ist die Entscheidung immer "neutral".
3. "streichen": Die Aussage ist für {{country}} nicht relevant (z. B. ein Service, den es dort nicht gibt, oder eine rein deutsche Quellenangabe) und ein allgemeiner Satz ergäbe keinen Sinn. Das gilt auch für Aussagen, die nur durch den deutschen Bezug Sinn ergeben (z. B. deutsche Auszeichnungen, Aktionen, Jubiläen, Rankings oder Statistiken) – allgemein formuliert wären sie inhaltsleer. Betrifft der Fund nur einen Verweis oder Satzteil und bleibt die Aussage ohne ihn sinnvoll, ist die Entscheidung "neutral".
4. Im Zweifel nichts erfinden: lieber "neutral" als ein unsicheres Gegenstück.

REGELN:
- "block_ids" enthält ALLE IDs aus <bloecke>, in denen der Ausdruck vorkommt.
- "de_reference" ist der wörtliche, kurze deutsche Ausdruck aus dem Text (z. B. „VDH“, „Brauchbarkeitsprüfung“, „In Deutschland“).
- "instruction" ist eine konkrete Anweisung für die Übersetzung in einem Satz (auf Deutsch).
- Allgemeingültige Inhalte (Rassebeschreibung, Pflege, Verhalten, Gesundheit) sind KEINE Funde.
- Begriffe aus <verbotene_begriffe> sind immer ein Fund.
- Wenn es keine Funde gibt, antworte mit {"findings":[]}.

Antworte nur mit JSON:
{"findings":[{"block_ids":["b12"],"de_reference":"...","category":"behoerde|gesetz|organisation|service|zahl_einheit|waehrung|angebot|quelle|sonstiges","decision":"ersetzen|neutral|streichen","target_equivalent":"Gegenstück in der Zielsprache oder null","instruction":"..."}]}$usr$,
  version = 2,
  updated_at = now()
WHERE step_key = 'localization_scan' AND version = 1;

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
1. Vollständig und treu übersetzen. Treu heißt: Inhalt und Aussage, nicht Wort für Wort – der Text liest sich, als wäre er in {{country}} geschrieben. Nichts zusammenfassen, nichts weglassen, nichts hinzufügen. Keine neuen Absätze, Listen, Listenpunkte, Überschriften oder Tabellen.
2. Gib für JEDE erwartete Block-ID genau einen Eintrag mit unveränderter "id" zurück:
   - heading, paragraph, quote → {"id":"…","text":"…"}
   - list → {"id":"…","items":[…]} mit exakt derselben Anzahl und Verschachtelung wie in der Quelle. Ein Listenpunkt mit Unterliste wird zu {"text":"…","children":[…]}, sonst ist er ein String.
   - table → {"id":"…","rows":[[…]]} mit exakt derselben Zeilen- und Spaltenzahl. Leere Zellen bleiben leer, "<br>" in Zellen bleibt erhalten.
3. Funde exakt anwenden:
   - "ersetzen": den deutschen Verweis durch "target_equivalent" ersetzen.
   - "neutral": die Aussage allgemein formulieren, ohne den deutschen Verweis; Sachinformationen, die auch in {{country}} gelten, wie Maße und Werte, bleiben erhalten.
   - "streichen": nur der betroffene Satz bzw. Satzteil entfällt; alle übrigen Aussagen des Blocks bleiben erhalten. Bezieht sich der folgende Text auf das Gestrichene (z. B. mit einem Anschlusswort oder Rückbezug), passe nur diese Anknüpfung an, damit der Text stimmig bleibt. Nur wenn der Block ausschließlich aus der gestrichenen Aussage besteht, gib {"id":"…","removed":true} zurück. "removed" ist NUR bei Blöcken mit "removable":true erlaubt. Nur bei solchen Listen dürfen Listenpunkte entfallen.
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

Antworte nur mit JSON:
{"meta":{"title":"…","meta_description":"…","slug":"…"},"blocks":[{"id":"b1","text":"…"},{"id":"b5","items":["…",{"text":"…","children":["…"]}]},{"id":"b9","rows":[["…","…"]]},{"id":"b12","removed":true}]}$usr$,
  version = 2,
  updated_at = now()
WHERE step_key = 'localize_document' AND version = 1;

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
Gestrichene Blöcke: {{removed_block_ids}}

Automatische Prüfungen haben gemeldet:
<code_befunde>
{{deterministic_issues}}
</code_befunde>

PRÜFE je Block:
1. Vollständigkeit und Treue: fehlende, hinzugefügte oder sinnverändernde Aussagen (auch Sachinformationen, die beim Neutralisieren verloren gingen); Fachbegriffe sinngetreu (keine Bedeutungsumkehr), keine inneren Widersprüche.
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
  version = 2,
  updated_at = now()
WHERE step_key = 'localization_review' AND version = 1;

-- ---------------------------------------------------------------------------
-- Versionshistorie (Eintrag für die aktuelle Version, falls noch nicht vorhanden)
-- ---------------------------------------------------------------------------
INSERT INTO public.prompt_versions
  (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, reasoning_effort, response_format)
SELECT t.id, t.version, t.system_prompt, t.user_prompt, t.model, t.temperature, t.max_tokens, t.reasoning_effort, t.response_format
FROM public.prompt_templates t
WHERE t.step_key IN ('localization_scan', 'localize_document', 'localization_review')
  AND NOT EXISTS (
    SELECT 1 FROM public.prompt_versions v
    WHERE v.template_id = t.id AND v.version = t.version
  );



--
--


-- 12.4 user_roles
-- Hinweis: Diese user_id-Werte stammen aus auth.users des Quellprojekts.
-- Im neuen Projekt existieren sie erst, wenn die Nutzer dort erneut angelegt wurden.
-- Alternativ diesen Block weglassen: Der erste registrierte Nutzer wird per
-- Trigger automatisch Admin.

INSERT INTO public.user_roles VALUES ('7488ec9e-3178-4e34-af46-2866a66029b3', 'ffa437a1-a834-4236-a389-78e1a3fde288', 'admin', '2026-09-03 09:59:51.32598+00') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles VALUES ('85787ef0-4ba8-4db0-921a-40feeafaf37d', '09b06d48-eb45-4ca7-b29a-848423868738', 'admin', '2026-09-08 16:14:00.502846+00') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles VALUES ('b4b359b4-da0a-4037-9f74-e0ab2022f887', '91eee470-6431-4e15-b7be-cc9fb5f80cb3', 'admin', '2026-09-10 05:46:02.523898+00') ON CONFLICT DO NOTHING;


--
--


-- ============================================================
-- 13. OPTIONAL: gelernte Daten
-- Standardmaessig auskommentiert. Zum Mitnehmen einfach die Kommentar-
-- Zeichen am Zeilenanfang entfernen (in deinem Editor: Block auswaehlen).
-- ============================================================

-- 13.1 market_paths (gelerntes Pfadverzeichnis je Markt)

-- INSERT INTO public.market_paths VALUES ('d9dd61f3-55e8-4453-a44f-61586e4f149c', '50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'magazin', 'magazine', 'manual', NULL, NULL, NULL, '2026-09-11 07:12:15.022541+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('bd02c401-ca92-4c79-9896-41b12c8e524f', '50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'terra', 'terra', 'manual', NULL, NULL, NULL, '2026-09-11 07:12:15.022541+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('c5ce6bd0-f2c7-487d-b376-a6f661932b51', '50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'weitere', 'autres', 'manual', NULL, NULL, NULL, '2026-09-11 07:12:15.022541+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('b92e82f5-4159-4359-9e77-b626ca92142f', '50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'hund', 'chien', 'manual', NULL, NULL, NULL, '2026-09-11 07:12:15.022541+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('06fd31ab-8267-4cae-a68a-0ddc1ba057d4', '50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'katze', 'chat', 'manual', NULL, NULL, NULL, '2026-09-11 07:12:15.022541+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('91112e11-e211-4da2-bfed-35a887011a47', '50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'rassen', 'races', 'manual', NULL, NULL, NULL, '2026-09-11 07:12:15.022541+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('3f6e87ca-9daa-4bef-9c73-bbdefb9cc846', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'garten-teich', 'ogrod-i-staw', 'hreflang', NULL, '2026-09-17 08:51:10.375+00', NULL, '2026-09-17 08:51:10.375+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('23ffc185-8d4a-4675-be51-49b8a8a2b182', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'wildtiere', 'dzikie-zwierzeta', 'hreflang', NULL, '2026-09-17 08:51:10.375+00', NULL, '2026-09-17 08:51:10.375+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('b14bdacd-0fee-4a85-b30e-980edf502271', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'magazin', 'magazyn', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('41b172dd-9c68-4472-ac97-1eaa89d76018', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'hund', 'pies', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('c13288c8-1ca4-4da6-a3c5-30f153e0a196', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'rassen', 'rasy', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('32871112-205c-45b5-b176-0d4a26257daf', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'erziehung', 'zachowanie', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('4660c742-50c1-4fd7-8ce6-d5d1181456eb', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'sport-spiel', 'trening-zabawa', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('4f57aa38-447c-4476-b803-e4016521b009', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'pflege-hygiene', 'pielegnacja-higiena', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('a8678a14-2158-46e9-87a2-c7f7d83a575e', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'c', 'c', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('6659547b-3929-4b73-92c7-a166a7f44b57', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'hundefutter', 'karma-dla-psow', 'hreflang', NULL, '2026-09-17 09:16:06.674+00', NULL, '2026-09-17 09:16:06.674+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('69342b75-c59a-4016-b312-3a50eb057537', 'a1755b70-f2da-4e41-9897-5c2a66235fbf', 'c', 'c', 'hreflang', NULL, '2026-09-17 09:28:40.956+00', NULL, '2026-09-17 09:28:40.956+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('14ff8588-25dc-4b96-8d11-04413a058311', 'a1755b70-f2da-4e41-9897-5c2a66235fbf', 'terra', 'reptile', 'hreflang', NULL, '2026-09-17 09:28:40.956+00', NULL, '2026-09-17 09:28:40.956+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('080ff7b3-79c2-4936-8383-608cc7a8e812', 'a1755b70-f2da-4e41-9897-5c2a66235fbf', 'terrarien-technik', 'terrariums-technology', 'hreflang', NULL, '2026-09-17 09:28:40.956+00', NULL, '2026-09-17 09:28:40.956+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.market_paths VALUES ('01ee3078-2ff2-4cc0-85d8-c3ec6fd8777c', 'a1755b70-f2da-4e41-9897-5c2a66235fbf', 'einrichtung-pflege', 'set-up-care', 'hreflang', NULL, '2026-09-17 09:28:40.956+00', NULL, '2026-09-17 09:28:40.956+00') ON CONFLICT DO NOTHING;
--
--
-- --
-- --
--


-- 13.2 style_profiles (abgeleitete Stilprofile)

-- INSERT INTO public.style_profiles VALUES ('5a7ee601-10f1-4595-a682-4d03a98a492f', '9f2fffaf-2358-471e-aa59-36fe2701be7a', 'magazine', '{"tone_notes": ["Empathisch, wohlwollend und tierlieb", "Informativ-beratend mit praktischen Alltagstipps", "Bildhafte Formulierungen und Metaphern (z. B. ''wulkan energii'', ''łagodne giganty'')", "Strukturierte Argumentation nach Rassekriterien (Haltung, Erziehung, Wesen)", "Leichte Inkonsistenz in der Distanz (überwiegend Duz-Form, vereinzelt Höflichkeitsform)"], "address_form": "gemischt", "heading_style": "Aussage", "sentence_length": "mittel", "address_examples": ["pasował do Ciebie i twojego stylu życia", "towarzyszyć Ci w codziennym życiu", "Przygotowaliśmy dla Państwa portrety"], "recurring_phrases": ["czworonożni przyjaciele", "Dowiedz się więcej", "styl życia", "wierny czworonożny przyjaciel"]}', '2026-09-03 12:06:20.407509+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.style_profiles VALUES ('1c6d7ac9-c1e4-481e-ad9a-cc21f6c55243', 'a1755b70-f2da-4e41-9897-5c2a66235fbf', 'magazine', '{"tone_notes": ["Empathisch und beruhigend gegenüber besorgten Haltern", "Fachlich fundiert, aber leicht verständlich aufbereitet", "Handlungsorientiert mit klaren Handlungsanweisungen für den Notfall", "Pragmatische Abwägung zwischen Hausmitteln und zwingendem Tierarztbesuch", "Dezente Verknüpfung von Fachwissen mit Shop- und Ratgeber-Angeboten"], "address_form": "informell", "heading_style": "gemischt", "sentence_length": "mittel", "address_examples": ["Du kennst deinen Vierbeiner am besten", "How you can tell whether your dog is sick", "Be sure to measure your dog’s temperature", "You should avoid known triggers such as pollen or grass"], "recurring_phrases": ["seek out a vet immediately", "first signs of an illness", "visit to the vet is strongly recommended", "depending on the severity"]}', '2026-09-04 06:42:21.639396+00') ON CONFLICT DO NOTHING;
-- INSERT INTO public.style_profiles VALUES ('08723d4f-0fe1-465b-b95b-8874f8c59514', '50eb1143-c8bb-4f5e-94c3-bfadf5db2950', 'magazine', '{"tone_notes": ["Sachlich, beratend und leicht verständlich formuliert", "Faszination für die Tierwelt spürbar (''pure fascination'', ''animaux fascinants'')", "Praxisnah mit konkreten Empfehlungen zu Haltung und Fütterung", "Regelmäßige Hinweise zu Tierschutz und gesetzlichen Vorgaben", "Dezente Eigenwerbung für Marktangebote und Zubehör"], "address_form": "formell", "heading_style": "gemischt", "sentence_length": "mittel", "address_examples": ["Vous trouverez dans votre magasin Fressnapf une alimentation spéciale...", "Vous vous amuserez beaucoup avec votre Gecko si vous pouvez lui rendre la vie plus confortable.", "Veuillez vous renseigner si des dispositions légales particulières doivent être respectées avant d’acheter un animal."], "recurring_phrases": ["Vous trouverez dans votre magasin Fressnapf", "Indications sur la protection des espèces", "D’autres articles susceptibles de vous intéresser", "Veuillez vous renseigner si des dispositions légales particulières doivent être respectées avant d’acheter un animal.", "convient aux débutants"]}', '2026-09-11 07:33:03.154347+00') ON CONFLICT DO NOTHING;
--
--
-- --
-- --
--


-- 13.3 link_pool, verified_links, jobs, job_steps
-- Diese Daten sind zu umfangreich fuer diese Datei (zusammen ueber 20 MB)
-- und liegen als separate Dateien daneben:
--   db-export/optional/link_pool.sql.gz (vorher entpacken: gunzip -k)
--   db-export/optional/verified_links.sql.gz (vorher entpacken: gunzip -k)
--   db-export/optional/jobs.sql.gz (vorher entpacken: gunzip -k)
--   db-export/optional/job_steps.sql.gz (vorher entpacken: gunzip -k)
-- Reihenfolge beim Import: markets -> jobs -> job_steps -> verified_links,
-- link_pool kann jederzeit nach markets importiert werden.
-- Nur einspielen, wenn Historie bzw. gelernte Links uebernommen werden sollen.
