import { z } from "zod";
import { FINDING_CATEGORIES, FINDING_DECISIONS } from "./types";

/** Zelle/Text: Zahlen werden als Text übernommen. */
const TextSchema = z.union([z.string(), z.number()]).transform((v) => String(v));

/** Listenpunkt: als String oder { text, children }. */
export type ListItemInput =
  string | { text?: string | number | undefined; children?: ListItemInput[] | undefined };

export const ListItemInputSchema: z.ZodType<ListItemInput> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({
      text: z.union([z.string(), z.number()]).optional(),
      children: z.array(ListItemInputSchema).optional(),
    }),
  ]),
);

export const FindingInputSchema = z.object({
  id: z.string().optional(),
  block_ids: z.array(z.string()).default([]),
  de_reference: z.string().min(1),
  category: z.enum(FINDING_CATEGORIES).catch("sonstiges"),
  decision: z.enum(FINDING_DECISIONS).catch("neutral"),
  target_equivalent: z.string().nullable().optional(),
  instruction: z.string().default(""),
});

/** Schritt 2 · localization_scan */
export const ScanOutputSchema = z.object({
  findings: z.array(FindingInputSchema).default([]),
});

export const BlockPatchSchema = z.object({
  id: z.string().min(1),
  text: TextSchema.optional(),
  items: z.array(ListItemInputSchema).optional(),
  rows: z.array(z.array(TextSchema)).optional(),
  removed: z.boolean().optional(),
});
export type BlockPatch = z.output<typeof BlockPatchSchema>;

export const MetaInputSchema = z.object({
  title: z.string().optional(),
  meta_description: z.string().optional(),
  slug: z.string().optional(),
});

/** Schritt 3 · localize_document */
export const LocalizeOutputSchema = z.object({
  meta: MetaInputSchema.nullable().optional(),
  blocks: z.array(BlockPatchSchema).default([]),
});

export const ReviewFixSchema = z.object({
  text: TextSchema.optional(),
  items: z.array(ListItemInputSchema).optional(),
  rows: z.array(z.array(TextSchema)).optional(),
});

/** Schritt 4 · localization_review */
export const ReviewOutputSchema = z.object({
  issues: z
    .array(
      z.object({
        block_id: z.string().nullable().optional(),
        problem: z.string().min(1),
        fix: ReviewFixSchema.nullable().optional(),
      }),
    )
    .default([]),
});

export class StepSchemaError extends Error {}

/** Validiert eine Schrittausgabe. Verstoß = Fehler, kein stiller Fallback. */
export function validateStepData<S extends z.ZodType>(
  stepKey: string,
  schema: S,
  data: unknown,
): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const issues = res.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new StepSchemaError(
      `Schemaverstoß in ${stepKey}: ${issues}. Erhalten: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  return res.data;
}
