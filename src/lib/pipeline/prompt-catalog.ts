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
  target_block: "Lokalisierter Block (JSON), in den der Link gesetzt wird",
  source_block: "Zugehöriger deutscher Quellblock (JSON) mit dem ursprünglichen Link",
  anchor_de: "Ankertext des Links in der deutschen Quelle",
  target_url: "hreflang-URL für das Zielland (wird exakt so verlinkt)",
  QUELL_URL: "URL der deutschen Quelle",
  ORIGINAL: "Deutsches Original als Blockliste (eine JSON-Zeile pro Block)",
  EXPORT: "Lokalisierter Export als Markdown (Zieltext)",
  ZIELSPRACHE: "Zielsprache des Markts (ggf. mit Sprachvariante)",
  ZIELMARKT: "Zielland des Markts",
  AUSNAHMEN: "Technisch entfernte Quellbereiche, die nicht geprüft werden",
  FINDINGS: "Funde aus Schritt 2 als JSON (Kontext für die Verbesserungsanalyse)",
  REMOVED_BLOCK_IDS: "IDs bewusst gestrichener Blöcke (Produktvorschläge/Tools) – kein Befund",
  CHECK_BRIEFING: "Markdown-Briefing des Lokalisierungs-Checks (Schritt 7), auf dem Schritt 8 aufbaut",
  EXTERNAL_SOURCES: "Externe Quellen im Original als JSON (Block-ID, Ankertext, URL) – nur dort sind Quelle-Hinweise erlaubt",
};

/** Alle `{{platzhalter}}` in einem Prompt-Text (gleiche Syntax wie renderTemplate). */
export function placeholdersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) out.add(m[1]!);
  return [...out];
}
