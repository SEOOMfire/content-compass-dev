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
export async function buildJobReport(
  jobId: string,
): Promise<{ filename: string; markdown: string }> {
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

  const market = (
    job as unknown as {
      markets: {
        country?: string;
        language?: string;
        locale?: string;
        domain?: string;
        brand?: string;
      } | null;
    }
  ).markets;
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
  out.push(
    `- **Zielmarkt:** ${market?.country ?? "—"} · ${market?.language ?? "—"} · ${market?.domain ?? "—"}`,
  );
  out.push(
    `- **Job-Status:** ${jobRow.status}${jobRow.current_step ? ` (aktueller Schritt: ${jobRow.current_step})` : ""}`,
  );
  if (isLegacyContext(ctx)) {
    out.push(
      "- **Hinweis:** Altjob aus der früheren Pipeline – „Komplett ausführen“ erzeugt ihn neu.",
    );
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
      out.push(
        `| ${i.block_id ?? "Dokument"} | ${i.origin} | ${cell(i.problem)} | ${i.status} | ${cell(i.note)} |`,
      );
    }
  }
  out.push("");

  out.push("## Interner Link (Schritt 5)");
  out.push("");
  const linking = ctx.linking;
  if (!linking) {
    out.push("_Noch nicht ausgeführt._");
  } else {
    if (linking.chosen) {
      out.push(
        `- ${linking.inserted ? "Eingefügt" : "Nicht eingefügt"} in ${linking.chosen.block_id}: ${linking.chosen.anchor_de} (${linking.chosen.source_href}) → hreflang ${linking.chosen.hreflang}: ${linking.chosen.target_href}`,
      );
    } else {
      out.push("- Kein Link eingefügt.");
    }
    for (const w of linking.warnings) out.push(`- Warnung: ${w}`);
    for (const n of linking.notes) out.push(`- Hinweis: ${n}`);
    if (linking.checked.length) {
      out.push("");
      out.push("| Block | DE-Link | HTTP | hreflang-Ziel | Hinweis |");
      out.push("| --- | --- | --- | --- | --- |");
      for (const c of linking.checked) {
        out.push(
          `| ${c.block_id} | ${cell(c.href)} | ${c.status} | ${cell(c.target ? `${c.target.hreflang}: ${c.target.href}` : null)} | ${cell(c.note)} |`,
        );
      }
    }
  }
  out.push("");

  out.push("## Semantische Links (Schritt 6)");
  out.push("");
  const semanticLinking = ctx.semanticLinking;
  if (!semanticLinking) {
    out.push("_Noch nicht ausgeführt._");
  } else if (!semanticLinking.keywords.length) {
    out.push("_Keine Keywords extrahiert._");
  } else {
    out.push(
      `- Eingesetzt: ${semanticLinking.inserted.length} Link(s) aus ${semanticLinking.keywords.length} Keyword(s).`,
    );
    for (const w of semanticLinking.warnings) out.push(`- Warnung: ${w}`);
    for (const n of semanticLinking.notes) out.push(`- Hinweis: ${n}`);
    out.push("");
    out.push("| Block | Keyword | Intent | Gewählter Link | Wahrscheinlichkeit | Ähnlichkeit |");
    out.push("| --- | --- | --- | --- | --- | --- |");
    for (const k of semanticLinking.keywords) {
      const chosen = k.chosen ? `[${k.keyword}](${k.chosen.url})` : (k.note ?? "—");
      out.push(
        `| ${k.block_id} | ${cell(k.keyword)} | ${cell(k.intent)} | ${cell(chosen)} | ${k.chosen?.probability?.toFixed(3) ?? "—"} | ${k.chosen?.similarity?.toFixed(3) ?? "—"} |`,
      );
      for (const c of k.candidates.slice(0, 3)) {
        out.push(
          `| · | · | · | ${cell(c.url)} | ${c.probability?.toFixed(3) ?? "—"} | ${c.similarity?.toFixed(3) ?? "—"} |`,
        );
      }
    }
  }
  out.push("");

  out.push("## Lokalisierungs-Check (Schritt 7)");
  out.push("");
  const check = ctx.check;
  if (!check) {
    out.push("_Noch nicht ausgeführt._");
  } else {
    out.push(
      `- **Blockierend:** ${check.blocking} · **Hinweise:** ${check.hints} · **Quelle abgerufen:** ${check.sourceFetched ? "ja" : "nein"}`,
    );
    out.push("");
    out.push(check.markdown.trim() ? check.markdown : "_Kein Briefing erzeugt._");
  }
  out.push("");

  out.push("## Job-Kontext (Endstand)");
  out.push(json(ctx, 20000));
  out.push("");

  out.push("## Verbesserungen & Quellen (Schritt 8)");
  out.push("");
  const improve = ctx.improve;
  if (!improve) {
    out.push("_Noch nicht ausgeführt._");
  } else if (!improve.proposals.length) {
    out.push("_Keine Vorschläge._");
  } else {
    for (const p of improve.proposals) {
      const applied = improve.applied.includes(p.id) ? "✓ übernommen" : "offen";
      out.push(
        `### ${p.id} · ${p.kind === "verbesserung" ? "Verbesserung" : "Quelle"} (${applied})${p.block_id ? ` · ${p.block_id}` : ""}`,
      );
      out.push(`**${p.title}**`);
      out.push(`- Problem: ${p.problem}`);
      if (p.suggestion) out.push(`- Empfehlung: ${p.suggestion}`);
      if (p.source?.url) out.push(`- Quelle: ${p.source.title ?? p.source.url} (${p.source.url})`);
      if (p.patch) out.push(`- Patch: \`\`\`json\n${JSON.stringify(p.patch)}\n\`\`\``);
      out.push("");
    }
  }
  out.push("");

  out.push("## Export-Markdown");
  out.push("");
  out.push(
    ctx.exportMarkdown
      ? "```markdown\n" + ctx.exportMarkdown + "\n```"
      : "_Noch kein Export vorhanden._",
  );
  out.push("");

  const unknownSteps = rows.filter((s) => !STEP_BY_KEY[s.step_key]);
  if (unknownSteps.length) {
    out.push("## Unbekannte Schritte (aus früheren Versionen)");
    out.push(json(unknownSteps.map((s) => ({ step_key: s.step_key, status: s.status }))));
  }

  return { filename: `job-${jobRow.id}-report.md`, markdown: out.join("\n") };
}
