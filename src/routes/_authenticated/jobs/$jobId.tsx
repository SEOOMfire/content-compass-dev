import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Play, RefreshCw, ChevronDown, FileDown, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  runStepFn,
  exportJobReport,
  exportPromptVars,
  exportFullJobDocs,
} from "@/lib/pipeline.functions";
import { downloadMarkdown } from "@/lib/download";
import { renderBlock } from "@/lib/pipeline/render";
import { useActiveWorkspace } from "@/lib/use-active-workspace";
import {
  isLegacyContext,
  PIPELINE,
  type Finding,
  type JobContext,
  type LinkingResult,
  type ReviewIssue,
  type SemanticLinkingResult,
} from "@/lib/pipeline/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/jobs/$jobId")({
  head: () => ({
    meta: [
      { title: "Job-Detail – Content-Lokalisierung" },
      { name: "description", content: "Pipeline-Schritte, Ergebnisse und Export eines Jobs." },
      { property: "og:title", content: "Job-Detail – Content-Lokalisierung" },
      {
        property: "og:description",
        content: "Pipeline-Schritte, Ergebnisse und Export eines Jobs.",
      },
    ],
  }),
  component: JobDetail,
});

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  done: "default",
  done_with_errors: "destructive",
  running: "secondary",
  blocked: "destructive",
  error: "destructive",
  pending: "outline",
};

/** Automatische Wiederholungen je Schritt bei „Komplett ausführen“ (also 4 Versuche). */
const MAX_STEP_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const DECISION_LABEL: Record<string, string> = {
  ersetzen: "ersetzen",
  neutral: "neutral",
  streichen: "streichen",
};

const ISSUE_STATUS_LABEL: Record<string, string> = {
  applied: "korrigiert",
  resolved: "erledigt",
  rejected: "Korrektur verworfen",
  open: "offen",
};

function FindingsTable({ findings }: { findings: Finding[] }) {
  if (!findings.length) {
    return <p className="text-muted-foreground">Keine deutschlandspezifischen Stellen gefunden.</p>;
  }
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-1 pr-2 font-medium">DE-Verweis</th>
            <th className="py-1 pr-2 font-medium">Entscheidung</th>
            <th className="py-1 pr-2 font-medium">Ersatz</th>
            <th className="py-1 pr-2 font-medium">Blöcke</th>
            <th className="py-1 font-medium">Anweisung</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id} className="border-b border-border align-top">
              <td className="py-1 pr-2">
                {f.de_reference}
                <span className="block text-muted-foreground">{f.category}</span>
              </td>
              <td className="py-1 pr-2">
                <Badge variant={f.decision === "streichen" ? "destructive" : "secondary"}>
                  {DECISION_LABEL[f.decision] ?? f.decision}
                </Badge>
              </td>
              <td className="py-1 pr-2">{f.target_equivalent ?? "—"}</td>
              <td className="py-1 pr-2 tabular-nums">{f.block_ids.join(", ")}</td>
              <td className="py-1">{f.instruction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewList({ issues, warnings }: { issues: ReviewIssue[]; warnings: string[] }) {
  return (
    <div className="space-y-3">
      {warnings.length ? (
        <div>
          <p className="mb-1 font-medium text-destructive">Offene Warnungen ({warnings.length})</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">Keine offenen Warnungen.</p>
      )}
      {issues.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Alle Befunde ({issues.length})
          </summary>
          <ul className="mt-2 space-y-0.5">
            {issues.map((i, idx) => (
              <li key={idx}>
                <span className="tabular-nums text-muted-foreground">
                  {i.block_id ?? "Dokument"}
                </span>{" "}
                · {i.problem}{" "}
                <Badge
                  variant={
                    i.status === "open" || i.status === "rejected" ? "destructive" : "secondary"
                  }
                >
                  {ISSUE_STATUS_LABEL[i.status] ?? i.status}
                </Badge>
                <span className="ml-1 text-muted-foreground">
                  ({i.origin === "llm" ? "KI" : "Code"})
                </span>
                {i.note && <span className="block pl-4 text-muted-foreground">{i.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function LinkingSummary({ linking }: { linking: LinkingResult }) {
  const chosen = linking.chosen;
  return (
    <div className="space-y-3">
      {chosen ? (
        <div>
          <p className="mb-1 font-medium">
            {linking.inserted ? "Link eingefügt" : "Treffer gefunden, aber nicht eingefügt"} ·{" "}
            <span className="tabular-nums text-muted-foreground">{chosen.block_id}</span>
          </p>
          <p className="break-all">
            <span className="text-muted-foreground">DE:</span> {chosen.anchor_de} →{" "}
            {chosen.source_href}
          </p>
          <p className="break-all">
            <span className="text-muted-foreground">hreflang {chosen.hreflang}:</span>{" "}
            {chosen.target_href}
          </p>
          {linking.inserted && linking.patched_block && (
            <div className="mt-2">
              <p className="text-muted-foreground">So steht es im Export (Markdown):</p>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2">
                {renderBlock(linking.patched_block)}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">Kein Link eingefügt.</p>
      )}
      {linking.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-destructive">
          {linking.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {linking.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {linking.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {linking.checked.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Geprüfte Links ({linking.checked.length} von {linking.candidates})
          </summary>
          <ul className="mt-2 space-y-0.5">
            {linking.checked.map((c, idx) => (
              <li key={idx} className="break-all">
                <span className="tabular-nums text-muted-foreground">{c.block_id}</span> · {c.href}{" "}
                <Badge variant={c.target ? "secondary" : "outline"}>
                  {c.target ? `hreflang ${c.target.hreflang}` : (c.note ?? "kein Treffer")}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SemanticLinkingSummary({ semanticLinking }: { semanticLinking: SemanticLinkingResult }) {
  return (
    <div className="space-y-3">
      <p className="font-medium">
        {semanticLinking.inserted.length} Link(s) aus {semanticLinking.keywords.length} Keyword(s)
        eingesetzt
      </p>
      {semanticLinking.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-destructive">
          {semanticLinking.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {semanticLinking.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {semanticLinking.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {semanticLinking.keywords.length > 0 && (
        <div className="space-y-3">
          {semanticLinking.keywords.map((k) => (
            <div key={k.block_id}>
              <p>
                <span className="tabular-nums text-muted-foreground">{k.block_id}</span> ·{" "}
                <strong>{k.keyword}</strong>
                {k.intent && <span className="text-muted-foreground"> · {k.intent}</span>}
              </p>
              {k.chosen && (
                <p className="break-all">
                  <Badge variant="secondary">verlinkt</Badge> {k.chosen.url}{" "}
                  <span className="tabular-nums text-muted-foreground">
                    (P {(k.chosen.probability * 100).toFixed(0)} % · Sim{" "}
                    {k.chosen.similarity.toFixed(2)})
                  </span>
                </p>
              )}
              {!k.chosen && k.note && <p className="text-muted-foreground">{k.note}</p>}
              {k.candidates.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {k.candidates.slice(0, 5).map((c, i) => (
                    <li key={i} className="break-all">
                      <span className="tabular-nums">
                        {c.probability == null ? "—" : `${(c.probability * 100).toFixed(0)} %`}
                      </span>{" "}
                      · Sim {c.similarity.toFixed(2)} · {c.url}
                      {c.title ? ` (${c.title})` : ""}
                    </li>
                  ))}
                  {k.candidates.length > 5 && (
                    <li>… {k.candidates.length - 5} weitere Kandidaten</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobDetail() {
  const { jobId } = Route.useParams();
  const qc = useQueryClient();
  const { role } = useActiveWorkspace();
  const canManage = role === "manager" || role === "admin";
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*, markets(country,language,domain)")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false),
  });

  const steps = useQuery({
    queryKey: ["job-steps", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_steps")
        .select("*")
        .eq("job_id", jobId)
        .order("step_order");
      if (error) throw error;
      return data;
    },
    refetchInterval: 3000,
  });

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["job", jobId] }),
      qc.invalidateQueries({ queryKey: ["job-steps", jobId] }),
    ]);
  }

  async function runOne(stepKey: string) {
    setBusy(stepKey);
    try {
      const res = await runStepFn({ data: { jobId, stepKey } });
      if (res.ok) toast.success("Schritt abgeschlossen");
      else toast.error(res.error ?? "Schritt fehlgeschlagen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  /**
   * Ein Schritt mit automatischer Wiederholung: höchstens 3 Retries (4 Versuche) mit
   * kurzer Pause für transiente Fehler. Blockierte Schritte und fehlendes Guthaben
   * werden nicht wiederholt.
   */
  async function runStepWithRetry(stepKey: string) {
    for (let attempt = 1; ; attempt++) {
      let res: { ok: boolean; error: string | null; blocked?: boolean };
      try {
        res = await runStepFn({ data: { jobId, stepKey } });
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : "Fehler" };
      }
      const fatal =
        !res.ok &&
        /Guthaben aufgebraucht|OPENAI_API_KEY fehlt|Seite neu laden/.test(res.error ?? "");
      if (res.ok || res.blocked || fatal || attempt > MAX_STEP_RETRIES) {
        return { ...res, attempts: attempt };
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      await refresh();
    }
  }

  /**
   * Führt die Schritte ab `fromStep` nacheinander aus – je Schritt ein eigener Request,
   * damit kein Request das Zeitlimit des Hostings (Vercel: 300 s) überschreitet.
   */
  async function runAll(fromStep?: string) {
    setBusy("all");
    try {
      const start = fromStep ? PIPELINE.findIndex((s) => s.key === fromStep) : 0;
      for (const step of PIPELINE.slice(Math.max(start, 0))) {
        const res = await runStepWithRetry(step.key);
        await refresh();
        if (!res.ok) {
          toast.error(
            `${step.key}: ${res.error ?? "Fehler"}${res.attempts > 1 ? ` (${res.attempts} Versuche)` : ""}`,
          );
          return;
        }
      }
      toast.success("Pipeline abgeschlossen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function downloadDoc(kind: "report" | "vars" | "full") {
    setBusy(kind);
    try {
      const fn =
        kind === "report"
          ? exportJobReport
          : kind === "vars"
            ? exportPromptVars
            : exportFullJobDocs;
      const { filename, markdown } = await fn({ data: { jobId } });
      downloadMarkdown(filename, markdown);
      toast.success("Datei heruntergeladen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  }

  const rawContext = job.data?.context ?? {};
  const ctx = rawContext as JobContext;
  const legacy = isLegacyContext(rawContext);
  const exportMd = typeof ctx.exportMarkdown === "string" ? ctx.exportMarkdown : undefined;
  const exportName = `${ctx.localized?.meta?.slug || `job-${jobId}`}.md`;
  const market = job.data?.markets as { country?: string; language?: string } | null | undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{job.data?.source_url ?? "Job"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Zielmarkt: {market?.country ?? "—"} · {market?.language ?? "—"}
            {job.data?.status && ` · Job-Status: ${job.data.status}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} size="icon" aria-label="Aktualisieren">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => downloadDoc("report")} disabled={busy !== null}>
            <FileDown className="mr-2 h-4 w-4" />
            {busy === "report" ? "Erstelle…" : "Prozess-Report (.md)"}
          </Button>
          <Button variant="outline" onClick={() => downloadDoc("vars")} disabled={busy !== null}>
            <FileDown className="mr-2 h-4 w-4" />
            {busy === "vars" ? "Erstelle…" : "Platzhalter (.md)"}
          </Button>
          <Button variant="outline" onClick={() => downloadDoc("full")} disabled={busy !== null}>
            <FileDown className="mr-2 h-4 w-4" />
            {busy === "full" ? "Erstelle…" : "Gesamtdoku (.md)"}
          </Button>
          {canManage && (
            <Button onClick={() => runAll()} disabled={busy !== null}>
              <Play className="mr-2 h-4 w-4" /> Komplett ausführen
            </Button>
          )}
        </div>
      </div>

      {legacy && (
        <Card className="border-border bg-surface">
          <CardContent className="py-3 text-sm text-muted-foreground">
            Dieser Job stammt aus der früheren Pipeline. Ein vorhandener Export bleibt sichtbar.
            „Komplett ausführen“ startet die neue Pipeline ab Schritt 1 und ersetzt die alten
            Ergebnisse.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {PIPELINE.map((def) => {
          const step = (steps.data ?? []).find((s: Tables<"job_steps">) => s.step_key === def.key);
          const isOpen = open === def.key;
          const output = (step?.output ?? null) as Record<string, unknown> | null;
          return (
            <Card key={def.key} className="border-border bg-surface">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 py-3">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-3 text-left"
                  onClick={() => setOpen(isOpen ? null : def.key)}
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                  <span>
                    <CardTitle className="text-sm">{def.label}</CardTitle>
                    <span className="text-xs text-muted-foreground">{def.description}</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {step && (
                    <Badge variant={STATUS_VARIANT[step.status] ?? "outline"}>
                      {step.status}
                      {step.run_count ? ` ·${step.run_count}` : ""}
                    </Badge>
                  )}
                  {canManage && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => runOne(def.key)}
                      >
                        {busy === def.key ? "…" : step?.status === "done" ? "Erneut" : "Ausführen"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => runAll(def.key)}
                      >
                        ab hier
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className="space-y-3 border-t border-border pt-3 text-xs">
                  {step?.error && <p className="text-destructive">{step.error}</p>}
                  {step?.model && <p className="text-muted-foreground">Modell: {step.model}</p>}

                  {def.key === "scan" && Array.isArray(output?.["findings"]) && (
                    <FindingsTable findings={output["findings"] as Finding[]} />
                  )}
                  {def.key === "review" && Array.isArray(output?.["issues"]) && (
                    <ReviewList
                      issues={output["issues"] as ReviewIssue[]}
                      warnings={(output["warnings"] as string[] | undefined) ?? []}
                    />
                  )}

                  {def.key === "links" && output && Array.isArray(output["checked"]) && (
                    <LinkingSummary linking={output as unknown as LinkingResult} />
                  )}

                  {def.key === "semantic_links" && output && Array.isArray(output["keywords"]) && (
                    <SemanticLinkingSummary
                      semanticLinking={output as unknown as SemanticLinkingResult}
                    />
                  )}

                  {step?.prompt_snapshot && (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">
                        Prompt-Snapshot
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
                        {step.prompt_snapshot}
                      </pre>
                    </details>
                  )}
                  <details
                    open={
                      def.key !== "scan" &&
                      def.key !== "review" &&
                      def.key !== "links" &&
                      def.key !== "semantic_links"
                    }
                  >
                    <summary className="cursor-pointer text-muted-foreground">
                      Rohdaten (JSON)
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
                      {output ? JSON.stringify(output, null, 2) : "Noch kein Ergebnis."}
                    </pre>
                  </details>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {exportMd && (
        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Export (Markdown)
              {legacy && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  aus der früheren Pipeline
                </span>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(exportMd);
                  toast.success("In die Zwischenablage kopiert");
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Kopieren
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadMarkdown(exportName, exportMd)}
              >
                <FileDown className="mr-2 h-4 w-4" /> .md herunterladen
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap text-xs">
              {exportMd}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
