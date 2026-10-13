import {
  LocalizeOutputSchema,
  StepSchemaError,
  validateStepData,
  type BlockPatch,
} from "./schemas";
import { countBlockWords } from "./words";
import { isGermanTarget, marketPromptProfile, type MarketProfile } from "./market";
import { removableBlockIds, validateBlockPatch } from "./validate";
import type { Block, Finding, LocalizedBlock, LocalizedDoc, LocalizedMeta } from "./types";

/** Ab dieser Quelltextlänge (Wörter) wird nach H2-Gruppen in mehreren Aufrufen lokalisiert. */
export const CHUNK_WORD_LIMIT = 2500;
/** Gezielte Nachfragen für fehlerhafte/fehlende Blöcke (je Aufrufgruppe). */
export const MAX_BLOCK_RETRIES = 2;

export interface PromptCallResult {
  data: unknown;
  model: string;
  promptSnapshot: string;
  tokensIn: number;
  tokensOut: number;
}

/** Ein LLM-Aufruf mit Template-Variablen (im Engine: runPrompt; im Test: Mock). */
export type PromptCall = (vars: Record<string, unknown>) => Promise<PromptCallResult>;

export interface CallStats {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  model: string | null;
  promptSnapshot: string | null;
}

export function emptyStats(): CallStats {
  return { calls: 0, tokensIn: 0, tokensOut: 0, model: null, promptSnapshot: null };
}

export function addStats(stats: CallStats, res: PromptCallResult): void {
  stats.calls += 1;
  stats.tokensIn += res.tokensIn;
  stats.tokensOut += res.tokensOut;
  stats.model ??= res.model;
  stats.promptSnapshot ??= res.promptSnapshot;
}

/** Kompakte, zeilenweise JSON-Darstellung der Blöcke für Prompts. */
export function blocksForPrompt(blocks: Block[], removable?: Set<string>): string {
  return blocks
    .map((b) => {
      const base: Record<string, unknown> = { ...b };
      if (b.type === "table") delete base["hasHeader"];
      if (removable?.has(b.id)) base["removable"] = true;
      return JSON.stringify(base);
    })
    .join("\n");
}

/** Gliederung (alle Überschriften) als Kontext. */
export function outlineOf(blocks: Block[]): string {
  return blocks
    .filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading")
    .map((b) => `${b.id} ${"#".repeat(b.level)} ${b.text}`)
    .join("\n");
}

/**
 * Zerlegt die Blöcke an H2-Grenzen (bzw. H1) in Gruppen und fasst diese zu
 * Aufrufpaketen bis zum Wortlimit zusammen.
 */
export function chunkBlocks(blocks: Block[], limit = CHUNK_WORD_LIMIT): Block[][] {
  if (countBlockWords(blocks) <= limit) return [blocks];
  const groups: Block[][] = [];
  let current: Block[] = [];
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2 && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(b);
  }
  if (current.length) groups.push(current);

  const chunks: Block[][] = [];
  let chunk: Block[] = [];
  let words = 0;
  for (const g of groups) {
    const w = countBlockWords(g);
    if (chunk.length && words + w > limit) {
      chunks.push(chunk);
      chunk = [];
      words = 0;
    }
    chunk.push(...g);
    words += w;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export class LocalizeError extends Error {
  constructor(
    message: string,
    readonly failed: { id: string; errors: string[] }[],
    readonly partial: LocalizedBlock[],
    readonly stats: CallStats,
  ) {
    super(message);
  }
}

export interface LocalizeArgs {
  blocks: Block[];
  findings: Finding[];
  market: MarketProfile;
  sourceMeta: { title: string | null; metaDescription: string | null };
  call: PromptCall;
  maxRetries?: number;
  chunkWordLimit?: number;
}

export interface LocalizeResult {
  localized: LocalizedDoc;
  stats: CallStats;
  chunks: number;
  /** Je Block-ID: Fehler der Erstantwort, die per Nachfrage behoben wurden. */
  retried: { id: string; errors: string[] }[];
}

function metaFrom(raw: unknown): Partial<LocalizedMeta> | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  return { title: s(m["title"]), meta_description: s(m["meta_description"]), slug: s(m["slug"]) };
}

/**
 * Schritt 3: Blockweise Lokalisierung. Das Modell liefert je Block-ID nur Inhalt;
 * jede Antwort wird gegen die Quellstruktur validiert. Fehlerhafte oder fehlende
 * Blöcke werden gezielt (nur diese) mit Fehlerliste erneut angefragt.
 * @throws LocalizeError wenn nach allen Nachfragen Blöcke fehlerhaft bleiben
 */
export async function localizeDocument(args: LocalizeArgs): Promise<LocalizeResult> {
  const maxRetries = args.maxRetries ?? MAX_BLOCK_RETRIES;
  const removable = removableBlockIds(args.findings);
  const sameLanguage = isGermanTarget(args.market);
  const stats = emptyStats();
  const results = new Map<string, LocalizedBlock>();
  const retried = new Map<string, string[]>();
  const failed: { id: string; errors: string[] }[] = [];
  const chunks = chunkBlocks(args.blocks, args.chunkWordLimit ?? CHUNK_WORD_LIMIT);
  const outline = outlineOf(args.blocks);
  const profile = marketPromptProfile(args.market);
  let meta: Partial<LocalizedMeta> | null = null;

  const baseVars = {
    country: args.market.country,
    language: args.market.language,
    language_variant: args.market.language_variant,
    brand: args.market.brand,
    address_form: args.market.address_form ?? "",
    market_profile: profile,
    institutions: args.market.institutions,
    forbidden_claims: args.market.forbidden_claims,
    localization_notes: args.market.localization_notes ?? "",
    findings: args.findings,
    outline,
    source_title: args.sourceMeta.title ?? "",
    source_meta_description: args.sourceMeta.metaDescription ?? "",
  };

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]!;
    let pending = chunk;
    let needMeta = c === 0;
    let corrections: string[] = [];
    let lastErrors: { id: string; errors: string[] }[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (!pending.length && !needMeta) break;
      const res = await args.call({
        ...baseVars,
        blocks: blocksForPrompt(pending, removable),
        block_ids: pending.map((b) => b.id).join(", "),
        include_meta: needMeta ? "ja" : "nein",
        part: chunks.length > 1 ? `Teil ${c + 1} von ${chunks.length}` : "vollständiges Dokument",
        correction_notes: corrections.length ? corrections.join("\n") : "",
      });
      addStats(stats, res);

      let patches: BlockPatch[] = [];
      let rawMeta: unknown = null;
      let schemaError: string | null = null;
      try {
        const parsed = validateStepData("localize", LocalizeOutputSchema, res.data);
        patches = parsed.blocks;
        rawMeta = parsed.meta ?? null;
      } catch (err) {
        schemaError =
          err instanceof StepSchemaError ? err.message.slice(0, 300) : "Antwort nicht auswertbar";
      }

      if (needMeta) {
        const m = metaFrom(rawMeta);
        if (m?.title) {
          meta = m;
          needMeta = false;
        }
      }

      const byId = new Map<string, BlockPatch>();
      for (const p of patches) if (!byId.has(p.id)) byId.set(p.id, p);

      lastErrors = [];
      for (const block of pending) {
        const patch = byId.get(block.id);
        if (!patch) {
          lastErrors.push({
            id: block.id,
            errors: [
              schemaError ? `${block.id}: ${schemaError}` : `${block.id}: fehlt in der Antwort`,
            ],
          });
          continue;
        }
        const v = validateBlockPatch(block, patch, {
          removable: removable.has(block.id),
          sameLanguage,
        });
        if (v.ok) results.set(block.id, v.block);
        else lastErrors.push({ id: block.id, errors: v.errors });
      }

      if (attempt === 0) for (const e of lastErrors) retried.set(e.id, e.errors);
      const failedIds = new Set(lastErrors.map((e) => e.id));
      pending = pending.filter((b) => failedIds.has(b.id));
      corrections = [
        ...lastErrors.flatMap((e) => e.errors),
        ...(needMeta ? ['meta: "title", "meta_description" und "slug" fehlen oder sind leer'] : []),
      ];
    }
    failed.push(...lastErrors);
  }

  if (failed.length) {
    throw new LocalizeError(
      `Lokalisierung unvollständig – fehlerhafte Blöcke nach ${maxRetries} Nachfragen: ${failed
        .map((f) => f.id)
        .join(", ")}`,
      failed,
      args.blocks.map((b) => results.get(b.id)).filter((b): b is LocalizedBlock => Boolean(b)),
      stats,
    );
  }

  const title = meta?.title || "";
  const localizedMeta: LocalizedMeta = {
    title,
    meta_description: meta?.meta_description || "",
    slug: slugify(meta?.slug || title),
  };

  return {
    localized: { meta: localizedMeta, blocks: args.blocks.map((b) => results.get(b.id)!) },
    stats,
    chunks: chunks.length,
    retried: [...retried.entries()]
      .filter(([id]) => results.has(id))
      .map(([id, errors]) => ({ id, errors })),
  };
}
