import type { Block, ListItem } from "./types";

function words(s: string): number {
  return s.replace(/\*+/g, "").split(/\s+/).filter(Boolean).length;
}

/** Wortzahl einer Blockliste (Überschriften, Absätze, Listenpunkte, Tabellenzellen). */
export function countBlockWords(blocks: Block[]): number {
  let n = 0;
  const items = (list: ListItem[]): void => {
    for (const it of list) {
      n += words(it.text);
      if (it.children) items(it.children);
    }
  };
  for (const b of blocks) {
    if (b.type === "list") items(b.items);
    else if (b.type === "table") for (const r of b.rows) for (const c of r) n += words(c);
    else n += words(b.text);
  }
  return n;
}
