import { addStats, emptyStats, type CallStats } from "./localize";
import type { MarketProfile } from "./market";
import type { WebSearchResult } from "./ai.server";
import type { ImprovementResult, JobContext, SourceSuggestion, SourcesResult } from "./types";

/**
 * Schritt 9: Quellenrecherche. Nutzt die integrierte OpenAI-Websuche, um je
 * "quelle"-Vorschlag automatisch eine Quelle zu finden und die Felder
 * vorzubefüllen. Zusätzlich wird eine dokumentweite E-E-A-T-Quellensuche
 * ausgeführt (nur Anzeige). Keine Textänderung – die Übernahme erfolgt weiterhin
 * über "Alle Änderungen übernehmen".
 */

export interface SourcesArgs {
  sourceUrl: string;
  market: MarketProfile;
  ctx: JobContext;
  webSearch: (system: string, user: string) => Promise<WebSearchResult>;
}

export interface SourcesOutcome {
  sources: SourcesResult;
  overrides: Record<string, string>;
  stats: CallStats;
}

const SOURCE_SYSTEM =
  "Du suchst mit Web-Suche eine konkrete, seriöse Quelle. Antworte NUR mit „Name der Quelle – URL“ (max. 1 Zeile). Ohne Treffer antworte „keine“.";

const EEAT_SYSTEM =
  "Du suchst mit Web-Suche anerkannte, vertrauenswürdige Quellen für E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness). Antworte NUR als Liste, je Zeile im Format „Name der Quelle | URL | Grund (1 kurzer Satz, warum die Quelle geeignet ist)“. Ohne Treffer antworte „keine“.";

function parseEeatSources(
  text: string,
  citations: { url: string; title: string | null }[],
): SourceSuggestion[] {
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
      if (/^https?:\/\//i.test(url)) out.push({ name, url, reason });
    }
  }
  if (out.length === 0 && citations.length) {
    for (const c of citations) {
      out.push({ name: c.title ?? c.url, url: c.url, reason: "" });
    }
  }
  return out;
}

export async function researchSources(args: SourcesArgs): Promise<SourcesOutcome> {
  const stats = emptyStats();
  const improve: ImprovementResult | undefined = args.ctx.improve;
  const language = args.market.language_variant
    ? `${args.market.language} (${args.market.language_variant})`
    : args.market.language;
  const country = args.market.country;
  const overrides: Record<string, string> = {};
  const warnings: string[] = [];
  const notes: string[] = [];

  if (improve) {
    for (const p of improve.proposals) {
      if (p.kind !== "quelle") continue;
      if ((improve.overrides[p.id] ?? "").trim()) continue; // bereits gefüllt
      const topic = [p.problem, p.suggestion].filter(Boolean).join(" ");
      const user = `Finde für den Zielmarkt ${country} (${language}) eine passende Quelle zu folgendem Thema: ${topic}`;
      try {
        const r = await args.webSearch(SOURCE_SYSTEM, user);
        addStats(stats, {
          data: r.text,
          model: r.model,
          promptSnapshot: "",
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
        });
        const value = r.text.trim();
        if (value && !/^(keine|none)$/i.test(value)) overrides[p.id] = value;
      } catch (err) {
        warnings.push(
          `${p.title}: ${err instanceof Error ? err.message : "Websuche fehlgeschlagen"}`,
        );
      }
    }
  }

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

  return { sources: { eeat, selected: [], notes, warnings }, overrides, stats };
}
