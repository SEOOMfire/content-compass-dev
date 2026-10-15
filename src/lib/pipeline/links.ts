import { parse } from "node-html-parser";
import { LinkPatchSchema, validateStepData } from "./schemas";
import { addStats, emptyStats, type CallStats, type PromptCall } from "./localize";
import { blockPlainText, validateBlockPatch } from "./validate";
import type { MarketProfile } from "./market";
import type {
  Block,
  LinkCheck,
  LinkingResult,
  LocalizedBlock,
  LocalizedDoc,
  SourceDoc,
  SourceLink,
} from "./types";

/**
 * Schritt 5: interne Links der Quelle auf ein hreflang-Pendant für das Zielland prüfen
 * und den ersten Treffer genau einmal in den lokalisierten Text setzen.
 */

/** Höchstens so viele verlinkte DE-Seiten werden je Job auf hreflang geprüft. */
export const MAX_LINK_CHECKS = 15;
/** Zeitbudget für die hreflang-Prüfung (ms); danach wird mit dem bisherigen Stand weitergemacht. */
export const LINK_CHECK_BUDGET_MS = 90_000;
/** Gezielte Nachfragen, wenn das Modell den Link nicht korrekt einsetzt. */
export const MAX_LINK_RETRIES = 1;
/** Nur in diesen Blocktypen wird ein Link gesetzt (keine Überschriften/Tabellen). */
const LINKABLE_TYPES = new Set<Block["type"]>(["paragraph", "list", "quote"]);

export interface FetchedPage {
  status: number;
  finalUrl: string;
  html: string;
}
export type FetchPage = (url: string) => Promise<FetchedPage>;

/** Host ohne Protokoll, Port, Pfad und „www.“, kleingeschrieben. */
export function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function hostOf(url: string): string {
  try {
    return normalizeHost(new URL(url).host);
  } catch {
    return "";
  }
}

function hostMatches(host: string, domain: string): boolean {
  return Boolean(host) && (host === domain || host.endsWith(`.${domain}`));
}

/** Sprachcode vergleichbar machen: „de_CH“ → „de-ch“. */
export function normalizeLang(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

/** URL ohne #Fragment und ohne abschließenden Slash (für Vergleiche). */
function comparableUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

/**
 * Interne Links: absolute http(s)-URL auf demselben Host wie die Quelle,
 * ohne #Fragment und ohne Verweise auf die Seite selbst. Reihenfolge bleibt erhalten.
 */
export function internalLinks(
  raw: { block_id: string; href: string; anchor: string }[],
  baseUrl: string,
): SourceLink[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const baseHost = normalizeHost(base.host);
  const self = comparableUrl(base.toString());
  const out: SourceLink[] = [];
  for (const l of raw) {
    let u: URL;
    try {
      u = new URL(l.href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (normalizeHost(u.host) !== baseHost) continue;
    u.hash = "";
    const href = u.toString();
    if (comparableUrl(href) === self) continue;
    out.push({ block_id: l.block_id, href, anchor: l.anchor });
  }
  return out;
}

export interface HreflangAlternate {
  hreflang: string;
  href: string;
}

/** Liest `<link rel="alternate" hreflang="…" href="…">` (absolute URLs). */
export function parseHreflang(html: string, baseUrl: string): HreflangAlternate[] {
  const root = parse(html, { comment: false });
  const out: HreflangAlternate[] = [];
  for (const el of root.querySelectorAll("link[hreflang]")) {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("alternate")) continue;
    const hreflang = el.getAttribute("hreflang")?.trim();
    const href = el.getAttribute("href")?.trim();
    if (!hreflang || !href) continue;
    try {
      out.push({ hreflang, href: new URL(href, baseUrl).toString() });
    } catch {
      /* ungültige URL ignorieren */
    }
  }
  return out;
}

/**
 * Passendes hreflang-Ziel für den Zielmarkt:
 * 1. exakt `market.locale` (z. B. „de-AT“), Host passt zur Marktdomain (falls gepflegt),
 * 2. sonst gleiche Sprache auf der Marktdomain (z. B. „pl“ auf maxizoo.pl).
 * `x-default` und reine Sprachcodes auf fremden Domains (z. B. „de“ → fressnapf.de) zählen nicht.
 */
export function matchHreflang(
  alternates: HreflangAlternate[],
  market: Pick<MarketProfile, "locale" | "domain">,
): HreflangAlternate | null {
  const locale = market.locale ? normalizeLang(market.locale) : null;
  const domain = market.domain ? normalizeHost(market.domain) : null;
  const usable = alternates.filter((a) => normalizeLang(a.hreflang) !== "x-default");
  const onDomain = (href: string) => !domain || hostMatches(hostOf(href), domain);

  if (locale) {
    const exact = usable.find((a) => normalizeLang(a.hreflang) === locale && onDomain(a.href));
    if (exact) return exact;
  }
  if (domain) {
    const lang = locale?.split("-")[0];
    const sameDomain = usable.find(
      (a) =>
        hostMatches(hostOf(a.href), domain) &&
        (!lang || normalizeLang(a.hreflang).split("-")[0] === lang),
    );
    if (sameDomain) return sameDomain;
  }
  return null;
}

const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Alle Markdown-Links `[Anker](URL)` eines Texts. */
export function markdownLinks(text: string): { anchor: string; href: string }[] {
  return [...text.matchAll(MD_LINK_RE)].map((m) => ({ anchor: m[1]!, href: m[2]! }));
}

/** Entfernt die Link-Syntax, der Ankertext bleibt. */
export function stripMarkdownLinks(text: string): string {
  return text.replace(MD_LINK_RE, "$1");
}

function comparable(s: string): string {
  return s.replace(/\*+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export type LinkPatchResult = { ok: true; block: LocalizedBlock } | { ok: false; errors: string[] };

/**
 * Prüft die Modellantwort: gleiche Struktur, genau ein neuer Link auf `targetHref`,
 * Text ohne Link-Syntax unverändert.
 */
export function validateLinkPatch(
  block: LocalizedBlock,
  patch: { text?: string | undefined; items?: unknown[] | undefined },
  targetHref: string,
): LinkPatchResult {
  const base = { ...block } as LocalizedBlock;
  delete (base as { removed?: boolean }).removed;
  const v = validateBlockPatch(
    base as Block,
    { text: patch.text, items: patch.items as never },
    { removable: false, sameLanguage: true },
  );
  if (!v.ok) return v;

  const before = blockPlainText(block);
  const after = blockPlainText(v.block);
  const errors: string[] = [];
  const added = markdownLinks(after).length - markdownLinks(before).length;
  if (added !== 1) errors.push(`${block.id}: ${added} statt genau 1 neuem Link`);
  const hits = markdownLinks(after).filter((l) => l.href === targetHref);
  if (hits.length !== 1) errors.push(`${block.id}: Link auf ${targetHref} fehlt oder ist mehrfach`);
  if (hits.some((l) => !l.anchor.replace(/\*+/g, "").trim()))
    errors.push(`${block.id}: Ankertext ist leer`);
  if (comparable(stripMarkdownLinks(after)) !== comparable(stripMarkdownLinks(before)))
    errors.push(`${block.id}: Text wurde verändert (nur der Link darf ergänzt werden)`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, block: v.block };
}

/** Blockinhalt ohne ID für den Prompt. */
function blockContent(b: Block): Record<string, unknown> {
  switch (b.type) {
    case "list":
      return { type: b.type, ordered: b.ordered, items: b.items };
    case "table":
      return { type: b.type, rows: b.rows };
    case "heading":
      return { type: b.type, level: b.level, text: b.text };
    default:
      return { type: b.type, text: b.text };
  }
}

export interface LinkArgs {
  source: SourceDoc;
  localized: LocalizedDoc;
  market: MarketProfile;
  fetchPage: FetchPage;
  call: PromptCall;
  maxChecks?: number;
  maxRetries?: number;
  /** Pause zwischen zwei Seitenabrufen (ms). */
  delayMs?: number;
  /** Zeitbudget für die hreflang-Prüfung (ms). */
  budgetMs?: number;
  /** Uhr (für Tests). */
  now?: () => number;
}

export interface LinkOutcome {
  linking: LinkingResult;
  /** Lokalisierte Blöcke inkl. eingefügtem Link (für den Export). */
  blocks: LocalizedBlock[];
  stats: CallStats;
}

/**
 * Schritt 5. Blockiert nie: Fehler beim Abruf oder Einfügen werden als Hinweis
 * bzw. Warnung geführt, der Export bleibt dann ohne Link.
 */
export async function linkDocument(args: LinkArgs): Promise<LinkOutcome> {
  const stats = emptyStats();
  const maxChecks = args.maxChecks ?? MAX_LINK_CHECKS;
  const maxRetries = args.maxRetries ?? MAX_LINK_RETRIES;
  const blocks = args.localized.blocks.map((b) => ({ ...b }));
  const result: LinkingResult = {
    candidates: 0,
    checked: [],
    chosen: null,
    inserted: false,
    patched_block: null,
    notes: [],
    warnings: [],
  };
  const done = (): LinkOutcome => ({ linking: result, blocks, stats });

  if (!Array.isArray(args.source.links)) {
    result.warnings.push(
      "Quelle enthält keine Linkdaten (vor Einführung von Schritt 5 extrahiert) – Schritt 1 erneut ausführen.",
    );
    return done();
  }
  result.candidates = args.source.links.length;
  if (!args.market.locale && !args.market.domain) {
    result.warnings.push("Markt ohne Locale und Domain – kein hreflang-Abgleich möglich.");
    return done();
  }

  const localizedById = new Map(blocks.map((b, i) => [b.id, i]));
  const seen = new Set<string>();
  const eligible: SourceLink[] = [];
  let skipped = 0;
  for (const link of args.source.links) {
    const idx = localizedById.get(link.block_id);
    const target = idx === undefined ? undefined : blocks[idx];
    if (!target || target.removed || !LINKABLE_TYPES.has(target.type)) {
      skipped++;
      continue;
    }
    const key = comparableUrl(link.href);
    if (seen.has(key)) continue;
    seen.add(key);
    eligible.push(link);
  }
  if (skipped) {
    result.notes.push(
      `${skipped} Link(s) übersprungen (Block gestrichen, Überschrift oder Tabelle).`,
    );
  }
  if (!eligible.length) {
    result.notes.push("Keine internen Links in verlinkbaren Blöcken gefunden.");
    return done();
  }
  if (eligible.length > maxChecks) {
    result.notes.push(`Nur die ersten ${maxChecks} von ${eligible.length} Links geprüft.`);
  }

  const pause = () =>
    args.delayMs ? new Promise((r) => setTimeout(r, args.delayMs)) : Promise.resolve();

  // 1 · hreflang je verlinkter Seite prüfen, erster Treffer gewinnt.
  const now = args.now ?? Date.now;
  const deadline = now() + (args.budgetMs ?? LINK_CHECK_BUDGET_MS);
  for (const [i, link] of eligible.slice(0, maxChecks).entries()) {
    if (now() > deadline) {
      result.notes.push(`Zeitbudget erreicht – ${i} von ${eligible.length} Links geprüft.`);
      break;
    }
    if (i > 0) await pause();
    const check: LinkCheck = { block_id: link.block_id, href: link.href, status: 0, target: null };
    result.checked.push(check);
    let page: FetchedPage;
    try {
      page = await args.fetchPage(link.href);
    } catch {
      check.note = "nicht erreichbar";
      continue;
    }
    check.status = page.status;
    if (page.status !== 200 || !page.html) {
      check.note = page.status ? `HTTP ${page.status}` : "nicht erreichbar";
      continue;
    }
    const alternates = parseHreflang(page.html, page.finalUrl || link.href);
    if (!alternates.length) {
      check.note = "kein hreflang";
      continue;
    }
    const match = matchHreflang(alternates, args.market);
    if (!match) {
      check.note = `kein hreflang für ${args.market.locale ?? args.market.domain}`;
      continue;
    }
    await pause();
    let targetStatus = 0;
    try {
      targetStatus = (await args.fetchPage(match.href)).status;
    } catch {
      targetStatus = 0;
    }
    if (targetStatus !== 200) {
      check.note = `hreflang-Ziel ${match.href} antwortet mit ${targetStatus ? `HTTP ${targetStatus}` : "Fehler"}`;
      continue;
    }
    check.target = match;
    result.chosen = {
      block_id: link.block_id,
      source_href: link.href,
      anchor_de: link.anchor,
      target_href: match.href,
      hreflang: match.hreflang,
    };
    break;
  }

  if (!result.chosen) {
    result.notes.push("Kein interner Link mit passendem hreflang für das Zielland gefunden.");
    return done();
  }

  // 2 · Link genau einmal in den lokalisierten Block setzen (KI + Code-Prüfung).
  const chosen = result.chosen;
  const idx = localizedById.get(chosen.block_id)!;
  const target = blocks[idx]!;
  const sourceBlock = args.source.blocks.find((b) => b.id === chosen.block_id);
  let corrections: string[] = [];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let patch: { text?: string | undefined; items?: unknown[] | undefined };
    try {
      const res = await args.call({
        country: args.market.country,
        language: args.market.language,
        language_variant: args.market.language_variant,
        brand: args.market.brand,
        target_block: JSON.stringify(blockContent(target)),
        source_block: sourceBlock ? JSON.stringify(blockContent(sourceBlock)) : "",
        anchor_de: chosen.anchor_de,
        target_url: chosen.target_href,
        correction_notes: corrections.join("\n"),
      });
      addStats(stats, res);
      const parsed = validateStepData("links", LinkPatchSchema, res.data);
      patch = { text: parsed.text, items: parsed.items };
    } catch (err) {
      corrections = [
        `Antwort nicht auswertbar: ${err instanceof Error ? err.message.slice(0, 300) : "Fehler"}`,
      ];
      if (err instanceof Error && /Template|Guthaben|OPENAI_API_KEY/.test(err.message)) break;
      continue;
    }
    const v = validateLinkPatch(target, patch, chosen.target_href);
    if (v.ok) {
      blocks[idx] = v.block;
      result.inserted = true;
      result.patched_block = v.block;
      return done();
    }
    corrections = v.errors;
  }
  result.warnings.push(
    `Link ${chosen.target_href} konnte nicht in ${chosen.block_id} eingefügt werden: ${corrections.join("; ")}`,
  );
  return done();
}
