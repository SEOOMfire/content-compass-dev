import type { LocalizedBlock, LocalizedMeta, ListItem } from "./types";

/** Escaped Pipes in Tabellenzellen; <br> bleibt als Zeilenumbruch erhalten. */
function escapeCell(text: string): string {
  const t = text
    .replace(/\r?\n/g, " ")
    .replace(/(?<!\\)\|/g, "\\|")
    .trim();
  return t || " ";
}

function renderItems(items: ListItem[], ordered: boolean, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}. ` : "- ";
    lines.push(`${indent}${marker}${item.text}`);
    if (item.children?.length) {
      lines.push(...renderItems(item.children, item.childrenOrdered ?? false, depth + 1));
    }
  });
  return lines;
}

function renderTable(rows: string[][]): string {
  if (!rows.length) return "";
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const pad = (r: string[]) => [...r, ...Array.from({ length: width - r.length }, () => "")];
  // GFM verlangt eine Kopfzeile: ohne <th> wird die erste Zeile als Kopf genutzt.
  const [head, ...body] = rows.map(pad);
  const line = (cells: string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [
    line(head!),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}

/** Rendert einen einzelnen Block als Markdown (gestrichene Blöcke ergeben ""). */
export function renderBlock(block: LocalizedBlock): string {
  if (block.removed) return "";
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${block.text}`;
    case "paragraph":
      return block.text;
    case "quote":
      return `> ${block.text}`;
    case "list":
      return renderItems(block.items, block.ordered, 0).join("\n");
    case "table":
      return renderTable(block.rows);
  }
}

export interface RenderMarket {
  closing_note?: string | null;
}

/**
 * Strukturtreues Markdown: Meta-Kopf, dann `---`, dann die Blöcke in Quellreihenfolge.
 * Kein Link-, Quellen- oder Metadaten-Anhang; nur die `closing_note` des Markts am Ende.
 * Inline-Links (höchstens einer, gesetzt in Schritt 5) stehen bereits im Blocktext.
 */
export function renderMarkdown(
  blocks: LocalizedBlock[],
  meta: LocalizedMeta | null,
  market: RenderMarket = {},
): string {
  const parts: string[] = [];
  if (meta) {
    parts.push(
      [
        `**Title:** ${meta.title}`,
        `**Meta-Description:** ${meta.meta_description}`,
        `**Slug-Vorschlag:** ${meta.slug}`,
      ].join("  \n"),
    );
    parts.push("---");
  }
  for (const b of blocks) {
    const md = renderBlock(b);
    if (md.trim()) parts.push(md);
  }
  const note = market.closing_note?.trim();
  if (note) parts.push(note);
  return `${parts.join("\n\n")}\n`;
}
