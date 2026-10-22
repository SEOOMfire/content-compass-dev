import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PIPELINE,
  STEP_BY_KEY,
  STEP_CONTEXT_KEYS,
  type Block,
  type ImprovementResult,
  type JobContext,
  type LinkingResult,
  type LocalizedBlock,
  type SemanticLinkingResult,
  type StepKey,
} from "./types";
import { extractSource, fetchHtml } from "./extract.server";
import { linkDocument } from "./links";
import { applyLinkingPatch, applySemanticLinks, semanticLinkDocument, type MatchPage } from "./semantic-links";
import { embedTexts } from "./embeddings.server";
import { decidePredicate } from "./decisions.server";
import { renderMarkdown } from "./render";
import {
  runPrompt,
  startVarRecording,
  collectRecordedVars,
  type PromptTemplateRow,
} from "./ai.server";
import { dependencyBlocker } from "./deps";
import { isGermanTarget, marketPromptProfile, toMarketProfile, type MarketProfile } from "./market";
import { normalizeFindings } from "./scan";
import {
  blocksForPrompt,
  LocalizeError,
  localizeDocument,
  outlineOf,
  type PromptCall,
} from "./localize";
import { reviewDocument } from "./review";
import { checkLocalization } from "./check";
import { proposeImprovements } from "./improve";
import { validateBlockPatch, type BlockContent } from "./validate";

export { dependencyBlocker };

/** Pause zwischen zwei Seitenabrufen in Schritt 5 (schont die Quellseite). */
const LINK_FETCH_DELAY_MS = 250;

type MarketRow = Record<string, unknown> & {
  id: string;
  country: string;
  language: string;
  locale: string | null;
  domain: string;
  brand: string | null;
  language_variant: string | null;
  address_form: string | null;
  closing_note: string | null;
  forbidden_claims: unknown;
  institutions: unknown;
  localization_notes?: string | null;
};

async function loadTemplate(stepKey: string): Promise<PromptTemplateRow> {
  const { data, error } = await supabaseAdmin
    .from("prompt_templates")
    .select("*")
    .eq("step_key", stepKey)
    .maybeSingle();
  if (error || !data) throw new Error(`Prompt-Template "${stepKey}" nicht gefunden.`);
  return data as unknown as PromptTemplateRow;
}

/** LLM-Aufruf eines Templates als injizierbare Funktion (testbar über Mocks). */
function promptCall(tpl: PromptTemplateRow): PromptCall {
  return async (vars) => {
    const res = await runPrompt<unknown>(tpl, vars);
    return {
      data: res.data,
      model: res.model,
      promptSnapshot: res.promptSnapshot,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
    };
  };
}

export interface StepRunResult {
  output: unknown;
  context: Partial<JobContext>;
  model?: string;
  promptSnapshot?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Zusätzliche Spalten, die am Job selbst gesetzt werden (z. B. Zähler). */
  jobPatch?: Record<string, unknown>;
}

/** Schrittfehler mit auswertbarer Ausgabe (z. B. Liste fehlerhafter Block-IDs). */
class PipelineQualityError extends Error {
  constructor(
    message: string,
    readonly output: unknown,
    readonly stats: {
      model?: string;
      promptSnapshot?: string;
      tokensIn?: number;
      tokensOut?: number;
    } = {},
  ) {
    super(message);
  }
}

function countTypes(blocks: Block[]): Record<string, number> {
  return blocks.reduce<Record<string, number>>((acc, b) => {
    const key = b.type === "heading" ? `h${b.level}` : b.type;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function requireSource(ctx: JobContext) {
  if (!ctx.source?.blocks?.length)
    throw new Error("Schritt 1 (Quelle extrahieren) muss zuerst laufen.");
  return ctx.source;
}

export async function runStep(
  stepKey: string,
  job: { id: string; source_url: string; context: JobContext },
  market: MarketProfile,
): Promise<StepRunResult> {
  const ctx = job.context ?? {};

  switch (stepKey) {
    case "extract": {
      const doc = await extractSource(job.source_url);
      if (doc.httpStatus !== 200) {
        throw new Error(
          doc.httpStatus === 0
            ? "Quelle nicht erreichbar (Netzwerkfehler oder ungültige URL)."
            : `Quelle antwortete mit HTTP ${doc.httpStatus}.`,
        );
      }
      if (!doc.blocks.length) {
        throw new Error("Auf der Quellseite wurde kein Inhalt gefunden (0 Blöcke).");
      }
      return {
        output: {
          url: doc.url,
          finalUrl: doc.finalUrl,
          httpStatus: doc.httpStatus,
          title: doc.title,
          metaDescription: doc.metaDescription,
          block_count: doc.blocks.length,
          word_count: doc.wordCount,
          types: countTypes(doc.blocks),
          blocks: doc.blocks,
        },
        context: { source: doc },
      };
    }

    case "scan": {
      const source = requireSource(ctx);
      const tpl = await loadTemplate("localization_scan");
      const res = await runPrompt<unknown>(tpl, {
        country: market.country,
        language: market.language,
        language_variant: market.language_variant,
        brand: market.brand,
        address_form: market.address_form ?? "",
        market_profile: marketPromptProfile(market),
        institutions: market.institutions,
        forbidden_claims: market.forbidden_claims,
        localization_notes: market.localization_notes ?? "",
        source_title: source.title ?? "",
        source_meta_description: source.metaDescription ?? "",
        blocks: blocksForPrompt(source.blocks),
      });
      const result = normalizeFindings(res.data, source.blocks, market);
      return {
        output: result,
        context: { findings: result.findings },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
      };
    }

    case "localize": {
      const source = requireSource(ctx);
      const tpl = await loadTemplate("localize_document");
      try {
        const res = await localizeDocument({
          blocks: source.blocks,
          findings: ctx.findings ?? [],
          market,
          sourceMeta: { title: source.title, metaDescription: source.metaDescription },
          call: promptCall(tpl),
        });
        return {
          output: {
            meta: res.localized.meta,
            chunks: res.chunks,
            calls: res.stats.calls,
            blocks: res.localized.blocks.length,
            removed: res.localized.blocks.filter((b) => b.removed).map((b) => b.id),
            retried: res.retried,
          },
          context: { localized: res.localized },
          ...(res.stats.model ? { model: res.stats.model } : {}),
          ...(res.stats.promptSnapshot ? { promptSnapshot: res.stats.promptSnapshot } : {}),
          tokensIn: res.stats.tokensIn,
          tokensOut: res.stats.tokensOut,
        };
      } catch (err) {
        if (err instanceof LocalizeError) {
          throw new PipelineQualityError(
            err.message,
            { failed: err.failed, localized_ok: err.partial.length, calls: err.stats.calls },
            {
              ...(err.stats.model ? { model: err.stats.model } : {}),
              ...(err.stats.promptSnapshot ? { promptSnapshot: err.stats.promptSnapshot } : {}),
              tokensIn: err.stats.tokensIn,
              tokensOut: err.stats.tokensOut,
            },
          );
        }
        throw err;
      }
    }

    case "review": {
      const source = requireSource(ctx);
      if (!ctx.localized) throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
      const tpl = await loadTemplate("localization_review");
      const res = await reviewDocument({
        source: source.blocks,
        localized: ctx.localized,
        findings: ctx.findings ?? [],
        market,
        call: promptCall(tpl),
      });
      return {
        output: { ...res.review, export_length: res.exportMarkdown.length },
        context: {
          localized: res.localized,
          review: res.review,
          exportMarkdown: res.exportMarkdown,
        },
        ...(res.stats.model ? { model: res.stats.model } : {}),
        ...(res.stats.promptSnapshot ? { promptSnapshot: res.stats.promptSnapshot } : {}),
        tokensIn: res.stats.tokensIn,
        tokensOut: res.stats.tokensOut,
      };
    }

    case "links": {
      const source = requireSource(ctx);
      if (!ctx.localized) throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
      // Fehlt die Vorlage, wird das als Warnung geführt – der Export bleibt dann ohne Link.
      let call: PromptCall;
      try {
        call = promptCall(await loadTemplate("link_integration"));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Prompt-Template fehlt";
        call = async () => {
          throw new Error(`${message} (Migration 0012 ausführen)`);
        };
      }
      const res = await linkDocument({
        source,
        localized: ctx.localized,
        market,
        fetchPage: fetchHtml,
        call,
        delayMs: LINK_FETCH_DELAY_MS,
      });
      const exportMarkdown = renderMarkdown(res.blocks, ctx.localized.meta, {
        closing_note: market.closing_note,
      });
      return {
        output: { ...res.linking, export_length: exportMarkdown.length },
        context: { linking: res.linking, exportMarkdown },
        ...(res.stats.model ? { model: res.stats.model } : {}),
        ...(res.stats.promptSnapshot ? { promptSnapshot: res.stats.promptSnapshot } : {}),
        tokensIn: res.stats.tokensIn,
        tokensOut: res.stats.tokensOut,
      };
    }

    case "semantic_links": {
      requireSource(ctx);
      if (!ctx.localized) throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
      // Fehlt die Vorlage, wird das als Warnung geführt – der Export bleibt dann ohne Zusatz-Links.
      let call: PromptCall;
      try {
        call = promptCall(await loadTemplate("semantic_link_keywords"));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Prompt-Template fehlt";
        call = async () => {
          throw new Error(`${message} (Migration 0013 ausführen)`);
        };
      }
      const matchPages = async (args: {
        embedding: number[];
        country: string;
        language: string;
        excludeUrls: string[];
        limit: number;
      }): Promise<MatchPage[]> => {
        // `.rpc` muss als Methode aufgerufen werden (this-Kontext erhalten).
        const admin = supabaseAdmin as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
        const { data, error } = await admin.rpc("match_content_pages", {
          query_embedding: `[${args.embedding.join(",")}]`,
          p_country: args.country,
          p_language: args.language,
          p_match_count: args.limit,
          p_content_types: ["ratgeber"],
          p_exclude_urls: args.excludeUrls,
        });
        if (error) throw new Error(error.message);
        return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          url: String(r["url"] ?? ""),
          title: typeof r["title"] === "string" ? r["title"] : null,
          content_payload: String(r["content_payload"] ?? ""),
          similarity: Number(r["similarity"] ?? 0),
        }));
      };
      const res = await semanticLinkDocument({
        localized: ctx.localized,
        ...(ctx.linking ? { linking: ctx.linking } : {}),
        market,
        call,
        matchPages,
        embed: (texts) => embedTexts(texts),
        decide: (args) => decidePredicate({ input: args.payload, instructions: args.instructions }),
      });
      const exportMarkdown = renderMarkdown(res.blocks, ctx.localized.meta, {
        closing_note: market.closing_note,
      });
      return {
        output: { ...res.semanticLinking, export_length: exportMarkdown.length },
        context: { semanticLinking: res.semanticLinking, exportMarkdown },
        jobPatch: {
          semantic_links_pending: res.semanticLinking.keywords.filter((k) => k.eligible).length,
        },
        ...(res.stats.model ? { model: res.stats.model } : {}),
        ...(res.stats.promptSnapshot ? { promptSnapshot: res.stats.promptSnapshot } : {}),
        tokensIn: res.stats.tokensIn,
        tokensOut: res.stats.tokensOut,
      };
    }

    case "check": {
      requireSource(ctx);
      if (!ctx.localized) throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
      if (typeof ctx.exportMarkdown !== "string")
        throw new Error("Schritt 4 (Prüfen & Export) muss zuerst laufen.");
      const tpl = await loadTemplate("localization_check");
      const res = await checkLocalization({
        sourceUrl: job.source_url,
        market,
        ctx,
        call: promptCall(tpl),
      });
      return {
        output: res.check,
        context: { check: res.check },
        ...(res.stats.model ? { model: res.stats.model } : {}),
        ...(res.stats.promptSnapshot ? { promptSnapshot: res.stats.promptSnapshot } : {}),
        tokensIn: res.stats.tokensIn,
        tokensOut: res.stats.tokensOut,
      };
    }

    case "improve": {
      requireSource(ctx);
      if (!ctx.localized) throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
      if (typeof ctx.exportMarkdown !== "string")
        throw new Error("Schritt 4 (Prüfen & Export) muss zuerst laufen.");
      const tpl = await loadTemplate("improvement_proposals");
      const res = await proposeImprovements({
        sourceUrl: job.source_url,
        market,
        ctx,
        call: promptCall(tpl),
      });
      return {
        output: res.improve,
        context: { improve: res.improve },
        ...(res.stats.model ? { model: res.stats.model } : {}),
        ...(res.stats.promptSnapshot ? { promptSnapshot: res.stats.promptSnapshot } : {}),
        tokensIn: res.stats.tokensIn,
        tokensOut: res.stats.tokensOut,
      };
    }

    default:
      throw new Error(`Unbekannter Schritt: ${stepKey}`);
  }
}

/** Schritte ab (inkl.) `stepKey` – deren Kontextergebnisse werden beim Neulauf ungültig. */
function stepsFrom(stepKey: StepKey): StepKey[] {
  const idx = PIPELINE.findIndex((s) => s.key === stepKey);
  return PIPELINE.slice(Math.max(idx, 0)).map((s) => s.key);
}

/**
 * Kontext für einen Lauf von `stepKey`: Ergebnisse dieses und aller späteren
 * Schritte entfallen. Bei `extract` wird der Kontext komplett neu aufgebaut
 * (auch Altjobs der früheren Pipeline).
 */
function contextBefore(context: JobContext, stepKey: StepKey): JobContext {
  if (stepKey === "extract") return {};
  const drop = new Set(stepsFrom(stepKey).flatMap((k) => STEP_CONTEXT_KEYS[k]));
  const out: JobContext = {};
  for (const def of PIPELINE) {
    for (const key of STEP_CONTEXT_KEYS[def.key]) {
      if (!drop.has(key) && context[key] !== undefined) {
        (out as Record<string, unknown>)[key] = context[key];
      }
    }
  }
  return out;
}

/** Spätere Schritte auf „pending“ setzen, weil ihre Grundlage neu berechnet wurde. */
async function resetLaterSteps(jobId: string, stepKey: StepKey) {
  const later = stepsFrom(stepKey).filter((k) => k !== stepKey);
  if (!later.length) return;
  await supabaseAdmin
    .from("job_steps")
    .update({ status: "pending", error: null, updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .in("step_key", later);
}

/** Führt einen Schritt aus, persistiert Status/Kontext idempotent. */
export async function executeStep(jobId: string, stepKey: string) {
  const def = STEP_BY_KEY[stepKey];
  if (!def) throw new Error(`Unbekannter Schritt: ${stepKey}`);

  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*, markets(*)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");
  const marketRow = (job as unknown as { markets: MarketRow }).markets;
  const market = toMarketProfile(marketRow);
  const context = ((job as { context?: JobContext }).context ?? {}) as JobContext;

  const blocker = dependencyBlocker(def.key, context);
  if (blocker) {
    await upsertStep(jobId, def.key, def.order, {
      status: "blocked",
      error: blocker,
      output: null,
    });
    await syncJobStatus(jobId, context);
    return { ok: false as const, error: blocker, blocked: true as const };
  }

  const started = Date.now();
  await upsertStep(jobId, def.key, def.order, {
    status: "running",
    error: null,
    input: describeStepInput(def.key, context, market, job.source_url) as never,
  });
  await supabaseAdmin
    .from("jobs")
    .update({ current_step: def.key, status: "running" })
    .eq("id", jobId);

  startVarRecording();
  try {
    const result = await runStep(
      def.key,
      { id: jobId, source_url: job.source_url, context },
      market,
    );
    const recordedVars = collectRecordedVars();
    const nextContext: JobContext = { ...contextBefore(context, def.key), ...result.context };
    await supabaseAdmin
      .from("jobs")
      .update({
        context: nextContext as never,
        current_step: def.key,
        updated_at: new Date().toISOString(),
        ...(result.jobPatch ?? {}),
      })
      .eq("id", jobId);
    await upsertStep(jobId, def.key, def.order, {
      status: "done",
      output: (result.output ?? null) as never,
      error: null,
      duration_ms: Date.now() - started,
      tokens_in: result.tokensIn ?? 0,
      tokens_out: result.tokensOut ?? 0,
      ...(result.model ? { model: result.model } : {}),
      ...(result.promptSnapshot ? { prompt_snapshot: result.promptSnapshot } : {}),
      prompt_vars: (recordedVars.length ? recordedVars : null) as never,
    });
    await resetLaterSteps(jobId, def.key);
    await syncJobStatus(jobId, nextContext);
    return { ok: true as const, output: result.output };
  } catch (err) {
    const recordedVars = collectRecordedVars();
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    // Ergebnisse dieses und späterer Schritte sind ungültig (außer bei extract:
    // dort bleibt der bisherige Stand inkl. Altjob-Export erhalten).
    const failedContext = def.key === "extract" ? context : contextBefore(context, def.key);
    if (def.key !== "extract") {
      await supabaseAdmin
        .from("jobs")
        .update({ context: failedContext as never, updated_at: new Date().toISOString() })
        .eq("id", jobId);
      await resetLaterSteps(jobId, def.key);
    }
    const quality = err instanceof PipelineQualityError ? err : null;
    await upsertStep(jobId, def.key, def.order, {
      status: "error",
      error: message,
      output: (quality?.output ?? null) as never,
      duration_ms: Date.now() - started,
      ...(quality?.stats.model ? { model: quality.stats.model } : {}),
      ...(quality?.stats.promptSnapshot ? { prompt_snapshot: quality.stats.promptSnapshot } : {}),
      ...(quality
        ? { tokens_in: quality.stats.tokensIn ?? 0, tokens_out: quality.stats.tokensOut ?? 0 }
        : {}),
      prompt_vars: (recordedVars.length ? recordedVars : null) as never,
    });
    await syncJobStatus(jobId, failedContext);
    return { ok: false as const, error: message };
  }
}

/**
 * Wendet die vom Nutzer gewählten semantischen Links an und rendert den Export neu.
 * Aktualisiert Kontext (semanticLinking.inserted, exportMarkdown) und das Ergebnis von Schritt 6.
 */
export async function applySemanticLinksStep(
  jobId: string,
  selectedBlockIds: string[],
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*, markets(*)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");
  const marketRow = (job as unknown as { markets: MarketRow }).markets;
  const market = toMarketProfile(marketRow);
  const context = ((job as { context?: JobContext }).context ?? {}) as JobContext;
  if (!context.localized?.blocks?.length)
    throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
  if (!context.semanticLinking)
    throw new Error("Schritt 6 (Semantische Links) muss zuerst laufen.");

  const { blocks, inserted } = applySemanticLinks(
    context.localized,
    context.linking,
    context.semanticLinking,
    selectedBlockIds,
  );
  const exportMarkdown = renderMarkdown(blocks, context.localized.meta, {
    closing_note: market.closing_note,
  });
  const semanticLinking: SemanticLinkingResult = { ...context.semanticLinking, inserted };
  const nextContext: JobContext = { ...context, semanticLinking, exportMarkdown };

  await supabaseAdmin
    .from("jobs")
    .update({
      context: nextContext as never,
      semantic_links_pending: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  await supabaseAdmin
    .from("job_steps")
    .update({
      output: { ...semanticLinking, export_length: exportMarkdown.length } as never,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("step_key", "semantic_links");
  await syncJobStatus(jobId, nextContext);
  return { ok: true, inserted: inserted.length };
}

/**
 * Schaltet den Schritt-5-Link (interne Verlinkung) an oder ab und rendert den
 * Export neu. `patched_block` bleibt erhalten – `inserted` steuert, ob er im
 * Export erscheint. Semantische Links (Schritt 6) bleiben erhalten.
 */
export async function setLinkingInsertedStep(
  jobId: string,
  inserted: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*, markets(*)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");
  const marketRow = (job as unknown as { markets: MarketRow }).markets;
  const market = toMarketProfile(marketRow);
  const context = ((job as { context?: JobContext }).context ?? {}) as JobContext;
  if (!context.localized?.blocks?.length)
    throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
  if (!context.linking)
    throw new Error("Schritt 5 (Interne Verlinkung) muss zuerst laufen.");
  if (inserted && !context.linking.patched_block)
    throw new Error("Kein eingefügter Link vorhanden – Schritt 5 erneut ausführen.");

  const linking: LinkingResult = { ...context.linking, inserted };
  const finalBlocks = context.semanticLinking
    ? applySemanticLinks(
        context.localized,
        linking,
        context.semanticLinking,
        context.semanticLinking.inserted.map((i) => i.block_id),
      ).blocks
    : applyLinkingPatch(context.localized, linking);
  const exportMarkdown = renderMarkdown(finalBlocks, context.localized.meta, {
    closing_note: market.closing_note,
  });
  const nextContext: JobContext = { ...context, linking, exportMarkdown };

  await supabaseAdmin
    .from("jobs")
    .update({ context: nextContext as never, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  await supabaseAdmin
    .from("job_steps")
    .update({
      output: { ...linking, export_length: exportMarkdown.length } as never,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("step_key", "links");
  await syncJobStatus(jobId, nextContext);
  return { ok: true };
}

/**
 * Wendet die vom Nutzer bestätigten Verbesserungsvorschläge an und rendert den
 * Export neu. Reine Hinweise (ohne patch) werden nur als bestätigt markiert –
 * außer der Nutzer hat eine eigene Quelle/eigenen Text mitgegeben, die/der dann
 * an den Block angehängt wird. Bereits übernommene Links (Schritt 5 + 6) bleiben erhalten.
 */
export async function applyImprovementsStep(
  jobId: string,
  selectedProposalIds: string[],
  userTexts: Record<string, string> = {},
): Promise<{ ok: boolean; applied: number; patched: number; error?: string }> {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*, markets(*)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");
  const marketRow = (job as unknown as { markets: MarketRow }).markets;
  const market = toMarketProfile(marketRow);
  const context = ((job as { context?: JobContext }).context ?? {}) as JobContext;
  if (!context.localized?.blocks?.length)
    throw new Error("Schritt 3 (Lokalisieren) muss zuerst laufen.");
  if (!context.improve)
    throw new Error("Schritt 8 (Verbesserungen & Quellen) muss zuerst laufen.");

  const selected = new Set(selectedProposalIds);
  const sourceById = new Map((context.source?.blocks ?? []).map((b) => [b.id, b]));
  const sameLanguage = isGermanTarget(market);
  const blocks: LocalizedBlock[] = context.localized.blocks.map((b) => ({ ...b }));
  const appliedIds: string[] = [];
  const warnings: string[] = [];
  let patched = 0;

  for (const p of context.improve.proposals) {
    if (!selected.has(p.id)) continue;
    appliedIds.push(p.id);

    const userText = (userTexts[p.id] ?? "").trim();

    if (p.block_id && p.patch) {
      const idx = blocks.findIndex((b) => b.id === p.block_id);
      const src = sourceById.get(p.block_id);
      if (idx < 0 || !src || blocks[idx]!.removed) continue;
      const type = blocks[idx]!.type;
      let patch = p.patch as BlockContent;
      // Nutzer hat den Vorschlag bearbeitet (nur bei Text-Blöcken möglich).
      if (userText && (type === "paragraph" || type === "quote" || type === "heading")) {
        patch = { text: userText };
      }
      const v = validateBlockPatch(src, patch, { removable: false, sameLanguage });
      if (v.ok) {
        blocks[idx] = v.block;
        patched += 1;
      } else {
        warnings.push(`${p.title}: ${v.errors.join("; ")}`);
      }
      continue;
    }

    if (p.block_id && userText) {
      const idx = blocks.findIndex((b) => b.id === p.block_id);
      const src = sourceById.get(p.block_id);
      const target = idx < 0 ? undefined : blocks[idx];
      if (!src || !target || target.removed) continue;
      if (target.type === "paragraph" || target.type === "quote") {
        const v = validateBlockPatch(
          src,
          { text: `${target.text} Quelle: ${userText}` },
          { removable: false, sameLanguage },
        );
        if (v.ok) {
          blocks[idx] = v.block;
          patched += 1;
        } else {
          warnings.push(`${p.title}: ${v.errors.join("; ")}`);
        }
      } else {
        warnings.push(
          `${p.title}: Blocktyp „${target.type}“ unterstützt kein automatisches Anhängen einer Quelle.`,
        );
      }
    }
  }

  const improvedLocalized = { meta: context.localized.meta, blocks };
  const finalBlocks = context.semanticLinking
    ? applySemanticLinks(
        improvedLocalized,
        context.linking,
        context.semanticLinking,
        context.semanticLinking.inserted.map((i) => i.block_id),
      ).blocks
    : applyLinkingPatch(improvedLocalized, context.linking);
  const exportMarkdown = renderMarkdown(finalBlocks, improvedLocalized.meta, {
    closing_note: market.closing_note,
  });
  const improve: ImprovementResult = { ...context.improve, applied: appliedIds, warnings };
  const nextContext: JobContext = {
    ...context,
    localized: improvedLocalized,
    improve,
    exportMarkdown,
  };

  await supabaseAdmin
    .from("jobs")
    .update({ context: nextContext as never, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  await supabaseAdmin
    .from("job_steps")
    .update({ output: improve as never, updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("step_key", "improve");
  await syncJobStatus(jobId, nextContext);
  return { ok: true, applied: appliedIds.length, patched };
}

/**
 * Job-Status aus den Schritten der aktuellen Pipeline (Altschritte werden ignoriert):
 * `done` bei vollständigem Lauf, `done_with_errors`/`error` nur bei einem echten
 * Abbruch (Schritt `error` oder `blocked`). Weiche Warnungen (z. B. blockierende
 * Check-Funde, Review-Hinweise) ändern den Status nicht – sie stehen im Schritt selbst.
 */
async function syncJobStatus(jobId: string, ctx: JobContext) {
  const { data: steps } = await supabaseAdmin
    .from("job_steps")
    .select("step_key,status")
    .eq("job_id", jobId);
  const rows = ((steps ?? []) as Array<{ step_key: string; status: string }>).filter(
    (s) => STEP_BY_KEY[s.step_key],
  );
  const problems = rows.filter((s) => s.status === "error" || s.status === "blocked").length;
  const lastStep = PIPELINE[PIPELINE.length - 1]!.key;
  const finished = rows.find((s) => s.step_key === lastStep)?.status === "done";
  const status = finished
    ? problems
      ? "done_with_errors"
      : "done"
    : problems
      ? "error"
      : "idle";
  await supabaseAdmin
    .from("jobs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function upsertStep(
  jobId: string,
  stepKey: string,
  order: number,
  patch: Record<string, unknown>,
) {
  const { data: existing } = await supabaseAdmin
    .from("job_steps")
    .select("id,run_count")
    .eq("job_id", jobId)
    .eq("step_key", stepKey)
    .maybeSingle();
  const counts = patch["status"] === "running";
  if (existing) {
    await supabaseAdmin
      .from("job_steps")
      .update({
        ...patch,
        step_order: order,
        updated_at: new Date().toISOString(),
        run_count: counts ? (existing.run_count ?? 0) + 1 : existing.run_count,
      } as never)
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("job_steps").insert({
      job_id: jobId,
      step_key: stepKey,
      step_order: order,
      run_count: counts ? 1 : 0,
      ...patch,
    } as never);
  }
}

/**
 * Kompakter Snapshot dessen, was ein Schritt als Eingabe erhalten hat.
 * NUR für die Anzeige – der Modell-Payload wird in runStep ungekürzt gebaut.
 */
function describeStepInput(
  stepKey: string,
  ctx: JobContext,
  market: MarketProfile,
  sourceUrl: string,
): Record<string, unknown> {
  const marketInfo = marketPromptProfile(market);
  switch (stepKey) {
    case "extract":
      return { source_url: sourceUrl };
    case "scan":
      return {
        market: marketInfo,
        block_count: ctx.source?.blocks.length ?? 0,
        word_count: ctx.source?.wordCount ?? 0,
        outline: outlineOf(ctx.source?.blocks ?? []),
      };
    case "localize":
      return {
        market: marketInfo,
        block_count: ctx.source?.blocks.length ?? 0,
        word_count: ctx.source?.wordCount ?? 0,
        findings: ctx.findings ?? [],
      };
    case "review":
      return {
        market: marketInfo,
        findings: ctx.findings?.length ?? 0,
        localized_blocks: ctx.localized?.blocks.length ?? 0,
        removed_blocks: ctx.localized?.blocks.filter((b) => b.removed).map((b) => b.id) ?? [],
      };
    case "links":
      return {
        locale: market.locale,
        domain: market.domain,
        internal_links: ctx.source?.links?.length ?? null,
        links: (ctx.source?.links ?? []).slice(0, 30),
      };
    case "semantic_links":
      return {
        locale: market.locale,
        linkable_blocks: (ctx.localized?.blocks ?? []).filter((b) => !b.removed).length,
        step5_link: ctx.linking?.chosen?.target_href ?? null,
      };
    case "check":
      return {
        source_blocks: ctx.source?.blocks.length ?? 0,
        source_word_count: ctx.source?.wordCount ?? 0,
        export_length: ctx.exportMarkdown?.length ?? 0,
        market: marketInfo,
      };
    case "improve":
      return {
        source_blocks: ctx.source?.blocks.length ?? 0,
        findings: ctx.findings?.length ?? 0,
        removed_blocks: (ctx.localized?.blocks ?? []).filter((b) => b.removed).length,
        export_length: ctx.exportMarkdown?.length ?? 0,
        market: marketInfo,
      };
    default:
      return {};
  }
}
