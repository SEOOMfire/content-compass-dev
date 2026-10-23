/**
 * Datenmodell der vereinfachten Lokalisierungs-Pipeline (5 Schritte).
 *
 * Grundprinzip: Der Code besitzt die Struktur (Blockliste mit stabilen IDs),
 * das Modell liefert nur den Text je Block. Markdown rendert ausschließlich der Code.
 */

export type StepKey =
  | "extract"
  | "scan"
  | "localize"
  | "review"
  | "links"
  | "semantic_links"
  | "check"
  | "sources";

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
  {
    key: "links",
    order: 5,
    label: "5 · Interner Link (hreflang)",
    promptKey: "link_integration",
    description:
      "Interne Links der Quelle auf ein hreflang-Pendant für das Zielland prüfen und den ersten Treffer genau einmal in den Text setzen.",
  },
  {
    key: "semantic_links",
    order: 6,
    label: "6 · Semantische Links",
    promptKey: "semantic_link_keywords",
    description:
      "Passende Zielseiten aus dem eigenen Index (pgvector) je Ankertext suchen und per KI bewerten. Die Vorschläge werden unten manuell übernommen.",
  },
  {
    key: "check",
    order: 7,
    label: "7 · Lokalisierungs-Check",
    promptKey: "localization_check",
    description:
      "Prüft den Zieltext gegen das Original und erstellt ein Briefing (keine Änderungen).",
  },
  {
    key: "sources",
    order: 8,
    label: "8 · EEAT-Quellen",
    description:
      "Sucht per OpenAI-Websuche automatisch nach anerkannten E-E-A-T-Quellen für den Zielmarkt.",
  },
];

export const STEP_BY_KEY: Record<string, StepDef> = Object.fromEntries(
  PIPELINE.map((s) => [s.key, s]),
);

/**
 * Inline-Markdown: nur **fett** und *kursiv*. Links der Quelle werden zu reinem Ankertext
 * (die Ziele stehen separat in `SourceDoc.links`). Einzige Ausnahme: Schritt 5 setzt
 * höchstens einen Markdown-Link `[Anker](URL)` in einen Block.
 */
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

/** Interner Link im Inhaltsbereich der Quelle (absolute URL, ohne #Fragment). */
export interface SourceLink {
  block_id: string;
  href: string;
  anchor: string;
}

export interface SourceDoc {
  url: string;
  finalUrl: string;
  httpStatus: number;
  title: string | null;
  metaDescription: string | null;
  blocks: Block[];
  wordCount: number;
  /** Interne Links in Dokumentreihenfolge. Fehlt bei Jobs, die vor Schritt 5 extrahiert wurden. */
  links?: SourceLink[];
  /** Externe Links (anderer Host) in Dokumentreihenfolge. Fehlt bei Jobs, die vor Schritt 8 extrahiert wurden. */
  externalLinks?: SourceLink[];
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

/** Ergebnis der hreflang-Prüfung eines internen Links. */
export interface LinkCheck {
  block_id: string;
  href: string;
  /** HTTP-Status der verlinkten DE-Seite (0 = nicht erreichbar). */
  status: number;
  /** Passendes hreflang-Ziel für das Zielland, sonst null. */
  target: { hreflang: string; href: string } | null;
  note?: string;
}

export interface LinkingResult {
  /** Anzahl interner Links in der Quelle. */
  candidates: number;
  checked: LinkCheck[];
  /** Gewählter Link (erster Treffer in Dokumentreihenfolge). */
  chosen: {
    block_id: string;
    source_href: string;
    anchor_de: string;
    target_href: string;
    hreflang: string;
  } | null;
  /** Link wurde in den Text übernommen. */
  inserted: boolean;
  /** Block mit eingefügtem Link (ersetzt den Block aus `localized` im Export). */
  patched_block: LocalizedBlock | null;
  /** Hinweise (z. B. kein Treffer). */
  notes: string[];
  /** Probleme, die Aufmerksamkeit brauchen (z. B. Einfügen fehlgeschlagen). */
  warnings: string[];
}

/** Ein Zielseiten-Kandidat für ein Keyword (aus dem Index + KI-Bewertung). */
export interface SemanticCandidate {
  url: string;
  title: string | null;
  similarity: number;
  probability: number | null;
}

/** Ein Ankertext-Vorschlag (Keyword) mit Suchintention und Kandidaten. */
export interface SemanticKeyword {
  block_id: string;
  keyword: string;
  intent: string;
  candidates: SemanticCandidate[];
  chosen: { url: string; title: string | null; similarity: number; probability: number } | null;
  /** Bester Kandidat erreicht die Mindestwahrscheinlichkeit (≥ THRESHOLD). */
  eligible: boolean;
  note?: string;
}

/** Ergebnis von Schritt 6 (semantische interne Verlinkung). */
export interface SemanticLinkingResult {
  keywords: SemanticKeyword[];
  /** Eingesetzte Links (Block, Ankertext, Ziel-URL). */
  inserted: { block_id: string; keyword: string; url: string }[];
  notes: string[];
  warnings: string[];
}

/** Ergebnis von Schritt 7 (Lokalisierungs-Check): Markdown-Briefing + Zähler. */
export interface CheckResult {
  markdown: string;
  /** Anzahl nummerierter Funde unter „### Blockierend“. */
  blocking: number;
  /** Anzahl nummerierter Funde unter „### Hinweise“. */
  hints: number;
  /** Original lag als Blockliste vor (kein erneuter Abruf nötig). */
  sourceFetched: boolean;
}

/** Eine gefundene Quelle (Name + URL + Begründung). */
export interface SourceSuggestion {
  name: string;
  url: string;
  /** Warum diese Quelle ausgewählt wurde. */
  reason: string;
}

/** Ergebnis von Schritt 8 (EEAT-Quellen). */
export interface SourcesResult {
  /** Gefundene E-E-A-T-Quellen für den ganzen Artikel. */
  eeat: SourceSuggestion[];
  /** Vom Nutzer ausgewählte E-E-A-T-Quell-URLs. */
  selected: string[];
  notes: string[];
  warnings: string[];
}

export interface JobContext {
  source?: SourceDoc;
  findings?: Finding[];
  localized?: LocalizedDoc;
  review?: ReviewResult;
  exportMarkdown?: string;
  linking?: LinkingResult;
  semanticLinking?: SemanticLinkingResult;
  check?: CheckResult;
  sources?: SourcesResult;
}

/**
 * Kontext-Schlüssel, die der jeweilige Schritt erzeugt (für das Zurücksetzen nachfolgender Ergebnisse).
 * `exportMarkdown` gehört zu Schritt 4; Schritt 5 rendert es aus `localized` neu (mit Link),
 * ohne `localized` zu verändern – ein Neulauf von Schritt 5 startet so immer vom Stand nach Schritt 4.
 */
export const STEP_CONTEXT_KEYS: Record<StepKey, (keyof JobContext)[]> = {
  extract: ["source"],
  scan: ["findings"],
  localize: ["localized"],
  review: ["review", "exportMarkdown"],
  links: ["linking"],
  semantic_links: ["semanticLinking"],
  check: ["check"],
  sources: ["sources"],
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
