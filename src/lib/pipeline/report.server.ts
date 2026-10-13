import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isLegacyContext, PIPELINE, STEP_BY_KEY, type JobContext } from "./types";

function truncate(s: string, max = 6000): string {
  return s.length > max ? `${s.slice(0, max)}\n… [gekürzt, ${s.length} Zeichen gesamt]` : s;
}

function json(value: unknown, max = 6000): string {
  if (value === null || value === undefined) return "_keine Daten_";
  try {
    return "```json\n" + truncate(JSON.stringify(value, null, 2), max) + "\n```";
  } catch {
    return "```\n" + truncate(String(value), max) + "\n```";
  }
}

function ms(v: number | null | undefined): string {
  if (!v && v !== 0) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`;
}

function cell(s: string | null | undefined): string {
  return (s ?? "—").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";
}

/** Baut den vollständigen Prozess-Report eines Jobs als Markdown. */
export async function buildJobReport(jobId: string): Promise<{ filename: string; markdown: string }> {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*, markets(country,language,locale,domain,brand)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");

  const { data: steps } = await supabaseAdmin
    .from("job_steps")
    .select("*")
    .eq("job_id", jobId)
    .order("step_order");

  const market = (job as unknown as {
    markets: { country?: string; language?: string; locale?: string; domain?: string; brand?: string } | null;
  }).markets;
  const jobRow = job as unknown as {
    id: string;
    source_url: string;
    status: string;
    current_step: string | null;
    created_at: string;
    updated_at: string | null;
  };
  const ctx = ((job as { context?: JobContext }).context ?? {}) as JobContext;
  type StepRow = {
    step_key: string;
    status: string;
    run_count: number | null;
    duration_ms: number | null;
    model: string | null;
    input: unknown;
    output: unknown;
    prompt_snapshot: string | null;
    error: string | null;
  };
  const rows = (steps ?? []) as unknown as StepRow[];
  const byKey = new Map(rows.map((s) => [s.step_key, s]));

  const out: string[] = [];
  out.push(`# Prozess-Report · ${jobRow.source_url}`);
  out.push("");
  out.push(`- **Job-ID:** \`${jobRow.id}\``);
  out.push(`- **Zielmarkt:** ${market?.country ?? "—"} · ${market?.language ?? "—"} · ${market?.domain ?? "—"}`);
  out.push(`- **Job-Status:** ${jobRow.status}${jobRow.current_step ? ` (aktueller Schritt: ${jobRow.current_step})` : ""}`);
  if (isLegacyContext(ctx)) {
    out.push("- **Hinweis:** Altjob aus der früheren Pipeline – „Komplett ausführen“ erzeugt ihn neu.");
  }
  out.push(`- **Erstellt:** ${jobRow.created_at} · **Aktualisiert:** ${jobRow.updated_at ?? "—"}`);
  out.push(`- **Report erzeugt:** ${new Date().toISOString()}`);
  out.push("");

  out.push("## Zusammenfassung");
  out.push("");
  out.push("| # | Schritt | Status | Läufe | Dauer | Modell |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const def of PIPELINE) {
    const s = byKey.get(def.key);
    out.push(
      `| ${def.order} | ${def.label} | ${s?.status ?? "nicht ausgeführt"} | ${s?.run_count ?? 0} | ${ms(s?.duration_ms)} | ${s?.model ?? "—"} |`,
    );
  }
  out.push("");

  out.push("## Schrittdetails");
  out.push("");
  for (const def of PIPELINE) {
    const s = byKey.get(def.key);
    out.push(`### ${def.label}`);
    out.push("");
    out.push(`_${def.description}_`);
    out.push("");
    if (!s) {
      out.push("**Status:** nicht ausgeführt");
      out.push("");
      continue;
    }
    out.push(
      `**Status:** ${s.status} · **Läufe:** ${s.run_count} · **Dauer:** ${ms(s.duration_ms)}${s.model ? ` · **Modell:** ${s.model}` : ""}`,
    );
    out.push("");
    out.push("#### Eingabe");
    out.push(json(s.input));
    out.push("");
    if (s.prompt_snapshot) {
      out.push("#### Prompt-Snapshot");
      out.push("```text\n" + truncate(s.prompt_snapshot, 8000) + "\n```");
      out.push("");
    }
    out.push("#### Ausgabe");
    out.push(json(s.output, 12000));
    out.push("");
    if (s.error) {
      out.push("#### Fehler");
      out.push("```text\n" + s.error + "\n```");
      out.push("");
    }
  }

  out.push("## DE-Bezüge (Schritt 2)");
  out.push("");
  const findings = ctx.findings ?? [];
  if (!findings.length) {
    out.push("_Keine Funde._");
  } else {
    out.push("| ID | Blöcke | DE-Verweis | Kategorie | Entscheidung | Ersatz | Anweisung |");
    out.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const f of findings) {
      out.push(
        `| ${f.id} | ${f.block_ids.join(", ")} | ${cell(f.de_reference)} | ${f.category} | ${f.decision} | ${cell(f.target_equivalent)} | ${cell(f.instruction)} |`,
      );
    }
  }
  out.push("");

  out.push("## Prüfung (Schritt 4)");
  out.push("");
  const issues = ctx.review?.issues ?? [];
  if (!issues.length) {
    out.push(ctx.review ? "_Keine Befunde._" : "_Noch nicht geprüft._");
  } else {
    out.push("| Block | Herkunft | Befund | Status | Hinweis |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const i of issues) {
      out.push(`| ${i.block_id ?? "Dokument"} | ${i.origin} | ${cell(i.problem)} | ${i.status} | ${cell(i.note)} |`);
    }
  }
  out.push("");

  out.push("## Job-Kontext (Endstand)");
  out.push(json(ctx, 20000));
  out.push("");

  out.push("## Export-Markdown");
  out.push("");
  out.push(ctx.exportMarkdown ? "```markdown\n" + ctx.exportMarkdown + "\n```" : "_Noch kein Export vorhanden._");
  out.push("");

  const unknownSteps = rows.filter((s) => !STEP_BY_KEY[s.step_key]);
  if (unknownSteps.length) {
    out.push("## Unbekannte Schritte (aus früheren Versionen)");
    out.push(json(unknownSteps.map((s) => ({ step_key: s.step_key, status: s.status }))));
  }

  return { filename: `job-${jobRow.id}-report.md`, markdown: out.join("\n") };
}
