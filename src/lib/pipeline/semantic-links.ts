import { addStats, emptyStats, type CallStats, type PromptCall } from "./localize";
import { blockPlainText } from "./validate";
import { LINKABLE_TYPES, markdownLinks } from "./links";
import { SemanticKeywordsOutputSchema, validateStepData } from "./schemas";
import { localeParts, type MarketProfile } from "./market";
import type {
  LinkingResult,
  ListItem,
  LocalizedBlock,
  LocalizedDoc,
  SemanticCandidate,
  SemanticKeyword,
  SemanticLinkingResult,
} from "./types";
import {
  DEFAULT_CANDIDATES,
  DEFAULT_DECISIONS_CONCURRENCY,
  DEFAULT_MAX_KEYWORDS,
  DEFAULT_THRESHOLD,
  PAYLOAD_MAX_CHARS,
} from "./semantic-links.config";

/**
 * Schritt 6: semantische interne Verlinkung. Reine Logik – alle externen
 * Abhängigkeiten (LLM, Embedding, Index-RPC, Decisions) werden injiziert,
 * damit der Ablauf ohne Netzwerk testbar ist.
 */

export interface MatchPage {
  url: string;
  title: string | null;
  content_payload: string;
  similarity: number;
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;
export type MatchFn = (args: {
  embedding: number[];
  country: string;
  language: string;
  excludeUrls: string[];
  limit: number;
}) => Promise<MatchPage[]>;
export type DecideFn = (args: {
  payload: string;
  instructions: string;
}) => Promise<{ probability: number | null }>;

export interface SemanticLinkArgs {
  localized: LocalizedDoc;
  linking?: LinkingResult;
  market: MarketProfile;
  /** LLM-Aufruf des Templates `semantic_link_keywords`. */
  call: PromptCall;
  embed: EmbedFn;
  matchPages: MatchFn;
  decide: DecideFn;
  maxKeywords?: number;
  candidates?: number;
  threshold?: number;
  decisionsConcurrency?: number;
  payloadMaxChars?: number;
}

export interface SemanticLinkOutcome {
  semanticLinking: SemanticLinkingResult;
  /** Lokalisierte Blöcke (Schritt-5-Link angewendet, noch ohne semantische Links). */
  blocks: LocalizedBlock[];
  stats: CallStats;
}

export interface ApplySemanticLinksOutcome {
  blocks: LocalizedBlock[];
  inserted: { block_id: string; keyword: string; url: string }[];
}

function normalizeKeyword(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Basis-Blöcke = `localized.blocks` mit dem Schritt-5-Link (patched_block) angewendet. */
export function applyLinkingPatch(
  localized: LocalizedDoc,
  linking?: LinkingResult,
): LocalizedBlock[] {
  const blocks = localized.blocks.map((b) => ({ ...b }));
  if (linking?.inserted && linking?.patched_block) {
    const idx = blocks.findIndex((b) => b.id === linking.patched_block!.id);
    if (idx >= 0) blocks[idx] = linking.patched_block;
  }
  return blocks;
}

/** Bereits im Text verlinkte URLs (inkl. Schritt-5-Ziel) – als Ausschlussliste. */
export function alreadyLinkedUrls(blocks: LocalizedBlock[], linking?: LinkingResult): string[] {
  const urls = new Set<string>();
  for (const b of blocks) {
    for (const l of markdownLinks(blockPlainText(b))) if (l.href) urls.add(l.href);
  }
  if (linking?.chosen?.target_href) urls.add(linking.chosen.target_href);
  return [...urls];
}

interface LinkSpan {
  start: number;
  end: number;
}

function linkSpans(text: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  for (const m of text.matchAll(/\[([^\]\n]*)\]\(([^)\s]+)\)/g)) {
    const start = m.index!;
    spans.push({ start, end: start + m[0].length });
  }
  return spans;
}

/**
 * Erstes Vorkommen des Keywords außerhalb bestehender `[..](..)`-Links wird zum
 * Markdown-Link. Liefert den neuen Text oder null, wenn es kein freies Vorkommen gibt.
 */
export function insertLinkIntoText(text: string, keyword: string, url: string): string | null {
  const needle = normalizeKeyword(keyword);
  if (!needle) return null;
  const lower = text.toLowerCase();
  const nLower = needle.toLowerCase();
  const spans = linkSpans(text);
  let from = 0;
  for (;;) {
    const idx = lower.indexOf(nLower, from);
    if (idx === -1) return null;
    const end = idx + nLower.length;
    const overlap = spans.find((s) => idx < s.end && end > s.start);
    if (!overlap) {
      const anchor = text.slice(idx, end);
      return `${text.slice(0, idx)}[${anchor}](${url})${text.slice(end)}`;
    }
    from = overlap.end;
  }
}

function insertIntoItems(items: ListItem[], keyword: string, url: string): ListItem[] | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const text = insertLinkIntoText(item.text, keyword, url);
    if (text !== null) {
      const next = items.slice();
      next[i] = { ...item, text };
      return next;
    }
    if (item.children?.length) {
      const children = insertIntoItems(item.children, keyword, url);
      if (children) {
        const next = items.slice();
        next[i] = { ...item, children };
        return next;
      }
    }
  }
  return null;
}

/** Setzt das Keyword als Link in einen verlinkbaren Block (paragraph/list/quote). */
export function insertLinkIntoBlock(
  block: LocalizedBlock,
  keyword: string,
  url: string,
): LocalizedBlock | null {
  switch (block.type) {
    case "paragraph":
    case "quote": {
      const text = insertLinkIntoText(block.text, keyword, url);
      return text === null ? null : { ...block, text };
    }
    case "list": {
      const items = insertIntoItems(block.items, keyword, url);
      return items ? { ...block, items } : null;
    }
    default:
      return null;
  }
}

function decisionsInstructions(keyword: string, intent: string): string {
  return (
    `Bedient dieser Artikel als weiterführender Ratgeber-Link die Suchintention ` +
    `„${intent}“ zum Ankertext „${keyword}“ ausreichend? Produkt-/Kategorieseiten = nein.`
  );
}

interface Candidate {
  url: string;
  title: string | null;
  similarity: number;
  probability: number | null;
  content_payload: string;
}

interface Entry {
  block_id: string;
  keyword: string;
  intent: string;
  block: LocalizedBlock;
  candidates: Candidate[];
  chosen: { url: string; title: string | null; similarity: number; probability: number } | null;
  eligible: boolean;
  note?: string;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const n = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

function publicKeyword(entry: Entry): SemanticKeyword {
  return {
    block_id: entry.block_id,
    keyword: entry.keyword,
    intent: entry.intent,
    candidates: entry.candidates.map<SemanticCandidate>((c) => ({
      url: c.url,
      title: c.title,
      similarity: c.similarity,
      probability: c.probability,
    })),
    chosen: entry.chosen,
    eligible: entry.eligible,
    ...(entry.note ? { note: entry.note } : {}),
  };
}

/**
 * Führt Schritt 6 aus. Blockiert nie: Fehler bei Embedding/Index/Decisions werden
 * als Hinweis bzw. Warnung geführt, der Export bleibt dann ohne (zusätzliche) Links.
 */
export async function semanticLinkDocument(args: SemanticLinkArgs): Promise<SemanticLinkOutcome> {
  const stats = emptyStats();
  const maxKeywords = args.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
  const candidateCount = args.candidates ?? DEFAULT_CANDIDATES;
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;
  const concurrency = args.decisionsConcurrency ?? DEFAULT_DECISIONS_CONCURRENCY;
  const payloadMax = args.payloadMaxChars ?? PAYLOAD_MAX_CHARS;

  const blocks = applyLinkingPatch(args.localized, args.linking);
  const result: SemanticLinkingResult = { keywords: [], inserted: [], notes: [], warnings: [] };
  const done = (): SemanticLinkOutcome => ({ semanticLinking: result, blocks, stats });

  const locale = localeParts(args.market.locale);
  if (!locale) {
    result.warnings.push("Markt ohne gültige Locale – semantische Verlinkung nicht möglich.");
    return done();
  }

  const linkable = blocks.filter(
    (b) =>
      !b.removed && LINKABLE_TYPES.has(b.type) && markdownLinks(blockPlainText(b)).length === 0,
  );
  if (!linkable.length) {
    result.notes.push("Keine verlinkbaren Blöcke ohne bestehenden Link gefunden.");
    return done();
  }

  // 1 · Keywords per LLM extrahieren und validieren.
  const entries: Entry[] = [];
  try {
    const res = await args.call({
      country: args.market.country,
      language: args.market.language,
      language_variant: args.market.language_variant,
      brand: args.market.brand,
      blocks: linkable.map((b) => JSON.stringify({ id: b.id, text: blockPlainText(b) })).join("\n"),
    });
    addStats(stats, res);
    const parsed = validateStepData("semantic_links", SemanticKeywordsOutputSchema, res.data);
    const byId = new Map(linkable.map((b) => [b.id, b]));
    const seenBlocks = new Set<string>();
    const seenKeywords = new Set<string>();
    for (const k of parsed.keywords) {
      const block = byId.get(k.block_id);
      if (!block || seenBlocks.has(block.id)) continue;
      const kw = normalizeKeyword(k.keyword);
      if (!kw) continue;
      const kwKey = kw.toLowerCase();
      if (seenKeywords.has(kwKey)) continue;
      if (!blockPlainText(block).replace(/\s+/g, " ").toLowerCase().includes(kwKey)) continue;
      seenBlocks.add(block.id);
      seenKeywords.add(kwKey);
      entries.push({
        block_id: block.id,
        keyword: kw,
        intent: normalizeKeyword(k.intent),
        block,
        candidates: [],
        chosen: null,
        eligible: false,
      });
      if (entries.length >= maxKeywords) break;
    }
  } catch (err) {
    result.warnings.push(
      `Keyword-Extraktion fehlgeschlagen: ${err instanceof Error ? err.message.slice(0, 300) : "Fehler"}`,
    );
    return done();
  }
  if (!entries.length) {
    result.notes.push("Keine gültigen Keywords gefunden.");
    return done();
  }

  // 2 · Alle Suchintents in einem Batch einbetten.
  let embeddings: number[][];
  try {
    embeddings = await args.embed(entries.map((e) => e.intent));
  } catch (err) {
    result.warnings.push(
      `Embedding fehlgeschlagen: ${err instanceof Error ? err.message.slice(0, 300) : "Fehler"}`,
    );
    return done();
  }
  if (!Array.isArray(embeddings) || embeddings.length !== entries.length) {
    result.warnings.push("Embedding-Antwort unvollständig – Schritt abgebrochen.");
    return done();
  }

  // 3 · Kandidaten je Keyword aus dem Index abrufen.
  const excludeUrls = alreadyLinkedUrls(blocks, args.linking);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    try {
      const pages = await args.matchPages({
        embedding: embeddings[i]!,
        country: locale.country,
        language: locale.language,
        excludeUrls,
        limit: candidateCount,
      });
      entry.candidates = pages.map((p) => ({
        url: p.url,
        title: p.title,
        similarity: p.similarity,
        probability: null,
        content_payload: p.content_payload,
      }));
      if (!pages.length) entry.note = "Keine Kandidaten im Index gefunden.";
    } catch (err) {
      entry.note = `Index-Abfrage fehlgeschlagen: ${err instanceof Error ? err.message.slice(0, 200) : "Fehler"}`;
    }
  }

  // 4 · Kandidaten per Decisions API bewerten (Concurrency-Limit).
  const tasks: { entry: Entry; candidate: Candidate }[] = [];
  for (const entry of entries) {
    for (const candidate of entry.candidates) tasks.push({ entry, candidate });
  }
  await runWithConcurrency(tasks, concurrency, async ({ entry, candidate }) => {
    try {
      const res = await args.decide({
        payload: candidate.content_payload.slice(0, payloadMax),
        instructions: decisionsInstructions(entry.keyword, entry.intent),
      });
      candidate.probability = res.probability;
    } catch {
      candidate.probability = null;
    }
  });

  // 5 · Besten Kandidaten je Keyword bestimmen (Vorschlag – noch kein Einsetzen).
  for (const entry of entries) {
    const best = entry.candidates
      .filter((c) => c.probability != null)
      .sort((a, b) => b.probability! - a.probability! || b.similarity - a.similarity)[0];
    if (!best) {
      if (!entry.note) entry.note = "Kein bewerteter Kandidat.";
      continue;
    }
    entry.chosen = {
      url: best.url,
      title: best.title,
      similarity: best.similarity,
      probability: best.probability!,
    };
    entry.eligible = best.probability! >= threshold;
    if (!entry.eligible && !entry.note) {
      entry.note = `Bester Kandidat unter der Schwelle (${Math.round(best.probability! * 100)} % < ${Math.round(threshold * 100)} %).`;
    }
  }

  result.keywords = entries
    .map(publicKeyword)
    .sort(
      (a, b) =>
        Number(b.chosen?.probability ?? -1) - Number(a.chosen?.probability ?? -1) ||
        Number(b.chosen?.similarity ?? -1) - Number(a.chosen?.similarity ?? -1),
    );
  return { semanticLinking: result, blocks, stats };
}

/** Setzt die vom Nutzer gewählten Links per Code ein (URL einmal, nur mit Kandidat). */
export function applySemanticLinks(
  localized: LocalizedDoc,
  linking: LinkingResult | undefined,
  semanticLinking: SemanticLinkingResult,
  selectedBlockIds: string[],
): ApplySemanticLinksOutcome {
  const blocks = applyLinkingPatch(localized, linking);
  const selected = new Set(selectedBlockIds);
  const inserted: { block_id: string; keyword: string; url: string }[] = [];
  const usedUrls = new Set<string>();
  const patchedByBlock = new Map<string, LocalizedBlock>();
  for (const kw of semanticLinking.keywords) {
    if (!kw.chosen) continue;
    if (!selected.has(kw.block_id)) continue;
    if (usedUrls.has(kw.chosen.url)) continue;
    const base = blocks.find((b) => b.id === kw.block_id);
    if (!base) continue;
    const patched = insertLinkIntoBlock(base, kw.keyword, kw.chosen.url);
    if (!patched) continue;
    usedUrls.add(kw.chosen.url);
    patchedByBlock.set(kw.block_id, patched);
    inserted.push({ block_id: kw.block_id, keyword: kw.keyword, url: kw.chosen.url });
  }
  return { blocks: blocks.map((b) => patchedByBlock.get(b.id) ?? b), inserted };
}
