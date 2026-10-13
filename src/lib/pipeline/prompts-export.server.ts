import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PIPELINE } from "./types";

interface TemplateRow {
  step_key: string;
  name: string;
  description: string | null;
  system_prompt: string;
  user_prompt: string;
  model: string;
  temperature: number | string | null;
  max_tokens: number | null;
  response_format: string | null;
  variables: unknown;
  version: number | null;
  is_active: boolean | null;
  sort_order: number | null;
  updated_at: string | null;
}

/** Alle hinterlegten Prompt-Vorlagen als eine Markdown-Datei. */
export async function buildAllPromptsMarkdown(): Promise<{
  filename: string;
  markdown: string;
}> {
  const { data, error } = await supabaseAdmin
    .from("prompt_templates")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(error.message);
  const all = (data ?? []) as unknown as TemplateRow[];
  // Pipeline-Prompts zuerst (in Schrittreihenfolge), danach nicht mehr verwendete Altvorlagen.
  const used = PIPELINE.map((s) => s.promptKey).filter((k): k is string => Boolean(k));
  const rows = [
    ...used.map((k) => all.find((r) => r.step_key === k)).filter((r): r is TemplateRow => Boolean(r)),
    ...all.filter((r) => !used.includes(r.step_key)),
  ];
  const stepOf = (key: string) => PIPELINE.find((s) => s.promptKey === key)?.label ?? "nicht mehr verwendet";

  const out: string[] = [];
  out.push("# Prompt-Vorlagen · Content-Lokalisierung");
  out.push("");
  out.push(`- **Exportiert:** ${new Date().toISOString()}`);
  out.push(`- **Anzahl Vorlagen:** ${rows.length}`);
  out.push("");
  out.push("## Übersicht");
  out.push("");
  out.push("| Vorlage | Step-Key | Pipeline-Schritt | Version | Modell | Temp. | Max. Tokens | Aktiv |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    out.push(
      `| ${r.name} | \`${r.step_key}\` | ${stepOf(r.step_key)} | v${r.version ?? 1} | ${r.model} | ${
        r.temperature ?? "—"
      } | ${r.max_tokens ?? "—"} | ${r.is_active === false ? "nein" : "ja"} |`,
    );
  }
  out.push("");

  for (const r of rows) {
    const vars = Array.isArray(r.variables) ? (r.variables as string[]) : [];
    out.push("---");
    out.push("");
    out.push(`## ${r.name}`);
    out.push("");
    out.push(`- **Step-Key:** \`${r.step_key}\``);
    out.push(`- **Pipeline-Schritt:** ${stepOf(r.step_key)}`);
    out.push(`- **Version:** v${r.version ?? 1}`);
    out.push(`- **Modell:** ${r.model} · Temperatur ${r.temperature ?? "—"} · Max. Tokens ${r.max_tokens ?? "—"}`);
    out.push(`- **Ausgabeformat:** ${r.response_format ?? "text"}`);
    out.push(`- **Platzhalter:** ${vars.length ? vars.map((v) => `\`{{${v}}}\``).join(", ") : "—"}`);
    if (r.updated_at) out.push(`- **Zuletzt geändert:** ${r.updated_at}`);
    out.push("");
    if (r.description) {
      out.push(r.description);
      out.push("");
    }
    out.push("### System-Prompt");
    out.push("");
    out.push("```text");
    out.push(r.system_prompt ?? "");
    out.push("```");
    out.push("");
    out.push("### User-Prompt");
    out.push("");
    out.push("```text");
    out.push(r.user_prompt ?? "");
    out.push("```");
    out.push("");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `prompts-${stamp}.md`, markdown: out.join("\n") };
}
