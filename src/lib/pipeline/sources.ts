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
  "Du suchst mit Web-Suche anerkannte, vertrauenswürdige Quellen für E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness). Antworte NUR als Liste, je Zeile „Name der Quelle – URL“.";

function parseEeatSources(
  text: string,
  citations: { url: string; title: string | null }[],
): SourceSuggestion[] {
  if (citations.length) {
    return citations.map((c) => ({ name: c.title ?? c.url, url: c.url }));
  }
  const out: SourceSuggestion[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(keine|none)$/i.test(line)) continue;
    const sep = line.lastIndexOf(" – ");
    if (sep > 0) {
      const name = line.slice(0, sep).trim();
      const url = line.slice(sep + 3).trim();
      if (url) out.push({ name, url });
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
          model: "gpt-4o-mini",
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
  const eeatUser = `Finde seriöse, anerkannte Quellen aus ${country} (${language}) zum Artikel „${title}“ – Behörden, Fachverbände, wissenschaftliche Institutionen, renommierte Fachportale.`;
  let eeat: SourceSuggestion[] = [];
  try {
    const r = await args.webSearch(EEAT_SYSTEM, eeatUser);
    addStats(stats, {
      data: r.text,
      model: "gpt-4o-mini",
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

  return { sources: { eeat, notes, warnings }, overrides, stats };
}
