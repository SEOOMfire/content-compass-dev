import { parse, NodeType, type HTMLElement, type Node } from "node-html-parser";
import type { Block, HeadingLevel, ListItem, SourceDoc } from "./types";
import { countBlockWords } from "./words";

export { countBlockWords };

export const USER_AGENT =
  "Mozilla/5.0 (compatible; OMfireLocalizationBot/1.0; +https://www.fressnapf.de/)";

/**
 * Lädt eine Seite. Netzwerk- und URL-Fehler werfen nicht, sondern liefern
 * Status 0, damit der Schritt eine klare Fehlermeldung erzeugen kann.
 */
export async function fetchHtml(
  url: string,
): Promise<{ status: number; finalUrl: string; html: string }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const html = res.headers.get("content-type")?.includes("text/") ? await res.text() : "";
    return { status: res.status, finalUrl: res.url || url, html };
  } catch {
    return { status: 0, finalUrl: url, html: "" };
  }
}

/** Entfernt versehentliche Markdown-Marker aus sichtbaren HTML-Überschriften. */
export function cleanHeadingText(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Seitenbestandteile, die nie zum redaktionellen Inhalt gehören.
 * Bewusst als Liste gehalten, damit neue Störelemente leicht ergänzt werden können.
 */
export const NOISE_SELECTORS: string[] = [
  "script",
  "style",
  "noscript",
  "template",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "figure img",
  "picture",
  "img",
  "iframe",
  "svg",
  "video",
  "audio",
  // Breadcrumbs
  ".breadcrumb",
  ".breadcrumbs",
  '[aria-label="breadcrumb"]',
  '[aria-label="Breadcrumb"]',
  '[itemtype*="BreadcrumbList"]',
  // Fressnapf-Magazin: Datum/Lesedauer, Bildnachweis, Inhaltsverzeichnis, Teaser, CTA-Buttons
  ".ai-metrics",
  ".ii-copyright",
  ".table-of-content",
  '[type="table_of_content"]',
  '[type="share_and_save"]',
  '[type="card_teaser"]',
  '[type="related_posts_table"]',
  '[type="carousel"]',
  "[data-nosnippet]",
  ".pp-toggle",
  "a.button",
];

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LIST_TAGS = new Set(["ul", "ol"]);
/** Elemente, die eigene Blöcke bilden oder Blöcke enthalten können. */
const BLOCK_LEVEL_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
/** Inhaltsfreie Elemente. */
const VOID_SKIP_TAGS = new Set([
  "img",
  "picture",
  "source",
  "svg",
  "video",
  "audio",
  "iframe",
  "input",
  "hr",
  "wbr",
]);

function tagOf(node: Node): string {
  return node.nodeType === NodeType.ELEMENT_NODE
    ? ((node as HTMLElement).rawTagName ?? "").toLowerCase()
    : "";
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === NodeType.ELEMENT_NODE;
}

function hasBlockDescendant(el: HTMLElement): boolean {
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    if (BLOCK_LEVEL_TAGS.has(tagOf(child))) return true;
    if (hasBlockDescendant(child)) return true;
  }
  return false;
}

interface InlineOptions {
  /** Fett/Kursiv als Markdown erhalten (in Überschriften aus). */
  formatting: boolean;
  /** Trenner zwischen Listenpunkten (z. B. in Tabellenzellen "<br>"). */
  listSeparator?: string;
  /** Diese Tags beim Text ignorieren (z. B. verschachtelte Listen eines li). */
  skipTags?: Set<string>;
}

interface InlineState {
  bold: boolean;
  italic: boolean;
}

/** Hüllt Text in Marker; Leerraum bleibt außerhalb, damit gültiges Markdown entsteht. */
function wrap(marker: string, inner: string): string {
  if (!inner.trim()) return inner;
  const lead = inner.match(/^\s*/)?.[0] ?? "";
  const trail = inner.match(/\s*$/)?.[0] ?? "";
  return `${lead}${marker}${inner.trim()}${marker}${trail}`;
}

const SPAN_LIKE = new Set(["span", "div"]);

function inlineChildren(el: HTMLElement, opts: InlineOptions, state: InlineState): string {
  let out = "";
  let prevSpanLike = false;
  for (const child of el.childNodes) {
    const tag = tagOf(child);
    const spanLike = SPAN_LIKE.has(tag);
    const piece = inlineNode(child, opts, state);
    // Benachbarte <span>/<div> ohne Leerraum dazwischen (z. B. "Steckbrief" + "Barbet")
    // sind optisch getrennt und bekommen ein Leerzeichen.
    if (spanLike && prevSpanLike && out && !/\s$/.test(out) && piece && !/^\s/.test(piece)) {
      out += " ";
    }
    out += piece;
    if (child.nodeType === NodeType.TEXT_NODE) {
      if ((child as unknown as { text: string }).text.trim()) prevSpanLike = false;
    } else if (isElement(child)) {
      prevSpanLike = spanLike;
    }
  }
  return out;
}

function inlineNode(node: Node, opts: InlineOptions, state: InlineState): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return (node as unknown as { text: string }).text;
  }
  if (!isElement(node)) return "";
  const tag = tagOf(node);
  if (opts.skipTags?.has(tag)) return " ";
  if (VOID_SKIP_TAGS.has(tag)) return "";
  if (tag === "br") return " ";
  if (opts.formatting && (tag === "strong" || tag === "b")) {
    if (state.bold) return inlineChildren(node, opts, state);
    return wrap("**", inlineChildren(node, opts, { ...state, bold: true }));
  }
  if (opts.formatting && (tag === "em" || tag === "i")) {
    if (state.italic) return inlineChildren(node, opts, state);
    return wrap("*", inlineChildren(node, opts, { ...state, italic: true }));
  }
  if (tag === "li" && opts.listSeparator) {
    return `${opts.listSeparator}${inlineChildren(node, opts, state)}`;
  }
  if (BLOCK_LEVEL_TAGS.has(tag)) {
    return ` ${inlineChildren(node, opts, state)} `;
  }
  return inlineChildren(node, opts, state);
}

/** Normalisiert Leerraum und doppelte Marker eines Inline-Texts. */
function normalizeInline(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\*\*\*\*/g, "")
    .replace(/\*\*\s*\*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inlineText(el: HTMLElement, opts: InlineOptions = { formatting: true }): string {
  return normalizeInline(inlineChildren(el, opts, { bold: false, italic: false }));
}

function headingText(el: HTMLElement): string {
  return cleanHeadingText(inlineText(el, { formatting: false }));
}

/** Direkte und tiefer liegende Listen eines li – aber nicht in verschachtelten li hinein. */
function nestedLists(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    const tag = tagOf(child);
    if (LIST_TAGS.has(tag)) out.push(child);
    else if (tag !== "li") out.push(...nestedLists(child));
  }
  return out;
}

function parseListItems(list: HTMLElement): ListItem[] {
  const items: ListItem[] = [];
  const lis = directListItems(list);
  for (const li of lis) {
    const text = inlineText(li, { formatting: true, skipTags: LIST_TAGS });
    const subLists = nestedLists(li);
    const children = subLists.flatMap((l) => parseListItems(l));
    if (!text && !children.length) continue;
    const item: ListItem = { text };
    if (children.length) {
      item.children = children;
      if (subLists.some((l) => tagOf(l) === "ol")) item.childrenOrdered = true;
    }
    items.push(item);
  }
  return items;
}

/** li-Elemente einer Liste (auch, wenn ein Framework-Wrapper dazwischen liegt). */
function directListItems(list: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of list.childNodes) {
    if (!isElement(child)) continue;
    const tag = tagOf(child);
    if (tag === "li") out.push(child);
    else if (!LIST_TAGS.has(tag)) out.push(...directListItems(child));
  }
  return out;
}

/** Zeilen einer Tabelle ohne die Zeilen verschachtelter Tabellen. */
function tableRows(table: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (el: HTMLElement) => {
    for (const child of el.childNodes) {
      if (!isElement(child)) continue;
      const tag = tagOf(child);
      if (tag === "tr") out.push(child);
      else if (tag !== "table") visit(child);
    }
  };
  visit(table);
  return out;
}

function parseTable(table: HTMLElement): { hasHeader: boolean; rows: string[][]; caption: string } {
  const trs = tableRows(table);
  const rows: string[][] = [];
  let firstRowHasTh = false;
  trs.forEach((tr, i) => {
    const cells: string[] = [];
    for (const cell of tr.childNodes) {
      if (!isElement(cell)) continue;
      const tag = tagOf(cell);
      if (tag !== "td" && tag !== "th") continue;
      if (i === 0 && tag === "th") firstRowHasTh = true;
      const text = cellText(cell);
      const span = Math.max(
        1,
        Math.min(50, Number.parseInt(cell.getAttribute("colspan") ?? "1", 10) || 1),
      );
      cells.push(text);
      for (let s = 1; s < span; s++) cells.push("");
    }
    if (cells.length) rows.push(cells);
  });
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  for (const r of rows) while (r.length < width) r.push("");
  const hasHeader = Boolean(table.querySelector("thead")) || firstRowHasTh;
  const captionEl = table.querySelector("caption");
  return { hasHeader, rows, caption: captionEl ? inlineText(captionEl) : "" };
}

/** Zelltext: Listen in Zellen werden mit <br> verbunden. */
function cellText(cell: HTMLElement): string {
  const raw = inlineText(cell, { formatting: true, listSeparator: "<br>" });
  return raw
    .replace(/^\s*<br>\s*/, "")
    .replace(/\s*<br>\s*/g, "<br>")
    .trim();
}

type BlockDraft = Block extends infer T ? (T extends Block ? Omit<T, "id"> : never) : never;

interface WalkState {
  blocks: BlockDraft[];
}

function pushBlock(state: WalkState, block: BlockDraft) {
  state.blocks.push(block);
}

/** Rekursiver DOM-Walk in Dokumentreihenfolge – jedes Element wird genau einmal erfasst. */
function walk(el: HTMLElement, state: WalkState) {
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = normalizeInline(
      run.map((n) => inlineNode(n, { formatting: true }, { bold: false, italic: false })).join(""),
    );
    run = [];
    if (text) pushBlock(state, { type: "paragraph", text });
  };

  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      run.push(child);
      continue;
    }
    if (!isElement(child)) continue;
    const tag = tagOf(child);
    if (HEADING_TAGS.has(tag)) {
      flush();
      const text = headingText(child);
      if (text) pushBlock(state, { type: "heading", level: Number(tag[1]) as HeadingLevel, text });
    } else if (tag === "p") {
      flush();
      if (hasBlockDescendant(child)) {
        walk(child, state);
      } else {
        const text = inlineText(child);
        if (text) pushBlock(state, { type: "paragraph", text });
      }
    } else if (LIST_TAGS.has(tag)) {
      flush();
      const items = parseListItems(child);
      if (items.length) pushBlock(state, { type: "list", ordered: tag === "ol", items });
    } else if (tag === "table") {
      flush();
      const t = parseTable(child);
      if (t.caption) pushBlock(state, { type: "paragraph", text: t.caption });
      if (t.rows.length) pushBlock(state, { type: "table", hasHeader: t.hasHeader, rows: t.rows });
    } else if (tag === "blockquote") {
      flush();
      const text = inlineText(child);
      if (text) pushBlock(state, { type: "quote", text });
    } else if (VOID_SKIP_TAGS.has(tag)) {
      continue;
    } else if (tag === "br") {
      run.push(child);
    } else if (BLOCK_LEVEL_TAGS.has(tag) || hasBlockDescendant(child)) {
      flush();
      walk(child, state);
    } else {
      run.push(child);
    }
  }
  flush();
}

/** Inhaltsbereich: main → article → kleinster Vorfahre der h1 mit dem Großteil der Absätze → body. */
function contentRoot(root: HTMLElement): HTMLElement {
  const main = root.querySelector("main");
  if (main) return main;
  const article = root.querySelector("article");
  if (article) return article;
  const body = root.querySelector("body") ?? root;
  const h1 = body.querySelector("h1");
  const totalP = body.querySelectorAll("p").length;
  if (h1 && totalP) {
    let node = h1.parentNode as HTMLElement | null;
    while (node && node !== body) {
      if (node.querySelectorAll("p").length >= Math.ceil(totalP * 0.6)) return node;
      node = node.parentNode as HTMLElement | null;
    }
  }
  return body;
}

/** Entfernt Überschriften am Dokumentende, auf die kein Inhalt mehr folgt (Teaser-Reste). */
function trimTrailingHeadings(blocks: BlockDraft[]): BlockDraft[] {
  let end = blocks.length;
  while (end > 0 && blocks[end - 1]!.type === "heading") end--;
  return blocks.slice(0, end);
}

export interface ExtractedBlocks {
  title: string | null;
  metaDescription: string | null;
  blocks: Block[];
}

/** Reine Funktion: HTML → Meta + Blockliste mit IDs b1, b2, … in Dokumentreihenfolge. */
export function extractBlocks(html: string): ExtractedBlocks {
  const root = parse(html, { comment: false });
  const titleEl = root.querySelector("title");
  const title = titleEl ? titleEl.text.replace(/\s+/g, " ").trim() || null : null;
  const metaDescription =
    root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || null;

  for (const selector of NOISE_SELECTORS) {
    for (const node of root.querySelectorAll(selector)) node.remove();
  }

  const state: WalkState = { blocks: [] };
  walk(contentRoot(root), state);
  const blocks = trimTrailingHeadings(state.blocks).map(
    (b, i) => ({ id: `b${i + 1}`, ...b }) as Block,
  );
  return { title, metaDescription, blocks };
}

/** Lädt die Quelle und zerlegt sie in Blöcke. */
export async function extractSource(url: string): Promise<SourceDoc> {
  const { status, finalUrl, html } = await fetchHtml(url);
  const { title, metaDescription, blocks } = html
    ? extractBlocks(html)
    : { title: null, metaDescription: null, blocks: [] };
  return {
    url,
    finalUrl,
    httpStatus: status,
    title,
    metaDescription,
    blocks,
    wordCount: countBlockWords(blocks),
  };
}
