# Umbau: Mehrere Arbeitsbereiche (Kunden), 3 Rollen, Team-Tab, Content-Vorschau, Login ohne Selbstanmeldung

## 1. Ausgangslage (Analyse)

**Stack:** TanStack Start (React 19) + Vite, TanStack Router (file-based), React Query, Tailwind v4 / shadcn, Supabase (Postgres + Auth + RLS), gehostet über Lovable. Drizzle ist konfiguriert (`drizzle.config.ts`), aber `drizzle/schema.ts` ist leer; das Schema liegt als handgeschriebene SQL-Migrationen unter `drizzle/migrations/` und als Voll-Dump unter `db-export/setup.sql`.

**Datenbank (public):** `markets`, `jobs`, `job_steps`, `link_pool`, `market_paths`, `url_index`, `style_profiles`, `verified_links`, `prompt_templates`, `prompt_versions`, `profiles`, `user_roles` (Enum `app_role`: admin/editor/viewer). Auth: Supabase; Trigger `grant_first_user_admin` macht den **ersten** registrierten Nutzer zum Admin; `handle_new_user` legt `profiles` an. RPC `has_role`.

**Rollen heute (global):** `admin`/`editor`/`viewer` in `user_roles`. `roles.ts` lädt `isAdmin`/`isEditor`. Jobs-Anlage hat aktuell **keine** Server-Rollenprüfung (`createJob` ohne `assertRole`); `runStepFn`/`runFromStepFn`/Exporte ebenfalls ohne Rollencheck. `deleteJob` verlangt admin.

**Auth heute:** `src/routes/auth.tsx` erlaubt Login **und** Selbstregistrierung (`signUp`).

**Seiten:** `/`→`/jobs`, `/auth`, `/reset-password`, `/_authenticated` (Layout + `AppHeader`), `/_authenticated/jobs` (Liste + „Neuer Job“-Formular), `/jobs/$jobId` (Detail: Schritte ausführen, Exporte, expandierbarer Content), `/_authenticated/admin/*` (Prompts, Märkte, Link-Pool, Nutzer; nur admin).

**„Content“ eines Jobs:** der lokalisierte Markdown-Endtext steht in `jobs.context.exportMarkdown` (gesetzt in Schritt `S13_export`, siehe `engine.server.ts`). Im Detail-Dialog wird er bereits angezeigt/kopiert; Download-Exporte (Prozess-Report, Platzhalter, Gesamtdoku) laufen über `pipeline.functions.ts`.

**Tests:** `tests/pipeline-regression.test.ts` testet nur reine Pipeline-Logik (kein DB/Rollen) – wird von diesem Umbau nicht berührt.

## 2. Entscheidungen (aus Rückfragen)

- **Admin-Bereich & Stammdaten bleiben global:** Märkte, Prompts, Link-Pool bleiben plattformweit. Arbeitsbereiche trennen nur Jobs, Team und Sichtbarkeit.
- **Admin legt Arbeitsbereiche an; Umschalter im Header:** Nutzer können mehreren Arbeitsbereichen angehören und oben wechseln.
- **3 Rollen pro Arbeitsbereich:** `viewer`, `manager`, `admin`. Eine `admin`-Mitgliedschaft wirkt plattformweit (Zugriff auf den globalen Admin-Bereich und alle Arbeitsbereiche). `editor` entfällt und wird zu `manager`.

## 3. Rollen- & Berechtigungsmodell

| Fähigkeit | Viewer | Manager | Admin |
|---|---|---|---|
| Jobs-Liste des Arbeitsbereichs sehen | ✅ | ✅ | ✅ (alle) |
| Job anlegen (Zielmarkt wählen) | ❌ | ✅ | ✅ |
| Job starten / Schritte ausführen | ❌ | ✅ | ✅ |
| Job löschen | ❌ | ✅ (eigener Bereich) | ✅ |
| Content herunterladen / ausklappen | ✅ | ✅ | ✅ |
| Team-Tab (Einladen als Viewer/Manager, Rollen ändern) | ❌ | ✅ (eigener Bereich) | ✅ |
| Admin-Bereich (Prompts/Märkte/Link-Pool) | ❌ | ❌ | ✅ |
| Arbeitsbereiche anlegen / verwalten | ❌ | ❌ | ✅ |

## 4. Datenmodell (neue Migration `drizzle/migrations/0009_workspaces.sql`)

Neue Objekte:

```sql
CREATE TYPE public.workspace_role AS ENUM ('viewer','manager','admin');

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,               -- Verweis auf profiles(id), nicht erzwungen
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,          -- Verweis auf auth.users/profiles(id)
  role public.workspace_role NOT NULL DEFAULT 'viewer',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON public.workspace_members (user_id);
```

Änderung an bestehenden Tabellen:

```sql
ALTER TABLE public.jobs ADD COLUMN workspace_id uuid;
-- Backfill: alle Bestandsjobs dem Standard-Arbeitsbereich zuordnen (siehe Seed unten)
ALTER TABLE public.jobs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;
CREATE INDEX jobs_workspace_idx ON public.jobs (workspace_id, created_at DESC);
```

**Migration bestehender Daten:**
1. Standard-Arbeitsbereich `workspaces` anlegen (`name = 'Standard'`), `created_by` = erster Admin.
2. `workspace_members` aus `user_roles` befüllen: `admin`→`admin`, `editor`→`manager`, `viewer`→`viewer`; `workspace_id` = Standard-Bereich.
3. `jobs.workspace_id` = Standard-Bereich setzen (danach `NOT NULL`).
4. `DROP TABLE public.user_roles;` und `DROP TYPE public.app_role;` (ersetzt durch `workspace_members`/`workspace_role`).

**RLS-Hilfsfunktionen** (ersetzen `has_role`):
```sql
CREATE OR REPLACE FUNCTION public.workspace_role_of(_user_id uuid, _workspace_id uuid)
RETURNS public.workspace_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT role FROM public.workspace_members
      WHERE user_id=_user_id AND workspace_id=_workspace_id $$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT EXISTS (SELECT 1 FROM public.workspace_members
      WHERE user_id=_user_id AND role='admin') $$;

CREATE OR REPLACE FUNCTION public.can_manage_workspace(_user_id uuid, _workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT public.is_workspace_admin(_user_id)
      OR (SELECT role FROM public.workspace_members
          WHERE user_id=_user_id AND workspace_id=_workspace_id) IN ('manager','admin') $$;
```

**Policies** (alle Tabellen behalten `ENABLE ROW LEVEL SECURITY`; globale Stammdaten `markets`/`prompt_templates`/`prompt_versions`/`link_pool`/`market_paths`/`url_index`/`style_profiles` behalten Lese-Zugriff für `authenticated`, Schreibzugriff nur admin):
- `workspaces`: SELECT für Mitglieder (`EXISTS workspace_members`) oder `is_workspace_admin(uid)`. INSERT/UPDATE/DELETE nur `is_workspace_admin`.
- `workspace_members`: SELECT wenn `is_workspace_admin(uid)` oder selbst Mitglied desselben Bereichs. INSERT/UPDATE/DELETE: `is_workspace_admin(uid)` oder `can_manage_workspace(uid, workspace_id)` (darf aber nur `viewer`/`manager` vergeben — Rollen-Eskalation im Server-Fn prüfen, nicht nur per RLS).
- `jobs`: SELECT wenn `is_workspace_admin(uid)` oder `workspace_role_of(uid, workspace_id) IS NOT NULL`. INSERT `WITH CHECK can_manage_workspace(uid, workspace_id)`. UPDATE `USING can_manage_workspace(uid, workspace_id)`. DELETE `USING can_manage_workspace(uid, workspace_id)`.
- `job_steps` / `verified_links`: SELECT wenn `is_workspace_admin(uid)` oder Mitglied des Bereichs des Elternjobs (Subquery auf `jobs.workspace_id`). Schreiben läuft ohnehin über Service-Role (`supabaseAdmin`).
- `profiles`: SELECT für `authenticated` (bleibt, für Team-Anzeige von E-Mail/Namen).

> Hinweis: Schreibzugriffe in den Server-Funktionen laufen über `supabaseAdmin` (Service-Role, umgeht RLS). RLS schützt hier primär die Client-Reads und verhindert direkte Manipulation.

## 5. Backend (Server-Funktionen & Rollen-Lib)

**`src/lib/roles.ts`** neu schreiben:
- `type WorkspaceRole = "viewer" | "manager" | "admin"`.
- `loadRoleFlags(userId)` → lädt aus `workspace_members`:
  - `memberships: { workspace_id, role }[]`
  - `isAdmin` (= irgendeine `admin`-Mitgliedschaft)
- `ROLE_LABELS` entsprechend.

**`src/lib/pipeline.functions.ts`:**
- `assertRole` ersetzen durch `assertWorkspaceRole(userId, workspaceId, required)` bzw. `assertAdmin(userId)` — Abfrage über `supabaseAdmin` auf `workspace_members` (nicht dem Client trauen).
- `createJob`: Eingabe um `workspace_id` erweitern; Rolle `manager`/`admin` im Bereich prüfen; `workspace_id` beim Insert setzen.
- `deleteJob`: statt globalem admin → `manager`/`admin` des Job-Bereichs (Bereich aus dem Job laden).
- `runStepFn` / `runFromStepFn`: `viewer` ausschließen (Mitgliedschaft prüfen, Rolle != `viewer`); `runFromStepFn` ruft `executeStep` intern auf und braucht dieselbe Prüfung.
- Export-Funktionen (`exportJobReport`, `exportPromptVars`, `exportFullJobDocs`): Lesezugriff (Mitglied) genügt — Viewer darf exportieren.
- Neu `getJobContent({ jobId })` → liest `jobs.context->>'exportMarkdown'` und gibt `{ markdown }` zurück (Mitgliedschaft prüfen). Basis für Vorschau + Download in der Liste.
- Neu `listWorkspaces` → Bereiche des Nutzers (oder alle, wenn admin).
- Neu `createWorkspace({ name })` → nur `isAdmin`.
- Neu `updateWorkspace` / `removeWorkspaceMember` (admin bzw. manager im Bereich).
- `inviteUser` umbauen: Eingabe `{ email, workspace_id, role }` mit `role ∈ {viewer, manager}` (Team-Tab) bzw. `admin` nur durch Admin; vorher `can_manage_workspace` prüfen. Bestehenden `inviteUserByEmail`/`generateLink`-Fluss beibehalten, danach `workspace_members` statt `user_roles` beschreiben.
- `assignRole` umbauen auf `workspace_members` (`upsert`/`delete` je `workspace_id,user_id`), mit Eskalationsschutz (Manager darf niemanden zu `admin` machen).

**Aktive Arbeitsbereich-Auswahl:** clientseitig in `localStorage` (z. B. `active_workspace_id`); Server-Funktionen erhalten `workspace_id` immer explizit als Parameter und validieren serverseitig.

## 6. Frontend

**`src/routes/_authenticated/route.tsx`** (`beforeLoad`):
- `getUser`, dann `loadRoleFlags` (Mitgliedschaften + `isAdmin`).
- Ermittle aktiven Bereich (aus `localStorage`, Fallback: erster Bereich; ohne Bereich → leerer Zustand/Hinweis).
- Liefere `{ user, isAdmin, role, workspaceId, workspaces }` an Kontext.

**`src/components/app-header.tsx`:**
- Tabs: `Jobs`, `Team` (sichtbar für `manager`/`admin`), `Admin` (nur `isAdmin`).
- Arbeitsbereich-Umschalter (Dropdown) wenn mehrere Bereiche; Auswahl in `localStorage` + `queryClient.invalidateQueries`.
- „Team“ verlinkt auf `/team`.

**Neue Route `src/routes/_authenticated/team.tsx`** (Team-Tab):
- Liste der Mitglieder des aktiven Bereichs (`workspace_members` + `profiles`).
- Einladen per E-Mail als `viewer` oder `manager` (Select).
- Rolle ändern / Mitglied entfernen (nur `manager`/`admin`; keine `admin`-Vergabe durch Manager).
- Für `viewer` ausgeblendet (bereits über Header + `beforeLoad` geschützt).

**`src/routes/_authenticated/jobs/index.tsx` (Umbau):**
- „Neuer Job“-Formular nur für `manager`/`admin`.
- Löschen nur für `manager`/`admin`.
- Pro Job-Zeile neue Aktionen:
  - **„Content anzeigen“** (Chevron/Ausklappen): ruft `getJobContent` und rendert `exportMarkdown` als Vorschau (nur wenn vorhanden; sonst „Noch kein Content“).
  - **„Herunterladen (.md)“**: lädt `exportMarkdown` und stößt Download als `job-<id>.md` an (Blob, wie im Detail-Dialog).
- Viewer sieht nur die Liste + diese beiden Aktionen, keine Start-/Lösch-Buttons.

**`src/routes/_authenticated/jobs/$jobId.tsx`:**
- „Komplett ausführen“ / „Ausführen“ / „ab hier“ nur für `manager`/`admin` (Kontext `role`).

**`src/routes/_authenticated/admin/*`:**
- `route.tsx`: Guard bleibt `isAdmin` (jetzt aus `workspace_members`).
- `users.tsx` **ersetzen** durch Verwaltung auf Bereichsebene: neues Tab „Arbeitsbereiche“ (`/admin/workspaces`) mit Anlegen/Benennen; Mitgliederzuordnung (E-Mail + Rolle inkl. `admin`) kann hier oder im Team-Tab erfolgen. Bestehendes „Admin einladen“ auf Bereichsmodell umstellen.
- Neue Route `src/routes/_authenticated/admin/workspaces.tsx` (Arbeitsbereiche anlegen/umbenennen).

**`src/routes/auth.tsx` (Login-Umbau):**
- `signup`-Modus und „Neues internes Konto anlegen“ entfernen; nur noch Login + „Passwort vergessen“.

**`src/integrations/supabase/types.ts`:**
- Manuell erweitern: Enum `workspace_role`, Tabellen `workspaces`, `workspace_members`, `jobs.workspace_id`, neue Functions (`workspace_role_of`, `is_workspace_admin`, `can_manage_workspace`). (Bis eine echte Typgenerierung läuft, händisch konsistent zu `0009` halten.)

## 7. Supabase-Konfiguration (manuell, einmalig)

- In Supabase-Dashboard **Authentication → Providers → Email**: „Allow new users to sign up“ deaktivieren (verhindert Selbstregistrierung auch serverseitig).
- Trigger `grant_first_user_admin` **entfernen** (gehört in Migration; Selbstanmeldung entfällt). Erster Admin wird über Migration gesetzt (bestehender Admin) bzw. per `inviteUser` durch einen Admin eingeladen.
- Migration `0009` im SQL-Editor / per Migrationswerkzeug auf das Lovable-Supabase-Projekt anwenden (Projekt-ID `vjajpeuxefjxxmluffbe`). Da `drizzle/schema.ts` leer ist und Drizzle-Kit nicht als primärer Migrationsweg dient, Migration als SQL direkt ausführen.

## 8. Rollout / Migrationspfad

1. SQL-Migration `0009` anwenden (Tabellen + Backfill + Policies + RPC + Trigger entfernen + Enum ersetzen).
2. Supabase „sign ups“ deaktivieren.
3. `types.ts`, `roles.ts`, Server-Funktionen, dann Routen/UI anpassen.
4. `npm run lint` und `bun test` (Pipeline-Regression unverändert) ausführen.

## 9. Validierungsplan

- **Rollenzugriff:** Als Viewer nur Liste sehen, kein „Neuer Job“, keine Start-/Löschbuttons, kein Team-/Admin-Tab. Als Manager Job anlegen (Zielmarkt wählbar), Team-Tab, kein Admin-Tab. Als Admin alles + Admin-Tab.
- **Bereichs-Isolation:** Nutzer A (Bereich X) sieht keine Jobs von Bereich Y; RLS `jobs` liefert nur den eigenen Bereich (manueller Check über zwei Testnutzer).
- **Team:** Manager lädt E-Mail als Viewer/Manager ein → Mitglied erscheint; Rolle ändern/entfernen funktioniert; Manager kann niemanden zu `admin` machen.
- **Arbeitsbereich-Umschalter:** Nutzer mit mehreren Bereichen wechselt und die Jobs-Liste aktualisiert sich.
- **Content:** Job mit abgeschlossenem `S13` zeigt im `/jobs` ausklappbare Vorschau und lädt `.md` herunter; Job ohne Content zeigt Hinweis.
- **Login:** `/auth` hat keine Registrierung; direkter `signUp`-Aufruf schlägt fehl (Supabase-Einstellung).

## 10. Offene Punkte / Annahmen (explizit)

- „Admin“ ist eine **Arbeitsbereich-Rolle**, die plattformweit wirkt (Zugriff auf den globalen Admin-Bereich und alle Bereiche). Kein separates „Super-Admin“-Flag zusätzlich.
- „Content“ = lokalisierter Endtext `jobs.context.exportMarkdown` (S13). Prozess-Report/Platzhalter/Gesamtdoku bleiben vorerst im Job-Detail.
- Löschen ist neu auch Managern (eigener Bereich) erlaubt; falls gewünscht, wieder auf „nur Admin“ einschränken.
- Bestehende `editor`-Rollen werden automatisch zu `manager` migriert.
