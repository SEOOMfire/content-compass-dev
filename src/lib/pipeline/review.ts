import { ReviewOutputSchema, validateStepData } from "./schemas";
import { forbidsEszett, isGermanTarget, marketPromptProfile, type MarketProfile } from "./market";
import { addStats, blocksForPrompt, emptyStats, type CallStats, type PromptCall } from "./localize";
import { renderMarkdown } from "./render";
import { deterministicChecks, replaceEszett, validateBlockPatch, type CheckHit } from "./validate";
import type {
  Block,
  Finding,
  LocalizedBlock,
  LocalizedDoc,
  ReviewIssue,
  ReviewResult,
} from "./types";

export interface ReviewArgs {
  source: Block[];
  localized: LocalizedDoc;
  findings: Finding[];
  market: MarketProfile;
  call: PromptCall;
}

export interface ReviewOutcome {
  localized: LocalizedDoc;
  review: ReviewResult;
  exportMarkdown: string;
  stats: CallStats;
}

function hitKey(h: CheckHit): string {
  return `${h.block_id ?? "-"}::${h.problem}`;
}

/**
 * Schritt 4: deterministische Prüfungen + KI-Review mit Korrekturen.
 * Korrekturen werden nur übernommen, wenn sie dieselbe Validierung wie in
 * Schritt 3 bestehen. Der Schritt blockiert nie; Offenes wird als Warnung geführt.
 */
export async function reviewDocument(args: ReviewArgs): Promise<ReviewOutcome> {
  const stats = emptyStats();
  const issues: ReviewIssue[] = [];
  const applied = new Set<string>();
  const sourceById = new Map(args.source.map((b) => [b.id, b]));
  const sameLanguage = isGermanTarget(args.market);
  let blocks: LocalizedBlock[] = args.localized.blocks.map((b) => ({ ...b }));

  // 1 · Deterministische Korrektur: Schweizer Hochdeutsch ohne „ß“.
  if (forbidsEszett(args.market)) {
    blocks = blocks.map((b) => {
      if (b.removed) return b;
      const fixed = replaceEszett(b);
      if (JSON.stringify(fixed) !== JSON.stringify(b)) {
        applied.add(b.id);
        issues.push({
          block_id: b.id,
          origin: "code",
          problem: "„ß“ durch „ss“ ersetzt",
          status: "applied",
        });
      }
      return fixed;
    });
  }

  // 2 · Deterministische Prüfungen vor dem KI-Review.
  const initialHits = deterministicChecks(args.source, blocks, args.findings, args.market);

  // 3 · KI-Review.
  let llmIssues: {
    block_id: string | null;
    problem: string;
    fix: Record<string, unknown> | null;
  }[] = [];
  try {
    const res = await args.call({
      country: args.market.country,
      language: args.market.language,
      language_variant: args.market.language_variant,
      brand: args.market.brand,
      address_form: args.market.address_form ?? "",
      market_profile: marketPromptProfile(args.market),
      findings: args.findings,
      source_blocks: blocksForPrompt(args.source),
      target_blocks: blocksForPrompt(blocks.filter((b) => !b.removed)),
      removed_block_ids:
        blocks
          .filter((b) => b.removed)
          .map((b) => b.id)
          .join(", ") || "keine",
      deterministic_issues: initialHits.length
        ? initialHits.map((h) => `- ${h.block_id ?? "Dokument"}: ${h.problem}`).join("\n")
        : "keine",
    });
    addStats(stats, res);
    const parsed = validateStepData("review", ReviewOutputSchema, res.data);
    llmIssues = parsed.issues.map((i) => ({
      block_id: i.block_id ?? null,
      problem: i.problem,
      fix: (i.fix ?? null) as Record<string, unknown> | null,
    }));
  } catch (err) {
    issues.push({
      block_id: null,
      origin: "llm",
      problem: `KI-Review nicht verfügbar: ${err instanceof Error ? err.message.slice(0, 300) : "Fehler"}`,
      status: "open",
    });
  }

  // 4 · Korrekturen validiert übernehmen.
  for (const issue of llmIssues) {
    const id = issue.block_id;
    const idx = id ? blocks.findIndex((b) => b.id === id) : -1;
    const src = id ? sourceById.get(id) : undefined;
    if (!id || idx < 0 || !src) {
      issues.push({
        block_id: id,
        origin: "llm",
        problem: issue.problem,
        status: "open",
        ...(id ? { note: "unbekannte Block-ID" } : {}),
      });
      continue;
    }
    if (blocks[idx]!.removed) {
      issues.push({
        block_id: id,
        origin: "llm",
        problem: issue.problem,
        status: "rejected",
        note: "Block ist gestrichen",
      });
      continue;
    }
    if (!issue.fix) {
      issues.push({
        block_id: id,
        origin: "llm",
        problem: issue.problem,
        status: "open",
        note: "keine Korrektur geliefert",
      });
      continue;
    }
    const fix = issue.fix;
    const v = validateBlockPatch(
      src,
      {
        text: typeof fix["text"] === "string" ? (fix["text"] as string) : undefined,
        items: Array.isArray(fix["items"]) ? (fix["items"] as never) : undefined,
        rows: Array.isArray(fix["rows"]) ? (fix["rows"] as string[][]) : undefined,
      },
      { removable: false, sameLanguage },
    );
    if (v.ok) {
      blocks[idx] = v.block;
      applied.add(id);
      issues.push({ block_id: id, origin: "llm", problem: issue.problem, status: "applied" });
    } else {
      issues.push({
        block_id: id,
        origin: "llm",
        problem: issue.problem,
        status: "rejected",
        note: `Korrektur verworfen: ${v.errors.join("; ")}`,
      });
    }
  }

  // 5 · Deterministische Prüfungen nach den Korrekturen.
  const finalHits = deterministicChecks(args.source, blocks, args.findings, args.market);
  const finalKeys = new Set(finalHits.map(hitKey));
  const initialKeys = new Set(initialHits.map(hitKey));
  for (const h of initialHits) {
    issues.push({
      block_id: h.block_id,
      origin: "code",
      problem: h.problem,
      status: finalKeys.has(hitKey(h)) ? "open" : "resolved",
    });
  }
  for (const h of finalHits) {
    if (!initialKeys.has(hitKey(h))) {
      issues.push({
        block_id: h.block_id,
        origin: "code",
        problem: h.problem,
        status: "open",
        note: "nach Korrektur",
      });
    }
  }

  if (!args.localized.meta.title) {
    issues.push({ block_id: null, origin: "code", problem: "Meta-Title fehlt", status: "open" });
  }

  const warnings = issues
    .filter((i) => i.status === "open" || i.status === "rejected")
    .map((i) => `${i.block_id ?? "Dokument"}: ${i.problem}${i.note ? ` (${i.note})` : ""}`);

  const localized: LocalizedDoc = { meta: args.localized.meta, blocks };
  return {
    localized,
    review: { issues, applied: [...applied], warnings },
    exportMarkdown: renderMarkdown(blocks, localized.meta, {
      closing_note: args.market.closing_note,
    }),
    stats,
  };
}
