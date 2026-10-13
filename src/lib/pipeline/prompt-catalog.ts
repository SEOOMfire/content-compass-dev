/**
 * Beschreibung der Prompt-Platzhalter der vereinfachten Pipeline (für die Admin-Prompt-Verwaltung).
 * Die Werte setzt der Code in engine.server.ts / localize.ts / review.ts ein.
 */
export const PROMPT_VARIABLE_HINTS: Record<string, string> = {
  country: "Zielland des Markts",
  language: "Zielsprache des Markts",
  language_variant: "Sprachvariante (z. B. de-CH, pl-PL)",
  brand: "Markenname im Zielmarkt",
  address_form: "Anrede (informell/formell)",
  market_profile: "Kompaktes Marktprofil als JSON",
  institutions: "Verbindliche Zuordnung DE-Institution → Gegenstück (null = neutral)",
  forbidden_claims: "Verbotene Begriffe/Aussagen des Markts",
  localization_notes: "Freitext-Lokalisierungshinweise des Markts",
  source_title: "Seitentitel der deutschen Quelle",
  source_meta_description: "Meta-Description der deutschen Quelle",
  blocks: "Zu bearbeitende Blöcke, eine JSON-Zeile pro Block",
  block_ids: "Erwartete Block-IDs dieses Aufrufs",
  outline: "Gliederung des gesamten Artikels (Kontext)",
  findings: "Funde aus Schritt 2 (ersetzen/neutral/streichen)",
  part: "Umfang des Aufrufs (ganzes Dokument oder Teil x von y)",
  include_meta: "„ja“, wenn dieser Aufruf Title/Meta/Slug liefern soll",
  correction_notes: "Fehlerliste beim gezielten Retry (sonst leer)",
  source_blocks: "Quellblöcke (Deutsch), eine JSON-Zeile pro Block",
  target_blocks: "Lokalisierte Blöcke, eine JSON-Zeile pro Block",
  removed_block_ids: "IDs gestrichener Blöcke",
  deterministic_issues: "Treffer der automatischen Code-Prüfungen",
};

/** Alle `{{platzhalter}}` in einem Prompt-Text (gleiche Syntax wie renderTemplate). */
export function placeholdersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) out.add(m[1]!);
  return [...out];
}
