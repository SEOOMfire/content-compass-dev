#!/usr/bin/env node
/**
 * Ziel-Index für Schritt 6 (semantische interne Verlinkung) aufbauen.
 *
 *   node scripts/content-index.mjs crawl [--market fr-CH] [--limit N] [--force]
 *   node scripts/content-index.mjs status
 *
 * Läuft lokal (Node), nicht unter dem Vercel-Zeitlimit. Verbindung NUR gegen die
 * Dev-DB (gleicher Guard wie scripts/dev-db.mjs). OPENAI_API_KEY aus .env.local.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import {
  buildPayload,
  classifyContentType,
  filterContentUrl,
  hashPayload,
  isContentSitemapUrl,
  robotsSitemapUrls,
  sitemapIndexEntriesFromXml,
  urlsetEntriesFromXml,
} from "./content-index-lib.mjs";

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

const PROD_ID = envFile.SUPABASE_PROJECT_ID ?? "";
const DEV_ID = env.SUPABASE_PROJECT_ID_dev ?? "";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function guardedUrl() {
  const url = env.SUPABASE_DB_URL_dev ?? "";
  if (!url) fail("SUPABASE_DB_URL_dev fehlt in .env.local.");
  if (!DEV_ID) fail("SUPABASE_PROJECT_ID_dev fehlt (.env).");
  if (!url.includes(DEV_ID)) fail("Abbruch: SUPABASE_DB_URL_dev gehört nicht zum Dev-Projekt.");
  if (PROD_ID && url.includes(PROD_ID))
    fail("Abbruch: SUPABASE_DB_URL_dev zeigt auf das PROD-Projekt.");
  if (PROD_ID && PROD_ID === DEV_ID) fail("Abbruch: Dev- und Prod-Projekt-ID sind identisch.");
  return url;
}

async function connect() {
  const { default: postgres } = await import("postgres");
  return postgres(guardedUrl(), { max: 10, onnotice: () => {}, prepare: false });
}

const USER_AGENT = "OMfireLocalizationBot/1.0";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBED_MAX_CHARS = 24_000; // ≈ 6k Tokens – sicher unter dem 8k-Limit je Input
const EMBED_BATCH_SIZE = 40; // 40 × ~6k Tokens ≈ 240k – unter dem 300k-Limit je Request
const SCRAPE_CONCURRENCY = 3; // max. 3 gleichzeitige Requests auf den Zielserver
const SCRAPE_DELAY_FALLBACK_MS = 500; // Pause je Request, wenn kein crawl_delay_ms hinterlegt
const OPENAI_BASE_URL = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

function apiKey() {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY fehlt in .env.local.");
  return key;
}

/** Ein Embedding-Batch. Fehler werfen – der Aufrufer zählt sie als Fehler. */
async function embed(texts) {
  const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Embedding-Fehler ${res.status}: ${body?.error?.message ?? res.statusText}`);
  }
  const json = await res.json();
  const data = json.data ?? [];
  return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding ?? []);
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xml,text/xml,text/plain,*/*",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const ct = res.headers.get("content-type") ?? "";
    const isTextual = !ct || /text\/|xml|html|json|plain/i.test(ct);
    const body = isTextual ? await res.text() : "";
    return { status: res.status, html: body };
  } catch {
    return { status: 0, html: "" };
  }
}

/** Schlanke node-html-parser-Extraktion (H1, Meta, Überschriften, Fließtext). */
function extractPage(html) {
  const root = parse(html, { comment: false });
  const title = root.querySelector("title")?.text.replace(/\s+/g, " ").trim() || null;
  const metaDescription =
    root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || null;
  for (const sel of [
    "script",
    "style",
    "noscript",
    "template",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "button",
    "img",
    "picture",
    "iframe",
    "svg",
    "video",
    "audio",
    ".breadcrumb",
    ".breadcrumbs",
    ".table-of-content",
    ".ai-metrics",
  ]) {
    for (const n of root.querySelectorAll(sel)) n.remove();
  }
  const content =
    root.querySelector("main") ??
    root.querySelector("article") ??
    root.querySelector("body") ??
    root;
  const blocks = [];
  let h1 = null;
  let wordCount = 0;
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  const walk = (el) => {
    for (const child of el.childNodes) {
      if (!child.rawTagName) continue;
      const tag = child.rawTagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = child.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const level = Number(tag[1]);
        if (level === 1 && !h1) h1 = text;
        blocks.push({ kind: "heading", level, text });
        wordCount += words(text);
      } else if (tag === "p" || tag === "li") {
        const text = child.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        blocks.push({ kind: "text", text });
        wordCount += words(text);
      } else {
        walk(child);
      }
    }
  };
  walk(content);
  return { title, h1, metaDescription, blocks, wordCount };
}

async function mapWithConcurrency(items, limit, fn) {
  const n = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

function localeParts(locale) {
  const m = /^\s*([a-zA-Z]{2,3})[-_]([a-zA-Z]{2})\s*$/.exec(String(locale || "").trim());
  return m ? { language: m[1].toLowerCase(), country: m[2].toLowerCase() } : null;
}

function pause(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Alle Sitemap-URLs eines Markts ermitteln (robots.txt → Index → Blätter). */
async function discoverSitemaps(domain) {
  const base = `https://${domain}`;
  const sitemapUrls = new Set();
  let robots = "";
  try {
    robots = (await fetchText(`${base}/robots.txt`)).html;
  } catch {
    robots = "";
  }
  const fromRobots = robotsSitemapUrls(robots);
  if (!fromRobots.length) fromRobots.push(`${base}/sitemap.xml`);
  const leaves = [];
  for (const url of fromRobots) {
    const { html } = await fetchText(url);
    if (!html) continue;
    if (/<sitemapindex/i.test(html)) {
      for (const child of sitemapIndexEntriesFromXml(html)) leaves.push(child);
    } else {
      leaves.push(url);
    }
  }
  return [...new Set(leaves)];
}

async function crawlMarket(sql, market, { limit, force }) {
  const report = {
    locale: market.locale,
    domain: market.domain,
    total: 0,
    crawled: 0,
    updated: 0,
    unchanged: 0,
    new: 0,
    errors: 0,
  };
  const lang = localeParts(market.locale)?.language ?? "";
  const sitemaps = await discoverSitemaps(market.domain);
  const content = sitemaps.filter((u) => isContentSitemapUrl(u, lang));
  const chosen = content.length ? content : sitemaps;
  if (!chosen.length) {
    console.log(`  ${market.locale}: keine Sitemaps gefunden.`);
    return report;
  }

  const seen = new Set();
  const entries = [];
  for (const sm of chosen) {
    const { html } = await fetchText(sm);
    if (!html) continue;
    for (const e of urlsetEntriesFromXml(html)) {
      if (seen.has(e.loc)) continue;
      if (!filterContentUrl(e.loc, market)) continue;
      seen.add(e.loc);
      entries.push(e);
      if (limit && entries.length >= limit) break;
    }
    if (limit && entries.length >= limit) break;
  }
  report.total = entries.length;

  const existingRows = await sql`
    select url, sitemap_lastmod::text as sitemap_lastmod, content_hash
    from public.content_pages where market_id = ${market.id}`;
  const existingByUrl = new Map(existingRows.map((r) => [r.url, r]));
  // lastmod normalisieren: DB liefert `date` als Date-Objekt, Sitemap als String/Timestamp.
  const lastmodKey = (v) => {
    if (!v) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };

  const toCrawl = [];
  for (const e of entries) {
    const existing = existingByUrl.get(e.loc);
    if (
      existing &&
      !force &&
      e.lastmod &&
      lastmodKey(existing.sitemap_lastmod) === lastmodKey(e.lastmod)
    ) {
      report.unchanged++;
      continue;
    }
    toCrawl.push(e);
  }

  const pages = [];
  const delayMs =
    Number(market.crawl_delay_ms) > 0 ? Number(market.crawl_delay_ms) : SCRAPE_DELAY_FALLBACK_MS;
  await mapWithConcurrency(toCrawl, SCRAPE_CONCURRENCY, async (e) => {
    await pause(delayMs);
    const { status, html } = await fetchText(e.loc);
    if (!html) {
      report.errors++;
      return;
    }
    const ex = extractPage(html);
    const payload = buildPayload(ex);
    if (!payload.trim()) {
      report.errors++;
      return;
    }
    const hash = hashPayload(payload);
    const parts = localeParts(market.locale);
    pages.push({
      url: e.loc,
      status,
      lastmod: e.lastmod,
      payload,
      hash,
      title: ex.title,
      h1: ex.h1,
      metaDescription: ex.metaDescription,
      contentType: classifyContentType(new URL(e.loc).pathname, market.magazine_root, ex.wordCount),
      country: parts.country,
      language: parts.language,
      existing: existingByUrl.get(e.loc),
    });
    report.crawled++;
  });

  const needEmbed = pages.filter((p) => !p.existing || p.existing.content_hash !== p.hash);
  for (let i = 0; i < needEmbed.length; i += EMBED_BATCH_SIZE) {
    const batch = needEmbed.slice(i, i + EMBED_BATCH_SIZE);
    let vecs = null;
    for (let attempt = 0; attempt < 3 && !vecs; attempt++) {
      try {
        const got = await embed(batch.map((p) => p.payload.slice(0, EMBED_MAX_CHARS)));
        if (!Array.isArray(got) || got.length !== batch.length) {
          throw new Error(`Embedding-Antwort unvollständig (${got?.length ?? 0}/${batch.length}).`);
        }
        vecs = got;
      } catch (err) {
        if (attempt === 2) {
          console.log(
            `  ${market.locale}: Embedding-Batch fehlgeschlagen (${i}–${i + batch.length - 1}): ${err instanceof Error ? err.message : err}`,
          );
        } else {
          await pause(600 * (attempt + 1));
        }
      }
    }
    if (vecs) batch.forEach((p, j) => (p.embedding = vecs[j] ?? []));
    else batch.forEach((p) => (p.embedding = null));
  }

  for (const p of pages) {
    const embeddingStr = p.embedding?.length ? `[${p.embedding.join(",")}]` : null;
    const common = {
      market_id: market.id,
      country: p.country,
      language: p.language,
      content_type: p.contentType,
      title: p.title,
      h1: p.h1,
      meta_description: p.metaDescription,
      content_payload: p.payload,
      content_hash: p.hash,
      sitemap_lastmod: p.lastmod,
      http_status: p.status,
      is_active: true,
      last_crawled_at: new Date().toISOString(),
    };
    if (embeddingStr) {
      await sql`
        insert into public.content_pages
          (url, market_id, country, language, content_type, title, h1, meta_description, content_payload, content_hash, embedding, embedding_model, sitemap_lastmod, http_status, is_active, last_crawled_at)
        values
          (${p.url}, ${common.market_id}, ${common.country}, ${common.language}, ${common.content_type}, ${common.title}, ${common.h1}, ${common.meta_description}, ${common.content_payload}, ${common.content_hash}, ${embeddingStr}::extensions.halfvec, ${EMBEDDING_MODEL}, ${common.sitemap_lastmod}, ${common.http_status}, true, ${common.last_crawled_at})
        on conflict (url) do update set
          market_id = excluded.market_id,
          country = excluded.country,
          language = excluded.language,
          content_type = excluded.content_type,
          title = excluded.title,
          h1 = excluded.h1,
          meta_description = excluded.meta_description,
          content_payload = excluded.content_payload,
          content_hash = excluded.content_hash,
          embedding = excluded.embedding,
          embedding_model = excluded.embedding_model,
          sitemap_lastmod = excluded.sitemap_lastmod,
          http_status = excluded.http_status,
          is_active = true,
          last_crawled_at = excluded.last_crawled_at`;
      if (!p.existing) report.new++;
      else report.updated++;
    } else if (p.existing) {
      // Hash unverändert → Embedding bleibt, nur Metadaten/Zeitstempel aktualisieren.
      await sql`
        update public.content_pages set
          title = ${common.title},
          h1 = ${common.h1},
          meta_description = ${common.meta_description},
          content_payload = ${common.content_payload},
          content_hash = ${common.content_hash},
          sitemap_lastmod = ${common.sitemap_lastmod},
          http_status = ${common.http_status},
          is_active = true,
          last_crawled_at = ${common.last_crawled_at}
        where url = ${p.url}`;
      report.updated++;
    } else {
      // Neue Seite ohne Embedding (Batch fehlgeschlagen) → überspringen, nächster Lauf holt sie nach.
      report.errors++;
    }
  }

  // URLs des Markts, die nicht (mehr) in der Sitemap stehen → is_active = false.
  const activeUrls = [...new Set(entries.map((e) => e.loc))];
  if (activeUrls.length) {
    await sql`
      update public.content_pages set is_active = false
      where market_id = ${market.id} and is_active = true and url <> all(${activeUrls})`;
  }

  return report;
}

async function runCrawl(args) {
  const sql = await connect();
  try {
    const marketFilter = args.market ?? null;
    const limit = args.limit ? Number(args.limit) : null;
    const force = Boolean(args.force);
    const markets = await sql`
      select id, locale, domain, path_prefix, magazine_root, country, language, crawl_delay_ms
      from public.markets where active order by locale`;
    const chosen = marketFilter
      ? markets.filter((m) => String(m.locale).toLowerCase() === String(marketFilter).toLowerCase())
      : markets;
    if (!chosen.length) fail(`Kein Markt mit Locale „${marketFilter}“ gefunden.`);

    console.log(
      `Content-Index: ${chosen.length} Markt/Märkte${marketFilter ? ` (${marketFilter})` : ""}${limit ? `, max. ${limit} URLs/Markt` : ""}${force ? ", --force" : ""}`,
    );
    let total = { total: 0, crawled: 0, new: 0, updated: 0, unchanged: 0, errors: 0 };
    for (const m of chosen) {
      console.log(`\n${m.locale} (${m.domain}) …`);
      const r = await crawlMarket(sql, m, { limit, force });
      total.total += r.total;
      total.crawled += r.crawled;
      total.new += r.new;
      total.updated += r.updated;
      total.unchanged += r.unchanged;
      total.errors += r.errors;
      console.log(
        `  ${r.total} URLs in Sitemap · ${r.crawled} gecrawlt · ${r.new} neu · ${r.updated} aktualisiert · ${r.unchanged} unverändert · ${r.errors} Fehler`,
      );
    }
    const [size] = await sql`select pg_total_relation_size('public.content_pages') as bytes`;
    console.log(
      `\nGesamt: ${total.new} neu, ${total.updated} aktualisiert, ${total.unchanged} unverändert, ${total.errors} Fehler.`,
    );
    console.log(
      `Tabellengröße content_pages: ${(Number(size?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`,
    );
  } finally {
    await sql.end();
  }
}

async function runStatus() {
  const sql = await connect();
  try {
    const [table] = await sql`select to_regclass('public.content_pages') is not null as ok`;
    if (!table.ok) {
      console.log(
        "content_pages fehlt – zuerst: node scripts/dev-db.mjs migrate 0013_content_pages.sql",
      );
      return;
    }
    const [size] = await sql`select pg_total_relation_size('public.content_pages') as bytes`;
    const rows = await sql`
      select country, language, content_type, count(*)::int as n, sum((is_active)::int)::int as active
      from public.content_pages group by country, language, content_type order by country, language, content_type`;
    console.log(`content_pages: ${(Number(size?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`);
    for (const r of rows)
      console.log(`  ${r.country}/${r.language} · ${r.content_type}: ${r.n} (aktiv ${r.active})`);
    const models = await sql`select distinct embedding_model from public.content_pages`;
    console.log(
      `Embedding-Modelle: ${(models ?? []).map((m) => m.embedding_model).join(", ") || "–"}`,
    );
  } finally {
    await sql.end();
  }
}

const args = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--market" || a === "--limit") {
    args[a.slice(2)] = process.argv[++i];
  } else if (a === "--force") {
    args.force = true;
  } else {
    positional.push(a);
  }
}
const [cmd] = positional;

if (cmd === "crawl") {
  await runCrawl(args);
} else if (cmd === "status") {
  await runStatus();
} else {
  console.log("Befehle: crawl [--market fr-CH] [--limit N] [--force] | status");
}
