import { addStats, emptyStats, type CallStats } from "./localize";
import type { MarketProfile } from "./market";
import type { WebSearchResult } from "./ai.server";
import type { JobContext, SourceSuggestion, SourcesResult } from "./types";

/**
 * Schritt 8: EEAT-Quellen. Nutzt die integrierte OpenAI-Websuche, um für den
 * ganzen Artikel anerkannte E-E-A-T-Quellen im Zielmarkt zu finden (nur Anzeige).
 * Die Übernahme erfolgt über "Alle Änderungen übernehmen".
 */

export interface SourcesArgs {
  sourceUrl: string;
  market: MarketProfile;
  ctx: JobContext;
  webSearch: (system: string, user: string) => Promise<WebSearchResult>;
}

export interface SourcesOutcome {
  sources: SourcesResult;
  stats: CallStats;
}

const EEAT_SYSTEM =
  "Du suchst mit Web-Suche anerkannte, vertrauenswürdige Quellen für E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness). Antworte NUR als Liste, je Zeile im Format „Name der Quelle | URL | Grund (1 kurzer Satz, warum die Quelle geeignet ist)“. Ohne Treffer antworte „keine“.";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "gclsrc",
  "igshid",
]);

/** Entfernt UTM-/Tracking-Parameter und den Hash. Liefert null bei ungültiger URL. */
function sanitizeSourceUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.hash = "";
  return u.toString();
}

/** Startseiten (nur Host, kein Pfad) sind keine E-E-A-T-Quellen. */
function isHomepageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  return u.pathname === "" || u.pathname === "/";
}

/** HEAD-Status (mit GET-Fallback bei 405/501), null bei Netzwerkfehler. */
async function httpStatus(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const headers = { "user-agent": "Mozilla/5.0 (compatible; EEAT-Check/1.0)" };
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers,
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers,
      });
    }
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** UTM entfernen, Startseiten und 404/410 aussortieren. */
async function filterReachable(sources: SourceSuggestion[]): Promise<SourceSuggestion[]> {
  const checked = await Promise.all(
    sources.map(async (s) => {
      const url = sanitizeSourceUrl(s.url);
      if (!url || isHomepageUrl(url)) return null;
      const status = await httpStatus(url);
      if (status === 404 || status === 410) return null;
      return { ...s, url };
    }),
  );
  return checked.filter((s): s is SourceSuggestion => s !== null);
}

/** Extrahiert Begründungen aus dem Antworttext (je Zeile der letzte "|"-Teil). */
function extractReasons(text: string): string[] {
  const reasons: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(keine|none)$/i.test(line)) continue;
    const clean = line.replace(/^[-*••]\s*/, "").trim();
    const parts = clean.split(" | ");
    if (parts.length >= 3) reasons.push(parts.slice(2).join(" | ").trim());
  }
  return reasons;
}

function parseEeatSources(
  text: string,
  citations: { url: string; title: string | null }[],
): SourceSuggestion[] {
  // Zitationen liefern vollständige, klickbare URLs (Text-URLs sind oft mit "..." gekürzt).
  if (citations.length) {
    const reasons = extractReasons(text);
    return citations.map((c, i) => ({
      name: c.title ?? c.url,
      url: c.url,
      reason: reasons[i] ?? "",
    }));
  }
  // Fallback ohne Zitationen: Text parsen.
  const out: SourceSuggestion[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(keine|none)$/i.test(line)) continue;
    const clean = line.replace(/^[-*••]\s*/, "").trim();
    const parts = clean.split(" | ");
    if (parts.length >= 2) {
      const name = parts[0]!.trim();
      const url = parts[1]!.trim();
      const reason = parts.slice(2).join(" | ").trim();
      if (/^https?:\/\//i.test(url) && !url.includes("...")) out.push({ name, url, reason });
    }
  }
  return out;
}

export async function researchSources(args: SourcesArgs): Promise<SourcesOutcome> {
  const stats = emptyStats();
  const language = args.market.language_variant
    ? `${args.market.language} (${args.market.language_variant})`
    : args.market.language;
  const country = args.market.country;
  const warnings: string[] = [];
  const notes: string[] = [];

  const title = args.ctx.localized?.meta?.title ?? "";
  const eeatUser = `Finde seriöse, anerkannte Quellen aus ${country} (${language}) zum Artikel „${title}“ – Behörden, Fachverbände, wissenschaftliche Institutionen, renommierte Fachportale. Nenne je Quelle eine kurze Begründung, warum sie für E-E-A-T geeignet ist.`;
  let eeat: SourceSuggestion[] = [];
  try {
    const r = await args.webSearch(EEAT_SYSTEM, eeatUser);
    addStats(stats, {
      data: r.text,
      model: r.model,
      promptSnapshot: "",
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
    });
    eeat = parseEeatSources(r.text, r.citations);
    eeat = await filterReachable(eeat);
    if (eeat.length === 0) notes.push("Keine E-E-A-T-Quellen gefunden.");
  } catch (err) {
    warnings.push(
      `E-E-A-T-Suche: ${err instanceof Error ? err.message : "Websuche fehlgeschlagen"}`,
    );
  }

  return { sources: { eeat, selected: [], notes, warnings }, stats };
}
