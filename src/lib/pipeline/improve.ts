import { addStats, blocksForPrompt, emptyStats, type CallStats, type PromptCall } from "./localize";
import type { MarketProfile } from "./market";
import { ImprovementOutputSchema, validateStepData } from "./schemas";
import type { ImprovementProposal, ImprovementResult, JobContext } from "./types";

/**
 * Schritt 8: Verbesserungen & Quellen. Die KI analysiert Original und Zieltext
 * und schlägt inhaltliche Verbesserungen sowie fehlende Zielmarkt-Quellen vor.
 * Keine Textänderung – die Vorschläge werden gespeichert und erst nach
 * Bestätigung im UI angewendet (applyImprovementsStep).
 */

export interface ImproveArgs {
  sourceUrl: string;
  market: MarketProfile;
  ctx: JobContext;
  call: PromptCall;
}

export interface ImproveOutcome {
  improve: ImprovementResult;
  stats: CallStats;
}

export async function proposeImprovements(args: ImproveArgs): Promise<ImproveOutcome> {
  const stats = emptyStats();
  const sourceBlocks = args.ctx.source?.blocks ?? [];
  const targetLanguage = args.market.language_variant
    ? `${args.market.language} (${args.market.language_variant})`
    : args.market.language;
  const removedIds = (args.ctx.localized?.blocks ?? [])
    .filter((b) => b.removed)
    .map((b) => b.id);
  const externalSources = args.ctx.source?.externalLinks ?? [];

  const res = await args.call({
    QUELL_URL: args.sourceUrl,
    ORIGINAL: sourceBlocks.length ? blocksForPrompt(sourceBlocks) : "Original nicht verfügbar.",
    EXPORT: args.ctx.exportMarkdown ?? "",
    ZIELSPRACHE: targetLanguage,
    ZIELMARKT: args.market.country,
    brand: args.market.brand,
    FINDINGS: JSON.stringify(args.ctx.findings ?? []),
    REMOVED_BLOCK_IDS: removedIds.length ? removedIds.join(", ") : "keine",
    CHECK_BRIEFING: args.ctx.check?.markdown ?? "",
    EXTERNAL_SOURCES: JSON.stringify(externalSources),
  });
  addStats(stats, res);

  const parsed = validateStepData("improve", ImprovementOutputSchema, res.data);
  const proposals: ImprovementProposal[] = parsed.proposals.map((p, i) => ({
    id: `p${i + 1}`,
    kind: p.kind,
    block_id: p.block_id ?? null,
    title: p.title,
    problem: p.problem,
    suggestion: p.suggestion ?? "",
    patch: p.patch ?? null,
    source: null,
  }));

  return {
    improve: { proposals, applied: [], notes: [], warnings: [] },
    stats,
  };
}
