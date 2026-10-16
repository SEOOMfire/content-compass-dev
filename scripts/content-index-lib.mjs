/**
 * Reine, testbare Helfer für scripts/content-index.mjs.
 * Bewusst als eigenes ESM-Modul, damit bun-Tests (tests/content-index.test.ts)
 * dieselben Funktionen verwenden wie das Node-Skript.
 */
import { createHash } from "node:crypto";

/** Pfadsegmente, die nie redaktioneller Magazin-Content sind. */
export const EXCLUDED_PATH_SEGMENTS = new Set([
  "product",
  "products",
  "produkt",
  "produkte",
  "category",
  "categories",
  "kategorie",
  "kategorien",
  "cart",
  "checkout",
  "warenkorb",
  "kasse",
  "search",
  "suche",
  "promotion",
  "promotions",
  "aktion",
  "aktionen",
  "newsletter",
  "store",
  "shop",
]);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Präfix normalisieren: führender Slash, keine abschließenden Slash-Lücken. */
export function normalizePrefix(prefix) {
  let p = String(prefix || "").trim();
  if (!p || p === "/") return "";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+$/, "");
}

/** Pfadsegmente, die nach `magazineRoot` folgen (null, wenn URL nicht darunter liegt). */
export function contentPathSegments(path, magazineRoot) {
  let p = String(path || "");
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h >= 0) p = p.slice(0, h);
  if (!p.startsWith("/")) p = `/${p}`;
  const root = normalizePrefix(magazineRoot);
  if (root) {
    if (p !== root && !p.startsWith(`${root}/`)) return null;
  }
  const rest = root ? p.slice(root.length) : p;
  return rest.split("/").filter(Boolean);
}

/** Harte Filter: URL muss unter `magazine_root` liegen und darf keine Shop-/Kategorie-Pfade enthalten. */
export function filterContentUrl(url, market) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const segments = contentPathSegments(path, market?.magazine_root);
  if (segments === null) return false;
  for (const seg of segments) {
    if (EXCLUDED_PATH_SEGMENTS.has(seg.toLowerCase())) return false;
  }
  return true;
}

/**
 * `content_type`: `hub` bei Kategorie-Übersicht (Pfadtiefe ≤ magazine_root+1
 * oder < 250 Wörter), sonst `ratgeber`.
 */
export function classifyContentType(path, magazineRoot, wordCount) {
  const segments = contentPathSegments(path, magazineRoot);
  if (segments !== null && segments.length <= 1) return "hub";
  if (Number(wordCount) < 250) return "hub";
  return "ratgeber";
}

/** Sitemap-URL ist eine Content-Sitemap (`sitemap-content-{lang}.xml`). */
export function isContentSitemapUrl(url, language) {
  try {
    const base = new URL(url).pathname.split("/").pop() ?? "";
    if (language) {
      return new RegExp(`^sitemap-content-${escapeRegExp(language)}\\.xml$`, "i").test(base);
    }
    return /^sitemap-content-[a-z-]+\.xml$/i.test(base);
  } catch {
    return false;
  }
}

/** `<sitemapindex>` → Sitemap-URLs. */
export function sitemapIndexEntriesFromXml(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(m[1]);
    if (loc?.[1]) out.push(loc[1].trim());
  }
  return out;
}

/** `<urlset>` → `{ loc, lastmod }`-Einträge. */
export function urlsetEntriesFromXml(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(m[1]);
    if (!loc?.[1]) continue;
    const lastmod = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(m[1]);
    out.push({ loc: loc[1].trim(), lastmod: lastmod?.[1]?.trim() ?? null });
  }
  return out;
}

/** `robots.txt` → Sitemap-URLs (`Sitemap:`-Zeilen). */
export function robotsSitemapUrls(robotsText) {
  const out = [];
  for (const line of String(robotsText).split(/\r?\n/)) {
    const m = /^\s*Sitemap:\s*(\S+)\s*$/i.exec(line);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

/**
 * Payload = H1 + Meta-Description + Blöcke (Überschriften als `## …`, Fließtext).
 * Blöcke: `{ kind: "heading", level, text }` oder `{ kind: "text", text }`.
 */
export function buildPayload({ h1 = "", metaDescription = "", blocks = [] } = {}) {
  const lines = [];
  if (String(h1).trim()) lines.push(String(h1).trim());
  if (String(metaDescription).trim()) lines.push(String(metaDescription).trim());
  for (const b of blocks ?? []) {
    const text = String(b?.text ?? "").trim();
    if (!text) continue;
    if (b?.kind === "heading") {
      const level = Math.min(Math.max(Number(b.level) || 2, 1), 6);
      lines.push(`${"#".repeat(level)} ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join("\n\n");
}

/** sha256(payload) als Hex – Re-Embedding nur bei Änderung. */
export function hashPayload(payload) {
  return createHash("sha256").update(String(payload), "utf8").digest("hex");
}
