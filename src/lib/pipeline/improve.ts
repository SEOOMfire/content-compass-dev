import { addStats, blocksForPrompt, emptyStats, type CallStats, type PromptCall } from "./localize";
import type { MarketProfile } from "./market";
import { ImprovementOutputSchema, validateStepData } from "./schemas";
import { validateBlockPatch, type BlockContent } from "./validate";
import type {
  Block,
  ImprovementProposal,
  ImprovementResult,
  JobContext,
  LocalizedBlock,
  LocalizedDoc,
} from "./types";

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
    improve: { proposals, applied: [], overrides: {}, notes: [], warnings: [] },
    stats,
  };
}

/**
 * Wendet die bestätigten Verbesserungen als Overlay auf die Basis-Blöcke an,
 * ohne die Basis zu verändern (reversibel). "verbesserung" nutzt den Patch
 * (ggf. überschrieben durch `overrides`), "quelle" hängt die Nutzer-Quelle als
 * „Quelle: …“ an. Gibt Blöcke, geänderte Blockanzahl und Warnungen zurück.
 */
export function applyImprovements(
  localized: LocalizedDoc,
  sourceBlocks: Block[],
  improve: ImprovementResult,
  sameLanguage: boolean,
): { blocks: LocalizedBlock[]; patched: number; warnings: string[] } {
  const blocks = localized.blocks.map((b) => ({ ...b }));
  const sourceById = new Map(sourceBlocks.map((b) => [b.id, b]));
  const warnings: string[] = [];
  let patched = 0;

  for (const p of improve.proposals) {
    if (!improve.applied.includes(p.id)) continue;
    if (!p.block_id) continue;
    const idx = blocks.findIndex((b) => b.id === p.block_id);
    const src = sourceById.get(p.block_id);
    if (idx < 0 || !src) continue;
    const target = blocks[idx]!;
    if (target.removed) continue;

    const override = (improve.overrides[p.id] ?? "").trim();
    let patch: BlockContent | null = null;

    if (p.patch) {
      if (
        override &&
        (target.type === "paragraph" || target.type === "quote" || target.type === "heading")
      ) {
        patch = { text: override };
      } else {
        patch = p.patch as BlockContent;
      }
    } else if (override) {
      if (target.type === "paragraph" || target.type === "quote") {
        patch = { text: `${target.text} Quelle: ${override}` };
      } else {
        warnings.push(
          `${p.title}: Blocktyp „${target.type}“ unterstützt kein automatisches Anhängen einer Quelle.`,
        );
      }
    }

    if (!patch) continue;
    const v = validateBlockPatch(src, patch, { removable: false, sameLanguage });
    if (v.ok) {
      blocks[idx] = v.block;
      patched += 1;
    } else {
      warnings.push(`${p.title}: ${v.errors.join("; ")}`);
    }
  }

  return { blocks, patched, warnings };
}
