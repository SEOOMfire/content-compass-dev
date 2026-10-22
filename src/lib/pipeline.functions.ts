import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkspaceRole } from "@/lib/roles";

const MANAGER_ROLES: WorkspaceRole[] = ["manager", "admin"];

async function isAdmin(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  return ((data ?? []) as unknown[]).length > 0;
}

async function getMembership(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data?.role as WorkspaceRole | undefined) ?? null;
}

/** Erzwingt eine beliebige Mitgliedschaft (viewer genügt) im Arbeitsbereich. */
async function assertWorkspaceMember(userId: string, workspaceId: string): Promise<void> {
  if (await isAdmin(userId)) return;
  if (!(await getMembership(userId, workspaceId))) {
    throw new Error("Keine Berechtigung für diese Aktion.");
  }
}

/** Erzwingt mindestens die Rolle `manager` (oder `admin`) im Arbeitsbereich. */
async function assertWorkspaceRole(
  userId: string,
  workspaceId: string,
  required: WorkspaceRole[],
): Promise<void> {
  if (await isAdmin(userId)) return;
  const role = await getMembership(userId, workspaceId);
  if (!role || !required.includes(role)) {
    throw new Error("Keine Berechtigung für diese Aktion.");
  }
}

async function assertAdmin(userId: string): Promise<void> {
  if (!(await isAdmin(userId))) throw new Error("Keine Berechtigung für diese Aktion.");
}

/** Lädt die workspace_id eines Jobs (für Bereichsprüfungen). */
async function getJobWorkspace(jobId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("id,workspace_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) throw new Error("Job nicht gefunden.");
  return data.workspace_id;
}

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        source_url: z.string().url(),
        market_id: z.string().uuid(),
        workspace_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertWorkspaceRole(context.userId, data.workspace_id, MANAGER_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .insert({
        source_url: data.source_url,
        market_id: data.market_id,
        workspace_id: data.workspace_id,
        created_by: context.userId,
        status: "idle",
        context: {},
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: job.id };
  });

export const deleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceRole(context.userId, workspaceId, MANAGER_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("jobs").delete().eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid(), stepKey: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceRole(context.userId, workspaceId, MANAGER_ROLES);
    const { executeStep } = await import("@/lib/pipeline/engine.server");
    const res = await executeStep(data.jobId, data.stepKey);
    return {
      ok: res.ok,
      error: res.ok ? null : res.error,
      blocked: !res.ok && "blocked" in res ? Boolean(res.blocked) : false,
      output: res.ok ? JSON.stringify(res.output ?? null) : null,
    };
  });

export const applySemanticLinksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid(), blockIds: z.array(z.string()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceRole(context.userId, workspaceId, MANAGER_ROLES);
    const { applySemanticLinksStep } = await import("@/lib/pipeline/engine.server");
    const res = await applySemanticLinksStep(data.jobId, data.blockIds);
    return res;
  });

export const applyImprovementsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        jobId: z.string().uuid(),
        proposalIds: z.array(z.string()),
        userTexts: z.record(z.string()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceRole(context.userId, workspaceId, MANAGER_ROLES);
    const { applyImprovementsStep } = await import("@/lib/pipeline/engine.server");
    const res = await applyImprovementsStep(data.jobId, data.proposalIds, data.userTexts ?? {});
    return res;
  });

export const exportJobReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceMember(context.userId, workspaceId);
    const { buildJobReport } = await import("@/lib/pipeline/report.server");
    return await buildJobReport(data.jobId);
  });

export const exportPromptVars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceMember(context.userId, workspaceId);
    const { buildPromptVarsReport } = await import("@/lib/pipeline/prompt-vars.server");
    return await buildPromptVarsReport(data.jobId);
  });

export const exportFullJobDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceMember(context.userId, workspaceId);
    const { buildFullJobDocumentation } = await import("@/lib/pipeline/full-export.server");
    return await buildFullJobDocumentation(data.jobId);
  });

/** Lokalisierter Endtext (Export aus Schritt 4) für Vorschau + .md-Download in der Liste. */
export const getJobContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workspaceId = await getJobWorkspace(data.jobId);
    await assertWorkspaceMember(context.userId, workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("context")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error || !job) throw new Error("Job nicht gefunden.");
    const ctx = (job.context ?? {}) as Record<string, unknown>;
    return { markdown: (ctx["exportMarkdown"] as string | undefined) ?? null };
  });

export const exportAllPrompts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { buildAllPromptsMarkdown } = await import("@/lib/pipeline/prompts-export.server");
    return await buildAllPromptsMarkdown();
  });

export const savePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        system_prompt: z.string(),
        user_prompt: z.string(),
        model: z.string(),
        temperature: z.number(),
        max_tokens: z.number(),
        reasoning_effort: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: current, error } = await supabaseAdmin
      .from("prompt_templates")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !current) throw new Error("Prompt nicht gefunden.");
    const version = (current.version ?? 1) + 1;
    const { error: updateError } = await supabaseAdmin
      .from("prompt_templates")
      .update({
        system_prompt: data.system_prompt,
        user_prompt: data.user_prompt,
        model: data.model,
        temperature: data.temperature,
        max_tokens: data.max_tokens,
        reasoning_effort: data.reasoning_effort ?? null,
        version,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (updateError) throw new Error(updateError.message);

    const { error: insertError } = await supabaseAdmin.from("prompt_versions").insert({
      template_id: data.id,
      version,
      system_prompt: data.system_prompt,
      user_prompt: data.user_prompt,
      model: data.model,
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      reasoning_effort: data.reasoning_effort ?? null,
      response_format: current.response_format,
      created_by: context.userId,
    });
    if (insertError) throw new Error(insertError.message);

    return { version };
  });

/**
 * Testlauf eines Prompts. Mit `draft` wird der ungespeicherte Entwurf getestet
 * (gespeicherte Vorlage bleibt unverändert), sonst die gespeicherte Version.
 */
export const testPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        stepKey: z.string(),
        vars: z.record(z.string(), z.string()),
        draft: z
          .object({
            system_prompt: z.string(),
            user_prompt: z.string(),
            model: z.string(),
            temperature: z.number(),
            max_tokens: z.number(),
            reasoning_effort: z.string().nullable().optional(),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runPrompt } = await import("@/lib/pipeline/ai.server");
    const { data: tpl, error } = await supabaseAdmin
      .from("prompt_templates")
      .select("*")
      .eq("step_key", data.stepKey)
      .single();
    if (error || !tpl) throw new Error("Prompt nicht gefunden.");
    const effective = data.draft
      ? { ...tpl, ...data.draft, reasoning_effort: data.draft.reasoning_effort ?? null }
      : tpl;
    // Rohtext zurückgeben, auch wenn das JSON ungültig ist (Prüfung zeigt die UI an).
    const res = await runPrompt(
      { ...(effective as Record<string, unknown>), response_format: "text" } as never,
      data.vars,
    );
    return {
      raw: res.raw,
      model: res.model,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      responseFormat: (tpl.response_format as string | null) ?? "text",
    };
  });

/**
 * Aufgezeichnete Platzhalterwerte der letzten Jobläufe für ein Prompt-Template,
 * damit Testläufe mit echten Daten befüllt werden können.
 */
export const listPromptSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ templateKey: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PIPELINE } = await import("@/lib/pipeline/types");
    const step = PIPELINE.find((s) => s.promptKey === data.templateKey);
    if (!step) return [];

    const { data: steps, error } = await supabaseAdmin
      .from("job_steps")
      .select("job_id,updated_at,prompt_vars")
      .eq("step_key", step.key)
      .not("prompt_vars", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    const rows = (steps ?? []) as { job_id: string; updated_at: string; prompt_vars: unknown }[];
    if (!rows.length) return [];

    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id,source_url,markets(country,language)")
      .in(
        "id",
        rows.map((r) => r.job_id),
      );
    type JobRow = {
      id: string;
      source_url: string;
      markets: { country?: string; language?: string } | null;
    };
    const jobById = new Map(((jobs ?? []) as unknown as JobRow[]).map((j) => [j.id, j]));

    const samples: { id: string; label: string; vars: Record<string, string> }[] = [];
    for (const row of rows) {
      const calls = (Array.isArray(row.prompt_vars) ? row.prompt_vars : []) as {
        step_key?: string;
        vars?: Record<string, unknown>;
      }[];
      const relevant = calls.filter((c) => c.step_key === data.templateKey && c.vars);
      const job = jobById.get(row.job_id);
      const path = job
        ? (new URL(job.source_url).pathname.split("/").filter(Boolean).pop() ?? job.source_url)
        : row.job_id;
      const market = job?.markets
        ? `${job.markets.country ?? "?"}/${job.markets.language ?? "?"}`
        : "?";
      relevant.forEach((call, i) => {
        samples.push({
          id: `${row.job_id}:${i}`,
          label: `${path} · ${market} · ${row.updated_at.slice(0, 10)}${
            relevant.length > 1 ? ` · Aufruf ${i + 1}/${relevant.length}` : ""
          }`,
          // Gleiche Darstellung wie renderTemplate: Strings unverändert, sonst JSON.
          vars: Object.fromEntries(
            Object.entries(call.vars ?? {}).map(([k, v]) => [
              k,
              v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2),
            ]),
          ),
        });
      });
    }
    return samples;
  });

/** Arbeitsbereiche des Nutzers (oder alle, wenn admin) mit Rollen + Mitgliederzahl. */
export const listWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = await isAdmin(context.userId);
    const { data: memberships } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id,user_id,role");
    const rows = (memberships ?? []) as {
      workspace_id: string;
      user_id: string;
      role: WorkspaceRole;
    }[];
    const myRows = rows.filter((r) => r.user_id === context.userId);
    const visibleIds = admin
      ? Array.from(new Set(rows.map((r) => r.workspace_id)))
      : Array.from(new Set(myRows.map((r) => r.workspace_id)));

    const { data: workspaces } = await supabaseAdmin.from("workspaces").select("id,name");
    return ((workspaces ?? []) as { id: string; name: string }[])
      .filter((w) => visibleIds.includes(w.id))
      .map((w) => ({
        id: w.id,
        name: w.name,
        role: myRows.find((r) => r.workspace_id === w.id)?.role ?? null,
        memberCount: rows.filter((r) => r.workspace_id === w.id).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ws, error } = await supabaseAdmin
      .from("workspaces")
      .insert({ name: data.name.trim(), created_by: context.userId })
      .select("id,name")
      .single();
    if (error) throw new Error(error.message);
    return ws;
  });

export const updateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), name: z.string().min(1).max(255) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("workspaces")
      .update({ name: data.name.trim() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface WorkspaceMemberRow {
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
}

export const listWorkspaceMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<WorkspaceMemberRow[]> => {
    await assertWorkspaceRole(context.userId, data.workspaceId, MANAGER_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: members, error } = await supabaseAdmin
      .from("workspace_members")
      .select("user_id,role")
      .eq("workspace_id", data.workspaceId)
      .order("created_at");
    if (error) throw new Error(error.message);

    const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    const emailById = new Map<string, string>();
    if (userIds.length) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id,email")
        .in("id", userIds);
      for (const p of (profiles ?? []) as { id: string; email: string }[]) {
        emailById.set(p.id, p.email);
      }
    }
    return (members ?? []).map(
      (m: { user_id: string; role: WorkspaceRole }): WorkspaceMemberRow => ({
        user_id: m.user_id,
        role: m.role,
        email: emailById.get(m.user_id) ?? null,
      }),
    );
  });

/** Mitglied einladen (role ∈ viewer/manager; admin nur durch Admin). */
export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        workspace_id: z.string().uuid(),
        role: z.enum(["viewer", "manager", "admin"]),
        redirectTo: z.string().url(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.role === "admin") {
      await assertAdmin(context.userId);
    } else {
      await assertWorkspaceRole(context.userId, data.workspace_id, MANAGER_ROLES);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();

    let userId: string | null = null;
    let link: string | null = null;
    let emailSent = false;

    const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: data.redirectTo,
    });
    if (invited.data?.user) {
      userId = invited.data.user.id;
      emailSent = true;
    }

    if (!userId) {
      const gen = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: data.redirectTo },
      });
      if (gen.error || !gen.data?.user) {
        throw new Error(
          gen.error?.message ?? invited.error?.message ?? "Einladung fehlgeschlagen.",
        );
      }
      userId = gen.data.user.id;
      link = gen.data.properties?.action_link ?? null;
    }

    await supabaseAdmin.from("workspace_members").upsert(
      {
        workspace_id: data.workspace_id,
        user_id: userId,
        role: data.role,
        invited_by: context.userId,
      },
      { onConflict: "workspace_id,user_id" },
    );

    return { userId, email, emailSent, link };
  });

/** Rolle eines Mitglieds ändern/entfernen (role = null entfernt). */
export const updateWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["viewer", "manager", "admin"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const acting = await getMembership(context.userId, data.workspaceId);
    const isAdminUser = await isAdmin(context.userId);
    if (!isAdminUser && acting !== "manager") {
      throw new Error("Keine Berechtigung für diese Aktion.");
    }

    const target = await getMembership(data.userId, data.workspaceId);

    // Rollen-Eskalation: nur Admins dürfen Admin-Rechte vergeben/entziehen
    // und vorhandene Admins verwalten.
    if (!isAdminUser) {
      if (target === "admin") {
        throw new Error("Administratoren können nur von Admins verwaltet werden.");
      }
      if (data.role === "admin") {
        throw new Error("Nur Administratoren können Admin-Rechte vergeben.");
      }
    }

    // Letzter Admin darf nicht entfernt/degradiert werden.
    if (data.role !== "admin" && target === "admin") {
      const { data: admins } = await supabaseAdmin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", data.workspaceId)
        .eq("role", "admin");
      if (((admins ?? []) as unknown[]).length <= 1) {
        throw new Error("Der letzte Administrator kann nicht entfernt werden.");
      }
    }

    if (data.role === null) {
      await supabaseAdmin
        .from("workspace_members")
        .delete()
        .eq("workspace_id", data.workspaceId)
        .eq("user_id", data.userId);
    } else {
      await supabaseAdmin.from("workspace_members").upsert(
        {
          workspace_id: data.workspaceId,
          user_id: data.userId,
          role: data.role,
          invited_by: context.userId,
        },
        { onConflict: "workspace_id,user_id" },
      );
    }
    return { ok: true };
  });
