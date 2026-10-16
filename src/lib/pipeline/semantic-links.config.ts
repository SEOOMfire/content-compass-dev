/**
 * Konstanten und Defaults für Schritt 6 (semantische interne Verlinkung).
 * Werte, die von der Umgebung abhängen, sind über ENV überschreibbar.
 */

/** Embedding-Modell für Ziel-Index und Suchintents (1536 Dimensionen). */
export const EMBEDDING_MODEL = process.env["OPENAI_EMBEDDING_MODEL"] || "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Decisions-Modell (Beta): per ENV überschreibbar, da sich das Beta-Modell
 * ändern kann. Default laut Plan `gpt-6-luna`.
 */
export const DECISIONS_MODEL = process.env["OPENAI_DECISIONS_MODEL"] || "gpt-6-luna";

/** Höchstens so viele Kandidaten je Keyword aus dem Index abrufen. */
export const DEFAULT_CANDIDATES = 20;
/** Mindest-Wahrscheinlichkeit, ab der ein Kandidat verlinkt wird. */
export const DEFAULT_THRESHOLD = 0.8;
/** Höchstens so viele Links werden insgesamt je Artikel gesetzt. */
export const DEFAULT_MAX_LINKS = 5;
/** Höchstens so viele Keywords liefert das Modell. */
export const DEFAULT_MAX_KEYWORDS = 10;
/** Gleichzeitige Decisions-Requests. */
export const DEFAULT_DECISIONS_CONCURRENCY = 20;
/** Ziel-Artikel (Payload) wird für den Decisions-Input auf diese Länge gekürzt. */
export const PAYLOAD_MAX_CHARS = 40_000;
