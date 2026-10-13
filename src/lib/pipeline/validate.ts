import type { ListItemInput } from "./schemas";
import { forbidsEszett, isGermanTarget, type MarketProfile } from "./market";
import type { Block, Finding, ListItem, LocalizedBlock } from "./types";

/**
 * Validierung lokalisierter Blöcke gegen die Quellstruktur.
 * Ersetzt die früheren Zähl-Guards (tables.ts, content-guards.ts, plan.ts):
 * Struktur wird nicht geschätzt, sondern Block für Block verglichen.
 */

export interface BlockContent {
  text?: string | undefined;
  items?: ListItemInput[] | undefined;
  rows?: string[][] | undefined;
  removed?: boolean | undefined;
}

export interface ValidateOptions {
  /** Block ist in einem `streichen`-Finding referenziert. */
  removable: boolean;
  /** Zielsprache = Quellsprache (Deutsch) → identischer Text ist erlaubt. */
  sameLanguage: boolean;
}

export type ValidationResult =
  { ok: true; block: LocalizedBlock } | { ok: false; errors: string[] };

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function comparable(s: string): string {
  return s.replace(/\*+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const SYNTAX_RULES: { re: RegExp; label: string }[] = [
  { re: /^\s*#{1,6}(\s|$)/, label: "beginnt mit Überschriften-Markdown (#)" },
  { re: /^\s*\|/, label: "beginnt mit Tabellen-Markdown (|)" },
  { re: /^\s*[-+]\s/, label: "beginnt mit Listenzeichen (- )" },
  { re: /^\s*\*\s/, label: "beginnt mit Listenzeichen (* )" },
  { re: /^\s*\d+[.)]\s/, label: "beginnt mit nummeriertem Listenpunkt" },
  { re: /^\s*>\s?/, label: "beginnt mit Zitat-Markdown (>)" },
];

/**
 * Prüft einen Textwert auf Markdown-Blocksyntax. Regeln, die schon auf den
 * Quelltext zutreffen, werden nicht beanstandet.
 * @returns Fehlerbeschreibung oder null
 */
export function blockSyntaxProblem(text: string, sourceText = ""): string | null {
  if (/\n\s*\n/.test(text)) return "enthält einen Absatzumbruch (Leerzeile)";
  for (const line of text.split(/\r?\n/)) {
    for (const rule of SYNTAX_RULES) {
      if (rule.re.test(line) && !rule.re.test(sourceText)) return rule.label;
    }
  }
  return null;
}

function cleanText(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

/** Prüft einen einzelnen Textwert (Überschrift, Absatz, Listenpunkt, Zelle). */
function checkText(
  label: string,
  target: string | undefined,
  source: string,
  opts: { allowEmpty?: boolean },
): { value: string; error: string | null } {
  if (typeof target !== "string") return { value: "", error: `${label}: Text fehlt` };
  const syntax = blockSyntaxProblem(target, source);
  if (syntax) return { value: target, error: `${label}: ${syntax}` };
  const value = cleanText(target);
  if (!value && !(opts.allowEmpty || !source.trim())) return { value, error: `${label}: leer` };
  return { value, error: null };
}

function identical(source: string, target: string, sameLanguage: boolean): boolean {
  if (sameLanguage) return false;
  if (words(source.replace(/\*+/g, "")) < 4) return false;
  return comparable(source) === comparable(target);
}

export function normalizeItems(input: ListItemInput[]): ListItem[] {
  return input.map((it) => {
    if (typeof it === "string") return { text: it };
    const item: ListItem = { text: it.text == null ? "" : String(it.text) };
    if (it.children?.length) item.children = normalizeItems(it.children);
    return item;
  });
}

function flattenItems(items: ListItem[]): string[] {
  return items.flatMap((i) => [i.text, ...(i.children ? flattenItems(i.children) : [])]);
}

/** Vergleicht Listenstruktur rekursiv und übernimmt Texte (nur bei gleicher Form). */
function checkItems(
  src: ListItem[],
  tgt: ListItem[],
  path: string,
  allowFewer: boolean,
  errors: string[],
): ListItem[] {
  if (tgt.length !== src.length && !(allowFewer && tgt.length > 0 && tgt.length < src.length)) {
    errors.push(`${path}: ${tgt.length} statt ${src.length} Listenpunkte`);
    return [];
  }
  const sameShape = tgt.length === src.length;
  return tgt.map((t, i) => {
    const s = sameShape ? src[i]! : undefined;
    const label = `${path} Punkt ${i + 1}`;
    const { value, error } = checkText(label, t.text, s?.text ?? "", {});
    if (error) errors.push(error);
    const out: ListItem = { text: value };
    const srcChildren = s?.children ?? [];
    const tgtChildren = t.children ?? [];
    if (s) {
      if (srcChildren.length || tgtChildren.length) {
        const merged = checkItems(
          srcChildren,
          tgtChildren,
          `${label} (Unterliste)`,
          allowFewer,
          errors,
        );
        if (merged.length) out.children = merged;
        if (s.childrenOrdered) out.childrenOrdered = true;
      }
    } else if (tgtChildren.length) {
      out.children = tgtChildren;
    }
    return out;
  });
}

/**
 * Validiert die Modellantwort für einen Block. Bei Erfolg entsteht ein
 * lokalisierter Block mit derselben ID und Struktur wie die Quelle.
 */
export function validateBlockPatch(
  source: Block,
  patch: BlockContent,
  opts: ValidateOptions,
): ValidationResult {
  const errors: string[] = [];
  if (patch.removed === true) {
    if (!opts.removable) {
      return {
        ok: false,
        errors: [`${source.id}: "removed" ist nur bei einem streichen-Finding erlaubt`],
      };
    }
    return { ok: true, block: { ...source, removed: true } };
  }

  switch (source.type) {
    case "heading":
    case "paragraph":
    case "quote": {
      if (typeof patch.text !== "string") {
        const got = patch.items ? "items" : patch.rows ? "rows" : "nichts";
        return {
          ok: false,
          errors: [`${source.id}: Typ passt nicht – erwartet "text", erhalten ${got}`],
        };
      }
      const { value, error } = checkText(source.id, patch.text, source.text, {});
      if (error) errors.push(error);
      else if (identical(source.text, value, opts.sameLanguage)) {
        errors.push(`${source.id}: unübersetzt (identisch mit der Quelle)`);
      }
      if (errors.length) return { ok: false, errors };
      return { ok: true, block: { ...source, text: value } };
    }
    case "list": {
      if (!Array.isArray(patch.items)) {
        return { ok: false, errors: [`${source.id}: Typ passt nicht – erwartet "items"`] };
      }
      const items = checkItems(
        source.items,
        normalizeItems(patch.items),
        source.id,
        opts.removable,
        errors,
      );
      if (!errors.length) {
        const src = flattenItems(source.items).join(" ");
        const tgt = flattenItems(items).join(" ");
        if (identical(src, tgt, opts.sameLanguage))
          errors.push(`${source.id}: unübersetzt (identisch mit der Quelle)`);
      }
      if (errors.length) return { ok: false, errors };
      return { ok: true, block: { ...source, items } };
    }
    case "table": {
      if (!Array.isArray(patch.rows)) {
        return { ok: false, errors: [`${source.id}: Typ passt nicht – erwartet "rows"`] };
      }
      if (patch.rows.length !== source.rows.length) {
        return {
          ok: false,
          errors: [`${source.id}: ${patch.rows.length} statt ${source.rows.length} Tabellenzeilen`],
        };
      }
      const rows: string[][] = [];
      patch.rows.forEach((row, r) => {
        const srcRow = source.rows[r]!;
        if (!Array.isArray(row) || row.length !== srcRow.length) {
          errors.push(
            `${source.id}: Zeile ${r + 1} hat ${Array.isArray(row) ? row.length : 0} statt ${srcRow.length} Spalten`,
          );
          return;
        }
        rows.push(
          row.map((cell, c) => {
            const srcCell = srcRow[c] ?? "";
            const label = `${source.id} Zelle ${r + 1}/${c + 1}`;
            if (typeof cell !== "string") {
              errors.push(`${label}: Text fehlt`);
              return "";
            }
            if (/\n\s*\n/.test(cell)) errors.push(`${label}: enthält einen Absatzumbruch`);
            const value = cleanText(cell);
            if (!value && srcCell.trim()) errors.push(`${label}: leer`);
            return value;
          }),
        );
      });
      if (!errors.length) {
        const src = source.rows.flat().join(" ");
        const tgt = rows.flat().join(" ");
        if (identical(src, tgt, opts.sameLanguage))
          errors.push(`${source.id}: unübersetzt (identisch mit der Quelle)`);
      }
      if (errors.length) return { ok: false, errors };
      return { ok: true, block: { ...source, rows } };
    }
  }
}

/** Blöcke, die laut Findings gestrichen werden dürfen. */
export function removableBlockIds(findings: Finding[]): Set<string> {
  return new Set(findings.filter((f) => f.decision === "streichen").flatMap((f) => f.block_ids));
}

/** Klartext eines Blocks (für Restbestands-, Marken- und Claim-Prüfungen). */
export function blockPlainText(b: Block): string {
  switch (b.type) {
    case "list":
      return flattenItems(b.items).join(" \n");
    case "table":
      return b.rows.map((r) => r.join(" | ")).join(" \n");
    default:
      return b.text;
  }
}

export interface CheckHit {
  block_id: string | null;
  problem: string;
}

/** Struktur-Identität Quelle ↔ Ziel: Reihenfolge, Typen, Heading-Level, Tabellen- und Listenform. */
export function structureIssues(source: Block[], target: LocalizedBlock[]): CheckHit[] {
  const hits: CheckHit[] = [];
  if (source.length !== target.length) {
    hits.push({
      block_id: null,
      problem: `Blockanzahl weicht ab (Quelle ${source.length}, Ziel ${target.length})`,
    });
  }
  source.forEach((s, i) => {
    const t = target[i];
    if (!t || t.id !== s.id) {
      hits.push({ block_id: s.id, problem: "Block fehlt oder steht an falscher Stelle" });
      return;
    }
    if (t.removed) return;
    if (t.type !== s.type) {
      hits.push({ block_id: s.id, problem: `Typ ${t.type} statt ${s.type}` });
      return;
    }
    if (s.type === "heading" && t.type === "heading" && s.level !== t.level) {
      hits.push({ block_id: s.id, problem: `Überschrift H${t.level} statt H${s.level}` });
    }
    if (s.type === "table" && t.type === "table") {
      const shape = (rows: string[][]) => rows.map((r) => r.length).join(",");
      if (shape(s.rows) !== shape(t.rows))
        hits.push({ block_id: s.id, problem: "Tabellenform weicht ab" });
    }
    if (s.type === "list" && t.type === "list") {
      const shape = (items: ListItem[]): string =>
        items.map((it) => `(${it.children ? shape(it.children) : ""})`).join("");
      if (shape(s.items) !== shape(t.items) && t.items.length >= s.items.length) {
        hits.push({ block_id: s.id, problem: "Listenstruktur weicht ab" });
      }
    }
  });
  return hits;
}

function activeBlocks(target: LocalizedBlock[]): LocalizedBlock[] {
  return target.filter((b) => !b.removed);
}

/** Verbotene Aussagen/Begriffe des Markts (case-insensitive). */
export function forbiddenClaimHits(target: LocalizedBlock[], claims: string[]): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const b of activeBlocks(target)) {
    const text = blockPlainText(b).toLowerCase();
    for (const claim of claims) {
      if (claim === "ß") continue; // eigene Prüfung (eszettHits)
      if (claim && text.includes(claim.toLowerCase())) {
        hits.push({ block_id: b.id, problem: `Verbotener Begriff „${claim}“ im Text` });
      }
    }
  }
  return hits;
}

/** Levenshtein-Distanz für den Marken-Abgleich (kurze Eingaben). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Marken-Schreibweise (deterministisch). Meldet Wörter, die der Marke sehr ähnlich,
 * aber nicht gleich sind. Groß-/Kleinschreibung, Leer-/Bindestrich-Varianten und
 * Beugungsformen (Marke + Endung) gelten als korrekt.
 */
export function brandIssues(target: LocalizedBlock[], brand: string): CheckHit[] {
  const trimmed = brand.trim();
  const norm = trimmed.toLowerCase().replace(/[\s-]+/g, "");
  if (norm.length < 4) return [];
  const threshold = norm.length >= 8 ? 2 : 1;
  const hits: CheckHit[] = [];
  const seen = new Set<string>();
  for (const b of activeBlocks(target)) {
    const tokens = blockPlainText(b).match(/[A-Za-zÀ-ž]+/g) ?? [];
    for (const token of tokens) {
      const t = token.toLowerCase();
      if (t === norm || t.startsWith(norm) || seen.has(t)) continue;
      const dist = levenshtein(t, norm);
      if (dist >= 1 && dist <= threshold) {
        seen.add(t);
        hits.push({
          block_id: b.id,
          problem: `Marke möglicherweise falsch geschrieben: „${token}“ (erwartet „${trimmed}“)`,
        });
      }
    }
  }
  return hits;
}

/** Restbestand: steht der DE-Verweis eines Findings noch im Zieltext? */
export function residualFindingHits(findings: Finding[], target: LocalizedBlock[]): CheckHit[] {
  const byId = new Map(target.map((b) => [b.id, b]));
  const hits: CheckHit[] = [];
  for (const f of findings) {
    const ref = f.de_reference.replace(/\*+/g, "").trim();
    if (ref.length < 3) continue;
    const refLower = ref.toLowerCase();
    if (f.decision === "ersetzen" && f.target_equivalent?.toLowerCase().includes(refLower))
      continue;
    const scope = f.block_ids.length
      ? f.block_ids.map((id) => byId.get(id)).filter((b): b is LocalizedBlock => Boolean(b))
      : target;
    for (const b of activeBlocks(scope)) {
      if (blockPlainText(b).replace(/\*+/g, "").toLowerCase().includes(refLower)) {
        hits.push({
          block_id: b.id,
          problem: `DE-Verweis „${ref}“ (${f.decision}) steht noch im Text`,
        });
      }
    }
  }
  return hits;
}

/** Schweizer Hochdeutsch: kein „ß“. */
export function eszettHits(target: LocalizedBlock[]): CheckHit[] {
  return activeBlocks(target)
    .filter((b) => /[ßẞ]/.test(blockPlainText(b)))
    .map((b) => ({ block_id: b.id, problem: "„ß“ im Text (Schweiz: „ss“ verwenden)" }));
}

function replaceEszettText(s: string): string {
  return s.replace(/ß/g, "ss").replace(/ẞ/g, "SS");
}

function replaceEszettItems(items: ListItem[]): ListItem[] {
  return items.map((i) => ({
    ...i,
    text: replaceEszettText(i.text),
    ...(i.children ? { children: replaceEszettItems(i.children) } : {}),
  }));
}

/** Deterministische Korrektur ß → ss (CH-de). */
export function replaceEszett(b: LocalizedBlock): LocalizedBlock {
  switch (b.type) {
    case "list":
      return { ...b, items: replaceEszettItems(b.items) };
    case "table":
      return { ...b, rows: b.rows.map((r) => r.map(replaceEszettText)) };
    default:
      return { ...b, text: replaceEszettText(b.text) };
  }
}

/** Alle deterministischen Prüfungen von Schritt 4. */
export function deterministicChecks(
  source: Block[],
  target: LocalizedBlock[],
  findings: Finding[],
  market: MarketProfile,
): CheckHit[] {
  return [
    ...structureIssues(source, target),
    ...forbiddenClaimHits(target, market.forbidden_claims),
    ...(market.brand ? brandIssues(target, market.brand) : []),
    ...residualFindingHits(findings, target),
    ...(forbidsEszett(market) ? eszettHits(target) : []),
  ];
}

export { isGermanTarget };
