/**
 * Datenmodell der vereinfachten Lokalisierungs-Pipeline (4 Schritte).
 *
 * Grundprinzip: Der Code besitzt die Struktur (Blockliste mit stabilen IDs),
 * das Modell liefert nur den Text je Block. Markdown rendert ausschließlich der Code.
 */

export type StepKey = "extract" | "scan" | "localize" | "review";

export interface StepDef {
  key: StepKey;
  order: number;
  label: string;
  /** Prompt-Template-Key, falls der Schritt ein LLM verwendet. */
  promptKey?: string;
  description: string;
}

export const PIPELINE: StepDef[] = [
  {
    key: "extract",
    order: 1,
    label: "1 · Quelle extrahieren",
    description:
      "Deutsche Quell-URL laden und in eine typisierte Blockliste zerlegen (Überschriften, Absätze, Listen, Tabellen, Zitate).",
  },
  {
    key: "scan",
    order: 2,
    label: "2 · DE-Bezüge finden",
    promptKey: "localization_scan",
    description:
      "KI findet deutschlandspezifische Stellen (Behörden, Verbände, Gesetze, Services, Preise …) und entscheidet: ersetzen, neutral oder streichen.",
  },
  {
    key: "localize",
    order: 3,
    label: "3 · Lokalisieren",
    promptKey: "localize_document",
    description:
      "KI übersetzt Block für Block und wendet die Funde an. Der Code prüft jede Antwort und fragt fehlerhafte Blöcke gezielt erneut an.",
  },
  {
    key: "review",
    order: 4,
    label: "4 · Prüfen & Export",
    promptKey: "localization_review",
    description:
      "Code-Prüfungen plus KI-Review mit Korrekturen, danach strukturtreues Markdown rendern.",
  },
];

export const STEP_BY_KEY: Record<string, StepDef> = Object.fromEntries(
  PIPELINE.map((s) => [s.key, s]),
);

/** Inline-Markdown: nur **fett** und *kursiv*. Links werden zu reinem Ankertext. */
export type Inline = string;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface ListItem {
  text: Inline;
  /** Verschachtelte Unterliste (bleibt erhalten). */
  children?: ListItem[];
  /** Unterliste nummeriert? Fehlt = Aufzählung. */
  childrenOrdered?: boolean;
}

export type Block =
  | { id: string; type: "heading"; level: HeadingLevel; text: Inline }
  | { id: string; type: "paragraph"; text: Inline }
  | { id: string; type: "list"; ordered: boolean; items: ListItem[] }
  | { id: string; type: "table"; hasHeader: boolean; rows: Inline[][] }
  | { id: string; type: "quote"; text: Inline };

export type BlockType = Block["type"];

/** Lokalisierter Block: gleiche ID, gleicher Typ, neuer Inhalt; ggf. gestrichen. */
export type LocalizedBlock = Block & { removed?: boolean };

export const FINDING_CATEGORIES = [
  "behoerde",
  "gesetz",
  "organisation",
  "service",
  "zahl_einheit",
  "waehrung",
  "angebot",
  "quelle",
  "sonstiges",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_DECISIONS = ["ersetzen", "neutral", "streichen"] as const;
export type FindingDecision = (typeof FINDING_DECISIONS)[number];

export interface Finding {
  id: string;
  block_ids: string[];
  de_reference: string;
  category: FindingCategory;
  decision: FindingDecision;
  target_equivalent: string | null;
  instruction: string;
}

export interface SourceDoc {
  url: string;
  finalUrl: string;
  httpStatus: number;
  title: string | null;
  metaDescription: string | null;
  blocks: Block[];
  wordCount: number;
}

export interface LocalizedMeta {
  title: string;
  meta_description: string;
  slug: string;
}

export interface LocalizedDoc {
  meta: LocalizedMeta;
  blocks: LocalizedBlock[];
}

export type ReviewIssueStatus = "applied" | "rejected" | "open" | "resolved";

export interface ReviewIssue {
  block_id: string | null;
  origin: "code" | "llm";
  problem: string;
  status: ReviewIssueStatus;
  note?: string;
}

export interface ReviewResult {
  issues: ReviewIssue[];
  /** IDs der Blöcke, an denen eine Korrektur übernommen wurde. */
  applied: string[];
  /** Offene Warnungen (abgelehnte/fehlende Korrekturen, verbleibende Code-Treffer). */
  warnings: string[];
}

export interface JobContext {
  source?: SourceDoc;
  findings?: Finding[];
  localized?: LocalizedDoc;
  review?: ReviewResult;
  exportMarkdown?: string;
}

/** Kontext-Schlüssel, die der jeweilige Schritt erzeugt (für das Zurücksetzen nachfolgender Ergebnisse). */
export const STEP_CONTEXT_KEYS: Record<StepKey, (keyof JobContext)[]> = {
  extract: ["source"],
  scan: ["findings"],
  localize: ["localized"],
  review: ["review", "exportMarkdown"],
};

/**
 * Altjob = Kontext aus der früheren 16-Schritt-Pipeline (ohne Blockliste).
 * Ein vorhandenes `exportMarkdown` bleibt anzeigbar.
 */
export function isLegacyContext(ctx: unknown): boolean {
  if (!ctx || typeof ctx !== "object") return false;
  const c = ctx as Record<string, unknown>;
  if (!Object.keys(c).length) return false;
  const source = c["source"] as { blocks?: unknown } | undefined;
  return !Array.isArray(source?.blocks);
}
