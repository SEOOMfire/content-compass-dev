import { ScanOutputSchema, validateStepData } from "./schemas";
import { blockPlainText } from "./validate";
import type { MarketProfile } from "./market";
import type { Block, Finding } from "./types";

/** Vergleichsform: Kleinbuchstaben, Umlaute ausgeschrieben, nur Buchstaben/Ziffern. */
export function foldForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsTerm(haystack: string, term: string): boolean {
  const h = ` ${foldForMatch(haystack)} `;
  const t = foldForMatch(term);
  if (!t) return false;
  return h.includes(` ${t} `) || (t.length >= 6 && h.includes(t));
}

/** Passender Eintrag aus `institutions` für einen DE-Verweis (Vorrang vor dem Modell). */
function institutionFor(
  ref: string,
  institutions: Record<string, string | null>,
): { key: string; value: string | null } | null {
  for (const [key, value] of Object.entries(institutions)) {
    if (containsTerm(ref, key) || containsTerm(key, ref)) return { key, value };
  }
  return null;
}

export interface ScanResult {
  findings: Finding[];
  /** Verworfene Einträge mit Grund (unbekannte Block-IDs usw.). */
  dropped: { de_reference: string; reason: string }[];
  /** Vom Code ergänzte Funde aus der `institutions`-Zuordnung. */
  seeded: number;
}

/**
 * Validiert und normalisiert die Scan-Antwort:
 * - unbekannte Block-IDs werden verworfen (Fund ohne gültige ID entfällt),
 * - `ersetzen`/`neutral` gelten für alle Blöcke, in denen der DE-Verweis vorkommt,
 * - `institutions` hat Vorrang (Wert → ersetzen, null → neutral),
 * - `ersetzen` ohne Gegenstück wird zu `neutral` („im Zweifel nicht erfinden“),
 * - im Text vorkommende `institutions`-Schlüssel ohne Fund werden ergänzt.
 */
export function normalizeFindings(
  raw: unknown,
  blocks: Block[],
  market: MarketProfile,
): ScanResult {
  const parsed = validateStepData("scan", ScanOutputSchema, raw);
  const ids = new Set(blocks.map((b) => b.id));
  const order = new Map(blocks.map((b, i) => [b.id, i]));
  const dropped: ScanResult["dropped"] = [];
  const findings: Finding[] = [];

  for (const f of parsed.findings) {
    const blockIds = [...new Set(f.block_ids.filter((id) => ids.has(id)))];
    if (!blockIds.length) {
      dropped.push({ de_reference: f.de_reference, reason: "keine gültige Block-ID" });
      continue;
    }
    let decision = f.decision;
    let target = f.target_equivalent?.trim() || null;
    let instruction = f.instruction.trim();
    const inst = institutionFor(f.de_reference, market.institutions);
    if (inst) {
      if (inst.value) {
        decision = decision === "streichen" ? "streichen" : "ersetzen";
        target = decision === "ersetzen" ? inst.value : null;
      } else if (decision === "ersetzen") {
        decision = "neutral";
        target = null;
      }
    }
    if (decision === "ersetzen" && !target) decision = "neutral";
    if (decision !== "ersetzen") target = null;
    if (!instruction) instruction = defaultInstruction(decision, f.de_reference, target);
    // Ersatz und Neutralisierung gelten für jedes Vorkommen des Ausdrucks im Dokument
    // (einheitliche Begriffe, vollständige Restbestandsprüfung). Streichungen bleiben
    // auf die gemeldeten Blöcke beschränkt, damit nicht mehr Blöcke entfallen dürfen.
    if (decision !== "streichen") {
      for (const b of blocks) {
        if (!blockIds.includes(b.id) && containsTerm(blockPlainText(b), f.de_reference)) {
          blockIds.push(b.id);
        }
      }
      blockIds.sort((a, b) => order.get(a)! - order.get(b)!);
    }
    findings.push({
      id: "",
      block_ids: blockIds,
      de_reference: f.de_reference.trim(),
      category: f.category,
      decision,
      target_equivalent: target,
      instruction,
    });
  }

  // Institutionen aus dem Marktprofil, die im Text stehen, aber nicht gefunden wurden.
  let seeded = 0;
  for (const [key, value] of Object.entries(market.institutions)) {
    const covered = findings.some(
      (f) => containsTerm(f.de_reference, key) || containsTerm(key, f.de_reference),
    );
    if (covered) continue;
    const hitIds = blocks.filter((b) => containsTerm(blockPlainText(b), key)).map((b) => b.id);
    if (!hitIds.length) continue;
    const decision = value ? "ersetzen" : "neutral";
    findings.push({
      id: "",
      block_ids: hitIds,
      de_reference: key,
      category: "organisation",
      decision,
      target_equivalent: value,
      instruction: defaultInstruction(decision, key, value),
    });
    seeded++;
  }

  findings.forEach((f, i) => (f.id = `f${i + 1}`));
  return { findings, dropped, seeded };
}

function defaultInstruction(
  decision: Finding["decision"],
  ref: string,
  target: string | null,
): string {
  if (decision === "ersetzen") return `„${ref}“ durch „${target}“ ersetzen.`;
  if (decision === "streichen") return `Aussage zu „${ref}“ ersatzlos streichen.`;
  return `Aussage allgemein formulieren, ohne „${ref}“ zu nennen.`;
}
