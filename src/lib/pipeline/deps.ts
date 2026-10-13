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
    default:
      return null;
  }
}
