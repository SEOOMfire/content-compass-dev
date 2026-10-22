import { addStats, blocksForPrompt, emptyStats, type CallStats, type PromptCall } from "./localize";
import type { MarketProfile } from "./market";
import type { CheckResult, JobContext } from "./types";

/**
 * Schritt 7: Lokalisierungs-Check. Vergleicht den lokalisierten Export gegen das
 * Original und erstellt ein Markdown-Briefing. Der Schritt verändert keinen Text
 * und blockiert nie – die Anzahl blockierender Funde wird nur heuristisch gezählt.
 */

export interface CheckArgs {
  sourceUrl: string;
  market: MarketProfile;
  ctx: JobContext;
  call: PromptCall;
}

export interface CheckOutcome {
  check: CheckResult;
  stats: CallStats;
}

/**
 * Feste Beschreibung der bei der Extraktion entfernten Seitenbereiche
 * (siehe NOISE_SELECTORS in extract.server.ts). Diese Inhalte dürfen im
 * Zieltext fehlen, ohne dass der Check sie als fehlend meldet.
 */
export const CHECK_EXEMPTIONS = [
  "Navigation, Kopf- und Fußbereich der Seite (nav, header, footer)",
  "Seitenleisten, Formulare und Schaltflächen (aside, form, button)",
  "Bilder, Grafiken, Videos und Audio (img, picture, svg, video, audio, iframe)",
  "Breadcrumbs (Pfadnavigation)",
  "Lesedauer/Metriken und Bildnachweise",
  "Inhaltsverzeichnis, Teilen/Speichern-Leisten",
  "Teaser, „Weitere Artikel“-Empfehlungen und Karussells",
  "Ausgeblendete Bereiche (data-nosnippet), Ein-/Ausklapp-Register und CTA-Buttons",
].join("\n- ");

/** Zählt nummerierte Zeilen („1. …“) unter einer Überschrift dritter Ebene. */
export function countNumberedItems(markdown: string, heading: string): number {
  let section = false;
  let count = 0;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      section = h[2]!.trim() === heading;
      continue;
    }
    if (section && /^\d+[.)]\s+\S/.test(line)) count += 1;
  }
  return count;
}

export async function checkLocalization(args: CheckArgs): Promise<CheckOutcome> {
  const stats = emptyStats();
  const sourceBlocks = args.ctx.source?.blocks ?? [];
  const sourceFetched = sourceBlocks.length > 0;
  const targetLanguage = args.market.language_variant
    ? `${args.market.language} (${args.market.language_variant})`
    : args.market.language;
  const exemptions = args.market.localization_notes
    ? `- ${CHECK_EXEMPTIONS}\n\nMarktspezifische Hinweise:\n${args.market.localization_notes}`
    : `- ${CHECK_EXEMPTIONS}`;

  const res = await args.call({
    QUELL_URL: args.sourceUrl,
    ORIGINAL: sourceFetched
      ? blocksForPrompt(sourceBlocks)
      : "Original nicht verfügbar (Schritt 1 lieferte keine Blöcke).",
    EXPORT: args.ctx.exportMarkdown ?? "",
    ZIELSPRACHE: targetLanguage,
    ZIELMARKT: args.market.country,
    brand: args.market.brand,
    AUSNAHMEN: exemptions,
  });
  addStats(stats, res);

  const markdown = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
  return {
    check: {
      markdown,
      blocking: countNumberedItems(markdown, "Blockierend"),
      hints: countNumberedItems(markdown, "Hinweise"),
      sourceFetched,
    },
    stats,
  };
}
