/** Marktprofil, wie es an die Prompts und Prüfungen übergeben wird. */
export interface MarketProfile {
  country: string;
  language: string;
  language_variant: string;
  locale: string | null;
  brand: string;
  address_form: string | null;
  /** Verbindliche Zuordnung DE-Institution → Gegenstück (null = existiert nicht → neutral). */
  institutions: Record<string, string | null>;
  forbidden_claims: string[];
  localization_notes: string | null;
  closing_note: string | null;
  /** Domain des Zielmarkts (z. B. „fressnapf.at“) – für den hreflang-Abgleich in Schritt 5. */
  domain: string | null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export function normalizeInstitutions(v: unknown): Record<string, string | null> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string | null> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!k.trim()) continue;
    out[k] = typeof val === "string" && val.trim() ? val.trim() : null;
  }
  return out;
}

export function normalizeClaims(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .map((x) => x.trim());
}

export function toMarketProfile(row: Record<string, unknown>): MarketProfile {
  return {
    country: str(row["country"]),
    language: str(row["language"]),
    language_variant: str(row["language_variant"]),
    locale: nullableStr(row["locale"]),
    brand: str(row["brand"]),
    address_form: nullableStr(row["address_form"]),
    institutions: normalizeInstitutions(row["institutions"]),
    forbidden_claims: normalizeClaims(row["forbidden_claims"]),
    localization_notes: nullableStr(row["localization_notes"]),
    closing_note: nullableStr(row["closing_note"]),
    domain: nullableStr(row["domain"]),
  };
}

/** Zielsprache Deutsch (AT, CH-de)? Dann ist identischer Text kein Fehler. */
export function isGermanTarget(m: Pick<MarketProfile, "language" | "locale">): boolean {
  return /^(deutsch|german)/i.test(m.language.trim()) || /^de(-|_|$)/i.test(m.locale ?? "");
}

/**
 * Locale in Sprache + Land zerlegen: „fr-CH“ → { language: "fr", country: "ch" }.
 * Null bei fehlender oder nicht zerlegbarer Locale.
 */
export function localeParts(locale: string | null): { language: string; country: string } | null {
  if (!locale) return null;
  const m = /^\s*([a-zA-Z]{2,3})[-_]([a-zA-Z]{2})\s*$/.exec(locale.trim());
  if (!m) return null;
  return { language: m[1]!.toLowerCase(), country: m[2]!.toLowerCase() };
}

/** Schweizer Hochdeutsch: kein „ß“. */
export function forbidsEszett(
  m: Pick<MarketProfile, "language" | "locale" | "country" | "forbidden_claims">,
): boolean {
  if (/^de[-_]ch$/i.test(m.locale ?? "")) return true;
  if (/schweiz|switzerland/i.test(m.country) && isGermanTarget(m)) return true;
  return m.forbidden_claims.includes("ß");
}

/** Kompakte Form für Prompts. */
export function marketPromptProfile(m: MarketProfile): Record<string, unknown> {
  return {
    country: m.country,
    language: m.language,
    language_variant: m.language_variant || null,
    locale: m.locale,
    brand: m.brand,
    address_form: m.address_form,
    institutions: m.institutions,
    forbidden_claims: m.forbidden_claims,
    localization_notes: m.localization_notes,
  };
}
