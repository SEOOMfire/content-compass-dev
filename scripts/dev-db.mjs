#!/usr/bin/env node
/**
 * Dev-Datenbank (eigenes Supabase-Projekt) einrichten – ohne die Prod-DB anzufassen.
 *
 *   node scripts/dev-db.mjs build            → schreibt db-export/dev-setup.sql (für den SQL-Editor)
 *   node scripts/dev-db.mjs status           → zeigt, ob die Dev-DB eingerichtet ist
 *   node scripts/dev-db.mjs setup            → richtet die leere Dev-DB ein (Schema, Stammdaten, Prompts)
 *   node scripts/dev-db.mjs admin <e-mail>   → macht einen bereits angemeldeten Nutzer zum Admin
 *
 * Verbindung: SUPABASE_DB_URL_dev (Connection String der Dev-DB, nur in .env.local).
 * Schutz: Das Skript bricht ab, wenn die URL nicht die Dev-Projekt-ID enthält
 * oder die Prod-Projekt-ID (SUPABASE_PROJECT_ID aus .env) enthält.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const envFile = readEnvFile(".env");
const envLocal = readEnvFile(".env.local");
const env = { ...envFile, ...envLocal, ...process.env };

/** Prod = das Lovable-Projekt aus der eingecheckten .env. */
const PROD_ID = envFile.SUPABASE_PROJECT_ID ?? "";
const DEV_ID = env.SUPABASE_PROJECT_ID_dev ?? "";

/** Schema + Stammdaten + Workspaces (0009) + vereinfachte Pipeline (0010) als ein Skript. */
function buildSetupSql() {
  let setup = readFileSync(join(ROOT, "db-export/setup.sql"), "utf8");
  // Rollen-Seeds des Quellprojekts verweisen auf fremde auth.users → in Dev weglassen.
  setup = setup.replace(/^INSERT INTO public\.user_roles VALUES .*$/gm, "-- (user_roles-Seed in Dev ausgelassen)");
  const m0009 = readFileSync(join(ROOT, "drizzle/migrations/0009_workspaces.sql"), "utf8");
  const m0010 = readFileSync(join(ROOT, "drizzle/migrations/0010_simplified_pipeline.sql"), "utf8");
  const m0011 = readFileSync(join(ROOT, "drizzle/migrations/0011_prompt_quality_v2.sql"), "utf8");
  return [
    "-- ============================================================",
    "-- dev-setup.sql – erzeugt mit `node scripts/dev-db.mjs build`",
    "-- NUR für die LEERE Dev-Datenbank. Nicht auf Prod ausführen.",
    "-- Inhalt: db-export/setup.sql (ohne user_roles-Seed)",
    "--         + drizzle/migrations/0009_workspaces.sql",
    "--         + drizzle/migrations/0010_simplified_pipeline.sql",
    "--         + drizzle/migrations/0011_prompt_quality_v2.sql",
    "-- ============================================================",
    "",
    setup,
    "",
    "-- ===================== 0009_workspaces =====================",
    m0009,
    "",
    "-- ================= 0010_simplified_pipeline ================",
    m0010,
    "",
    "-- ================= 0011_prompt_quality_v2 =================",
    m0011,
    "",
  ].join("\n");
}

function guardedUrl() {
  const url = env.SUPABASE_DB_URL_dev ?? "";
  if (!url) {
    fail(
      "SUPABASE_DB_URL_dev fehlt in .env.local.\n" +
        "Supabase-Dashboard (Dev-Projekt) > Connect > Connection string (URI, Session pooler) eintragen.",
    );
  }
  if (!DEV_ID) fail("SUPABASE_PROJECT_ID_dev fehlt (.env).");
  if (!url.includes(DEV_ID)) fail("Abbruch: SUPABASE_DB_URL_dev gehört nicht zum Dev-Projekt (Projekt-ID fehlt in der URL).");
  if (PROD_ID && url.includes(PROD_ID)) fail("Abbruch: SUPABASE_DB_URL_dev zeigt auf das PROD-Projekt.");
  if (PROD_ID && PROD_ID === DEV_ID) fail("Abbruch: Dev- und Prod-Projekt-ID sind identisch.");
  return url;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function connect() {
  const { default: postgres } = await import("postgres");
  return postgres(guardedUrl(), { max: 1, onnotice: () => {}, prepare: false });
}

async function isInitialized(sql) {
  const [row] = await sql`select to_regclass('public.markets') is not null as ok`;
  return row.ok;
}

const [cmd, arg] = process.argv.slice(2);

if (cmd === "build") {
  const out = join(ROOT, "db-export/dev-setup.sql");
  writeFileSync(out, buildSetupSql(), "utf8");
  console.log(`geschrieben: ${out}`);
} else if (cmd === "status") {
  const sql = await connect();
  try {
    if (!(await isInitialized(sql))) {
      console.log("Dev-DB ist leer (keine Tabelle public.markets).");
    } else {
      const [m] = await sql`select count(*)::int as n from public.markets`;
      const prompts = await sql`
        select step_key, version from public.prompt_templates
        where step_key in ('localization_scan','localize_document','localization_review') order by sort_order`;
      const [col] = await sql`
        select count(*)::int as n from information_schema.columns
        where table_schema='public' and table_name='markets' and column_name='localization_notes'`;
      const [ws] = await sql`select count(*)::int as n from public.workspaces`;
      const admins = await sql`
        select p.email from public.workspace_members wm
        join public.profiles p on p.id = wm.user_id where wm.role = 'admin'`;
      console.log(`Märkte: ${m.n} · Arbeitsbereiche: ${ws.n} · localization_notes: ${col.n ? "ja" : "nein"}`);
      console.log(`Pipeline-Prompts: ${prompts.map((p) => `${p.step_key} v${p.version}`).join(", ") || "keine"}`);
      console.log(`Admins: ${admins.map((a) => a.email).join(", ") || "keine – `node scripts/dev-db.mjs admin <e-mail>`"}`);
    }
  } finally {
    await sql.end();
  }
} else if (cmd === "setup") {
  const sql = await connect();
  try {
    if (await isInitialized(sql)) {
      fail("Dev-DB ist bereits eingerichtet (public.markets existiert). Abbruch, um nichts doppelt anzulegen.");
    }
    await sql.begin((tx) => tx.unsafe(buildSetupSql()));
    console.log("Dev-DB eingerichtet (Schema, Märkte, Prompts, Workspaces, Migration 0010).");
    console.log("Nächster Schritt: eigenen Nutzer in Supabase Auth (Dev) anlegen, dann");
    console.log("  node scripts/dev-db.mjs admin <deine-e-mail>");
  } finally {
    await sql.end();
  }
} else if (cmd === "admin") {
  if (!arg) fail("E-Mail fehlt: node scripts/dev-db.mjs admin <e-mail>");
  const sql = await connect();
  try {
    const [user] = await sql`select id from auth.users where lower(email) = lower(${arg})`;
    if (!user) fail(`Kein Nutzer mit ${arg} in auth.users der Dev-DB. Zuerst in Supabase Auth anlegen.`);
    await sql`insert into public.profiles (id, email) values (${user.id}, ${arg}) on conflict (id) do nothing`;
    let [ws] = await sql`select id from public.workspaces order by created_at asc limit 1`;
    if (!ws) [ws] = await sql`insert into public.workspaces (name, created_by) values ('Standard', ${user.id}) returning id`;
    await sql`
      insert into public.workspace_members (workspace_id, user_id, role)
      values (${ws.id}, ${user.id}, 'admin')
      on conflict (workspace_id, user_id) do update set role = 'admin'`;
    console.log(`${arg} ist jetzt Admin im Arbeitsbereich ${ws.id}.`);
  } finally {
    await sql.end();
  }
} else {
  console.log("Befehle: build | status | setup | admin <e-mail>");
}
