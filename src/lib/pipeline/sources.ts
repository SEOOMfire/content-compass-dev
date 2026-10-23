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
    if (eeat.length === 0) notes.push("Keine E-E-A-T-Quellen gefunden.");
  } catch (err) {
    warnings.push(
      `E-E-A-T-Suche: ${err instanceof Error ? err.message : "Websuche fehlgeschlagen"}`,
    );
  }

  return { sources: { eeat, selected: [], notes, warnings }, stats };
}
