import type { JobContext } from "./types";

/**
 * Lineare Abhängigkeiten: Schritt n braucht das Ergebnis von Schritt n−1.
 * Rückgabe = Klartextgrund, sonst null.
 */
export function dependencyBlocker(stepKey: string, ctx: JobContext): string | null {
  const hasSource = Boolean(ctx.source?.blocks?.length);
  switch (stepKey) {
    case "extract":
      return null;
    case "scan":
      return hasSource ? null : "Schritt 1 (Quelle extrahieren) muss zuerst erfolgreich laufen.";
    case "localize":
      if (!hasSource) return "Schritt 1 (Quelle extrahieren) muss zuerst erfolgreich laufen.";
      return Array.isArray(ctx.findings)
        ? null
        : "Schritt 2 (DE-Bezüge finden) muss zuerst erfolgreich laufen.";
    case "review":
      if (!hasSource) return "Schritt 1 (Quelle extrahieren) muss zuerst erfolgreich laufen.";
      if (!Array.isArray(ctx.findings))
        return "Schritt 2 (DE-Bezüge finden) muss zuerst erfolgreich laufen.";
      return ctx.localized?.blocks?.length
        ? null
        : "Schritt 3 (Lokalisieren) muss zuerst erfolgreich laufen.";
    case "links":
      if (!hasSource) return "Schritt 1 (Quelle extrahieren) muss zuerst erfolgreich laufen.";
      if (!Array.isArray(ctx.findings))
        return "Schritt 2 (DE-Bezüge finden) muss zuerst erfolgreich laufen.";
      if (!ctx.localized?.blocks?.length)
        return "Schritt 3 (Lokalisieren) muss zuerst erfolgreich laufen.";
      return ctx.review && typeof ctx.exportMarkdown === "string"
        ? null
        : "Schritt 4 (Prüfen & Export) muss zuerst erfolgreich laufen.";
    case "semantic_links":
      if (!hasSource) return "Schritt 1 (Quelle extrahieren) muss zuerst erfolgreich laufen.";
      if (!Array.isArray(ctx.findings))
        return "Schritt 2 (DE-Bezüge finden) muss zuerst erfolgreich laufen.";
      if (!ctx.localized?.blocks?.length)
        return "Schritt 3 (Lokalisieren) muss zuerst erfolgreich laufen.";
      return ctx.review && typeof ctx.exportMarkdown === "string"
        ? null
        : "Schritt 4 (Prüfen & Export) muss zuerst erfolgreich laufen.";
    case "check":
      if (!hasSource) return "Schritt 1 (Quelle extrahieren) muss zuerst erfolgreich laufen.";
      if (!Array.isArray(ctx.findings))
        return "Schritt 2 (DE-Bezüge finden) muss zuerst erfolgreich laufen.";
      if (!ctx.localized?.blocks?.length)
        return "Schritt 3 (Lokalisieren) muss zuerst erfolgreich laufen.";
      return ctx.review && typeof ctx.exportMarkdown === "string"
        ? null
        : "Schritt 4 (Prüfen & Export) muss zuerst erfolgreich laufen.";
    case "improve":
      if (!hasSource) return "Schritt 1 (Quelle extrahieren) muss zuerst erfolgreich laufen.";
      if (!Array.isArray(ctx.findings))
        return "Schritt 2 (DE-Bezüge finden) muss zuerst erfolgreich laufen.";
      if (!ctx.localized?.blocks?.length)
        return "Schritt 3 (Lokalisieren) muss zuerst erfolgreich laufen.";
      if (!(ctx.review && typeof ctx.exportMarkdown === "string"))
        return "Schritt 4 (Prüfen & Export) muss zuerst erfolgreich laufen.";
      return ctx.check
        ? null
        : "Schritt 7 (Lokalisierungs-Check) muss zuerst erfolgreich laufen.";
    default:
      return null;
  }
}
