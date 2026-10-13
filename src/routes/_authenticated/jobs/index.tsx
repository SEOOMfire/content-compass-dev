import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createJob, deleteJob, getJobContent } from "@/lib/pipeline.functions";
import { downloadMarkdown } from "@/lib/download";
import { useActiveWorkspace } from "@/lib/use-active-workspace";
import { Trash2, ChevronDown, FileDown, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PIPELINE, STEP_BY_KEY } from "@/lib/pipeline/types";

export const Route = createFileRoute("/_authenticated/jobs/")({
  head: () => ({
    meta: [
      { title: "Lokalisierungs-Jobs – Content-Tool" },
      { name: "description", content: "Übersicht und Start neuer Content-Lokalisierungs-Jobs." },
      { property: "og:title", content: "Lokalisierungs-Jobs – Content-Tool" },
      { property: "og:description", content: "Übersicht und Start neuer Lokalisierungs-Jobs." },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { workspaceId, workspace, role } = useActiveWorkspace();
  const canManage = role === "manager" || role === "admin";

  const [sourceUrl, setSourceUrl] = useState("");
  const [marketId, setMarketId] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openContentId, setOpenContentId] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, string | null | undefined>>({});
  const [loadingContentId, setLoadingContentId] = useState<string | null>(null);

  const markets = useQuery({
    queryKey: ["markets-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("markets")
        .select("id,country,language,domain,active")
        .eq("active", true)
        .order("country");
      if (error) throw error;
      return data;
    },
  });

  type MarketOption = {
    id: string;
    country: string;
    language: string;
  };
  const marketList = (markets.data ?? []) as unknown as MarketOption[];

  const jobs = useQuery({
    queryKey: ["jobs", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("jobs")
        .select("id,source_url,status,current_step,created_at,workspace_id,markets(country,language)")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((j: { status: string }) => j.status === "running") ? 3000 : false,
  });

  const runningIds = ((jobs.data ?? []) as { id: string; status: string }[])
    .filter((j) => j.status === "running")
    .map((j) => j.id);

  const runningSteps = useQuery({
    queryKey: ["jobs-progress", runningIds.join(",")],
    enabled: runningIds.length > 0,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_steps")
        .select("job_id,step_key,status")
        .in("job_id", runningIds);
      if (error) throw error;
      return data as { job_id: string; step_key: string; status: string }[];
    },
  });

  function progressOf(job: { id: string; status: string; current_step: string | null }) {
    const total = PIPELINE.length;
    if (job.status === "done") return 100;
    const rows = (runningSteps.data ?? []).filter(
      (s) => s.job_id === job.id && STEP_BY_KEY[s.step_key],
    );
    const done = rows.filter((s) => s.status === "done").length;
    if (done > 0) return Math.round((done / total) * 100);
    const order = job.current_step ? (STEP_BY_KEY[job.current_step]?.order ?? 0) - 1 : 0;
    return Math.round((Math.max(order, 0) / total) * 100);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!marketId) {
      toast.error("Bitte einen Zielmarkt wählen.");
      return;
    }
    if (!workspaceId) return;
    setCreating(true);
    try {
      const res = await createJob({
        data: { source_url: sourceUrl, market_id: marketId, workspace_id: workspaceId },
      });
      await qc.invalidateQueries({ queryKey: ["jobs", workspaceId] });
      await navigate({ to: "/jobs/$jobId", params: { jobId: res.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Job konnte nicht erstellt werden");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(jobId: string) {
    setDeletingId(jobId);
    try {
      await deleteJob({ data: { jobId } });
      toast.success("Job gelöscht.");
      await qc.invalidateQueries({ queryKey: ["jobs", workspaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Job konnte nicht gelöscht werden");
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleContent(jobId: string) {
    if (openContentId === jobId) {
      setOpenContentId(null);
      return;
    }
    setOpenContentId(jobId);
    if (content[jobId] === undefined) {
      setLoadingContentId(jobId);
      try {
        const res = await getJobContent({ data: { jobId } });
        setContent((c) => ({ ...c, [jobId]: res.markdown ?? null }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Content konnte nicht geladen werden");
        setContent((c) => ({ ...c, [jobId]: null }));
      } finally {
        setLoadingContentId(null);
      }
    }
  }

  async function onDownload(jobId: string) {
    try {
      let markdown = content[jobId];
      if (markdown === undefined) {
        const res = await getJobContent({ data: { jobId } });
        markdown = res.markdown ?? null;
        setContent((c) => ({ ...c, [jobId]: markdown }));
      }
      if (!markdown) {
        toast.info("Noch kein Content vorhanden.");
        return;
      }
      downloadMarkdown(`job-${jobId}.md`, markdown);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download fehlgeschlagen");
    }
  }

  if (!workspaceId) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content-Lokalisierung</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Du bist noch keinem Arbeitsbereich zugeordnet. Bitte wende dich an einen Administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Content-Lokalisierung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deutsche Magazin-URL strukturtreu in einen Zielmarkt lokalisieren – in {PIPELINE.length}{" "}
          nachvollziehbaren Schritten.
          <span className="ml-1 text-subtle-fg">Arbeitsbereich: {workspace?.name ?? "—"}</span>
        </p>
      </div>

      {canManage && (
        <Card className="border-border bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Neuer Job</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="grid gap-4 md:grid-cols-[1fr_240px_auto] md:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="url">Quell-URL (DE)</Label>
                <Input
                  id="url"
                  type="url"
                  required
                  placeholder="https://www.fressnapf.de/magazin/hund/rassen/barbet/"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Zielmarkt</Label>
                <Select value={marketId} onValueChange={setMarketId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Markt wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {marketList.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.country} · {m.language}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={creating}>
                {creating ? "…" : "Job anlegen"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
          {(jobs.data ?? []).length === 0 && !jobs.isLoading && (
            <p className="text-sm text-muted-foreground">Noch keine Jobs vorhanden.</p>
          )}
          {(jobs.data ?? []).map(
            (j: {
              id: string;
              source_url: string;
              status: string;
              current_step: string | null;
              created_at: string;
              markets: { country: string; language: string } | null;
            }) => (
              <div key={j.id} className="rounded-md border border-border">
                <div className="flex items-stretch gap-1 hover:bg-accent">
                  <Link
                    to="/jobs/$jobId"
                    params={{ jobId: j.id }}
                    className="block min-w-0 flex-1 px-3 py-2"
                  >
                    <span className="flex items-center justify-between gap-4">
                      <span className="truncate text-sm">{j.source_url}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {(j.markets as { country?: string } | null)?.country ?? "—"}
                        </span>
                        <Badge
                          variant={
                            j.status === "error" || j.status === "done_with_errors"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {j.status}
                        </Badge>
                      </span>
                    </span>
                    {j.status === "running" && (
                      <span className="mt-2 flex items-center gap-3">
                        <Progress value={progressOf(j)} className="h-2 flex-1" />
                        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {progressOf(j)} %
                        </span>
                      </span>
                    )}
                    {j.status === "running" && j.current_step && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {STEP_BY_KEY[j.current_step]?.label ?? j.current_step}
                      </span>
                    )}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="m-1 shrink-0 self-center text-muted-foreground"
                    aria-label="Content anzeigen"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleContent(j.id);
                    }}
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        openContentId === j.id ? "rotate-180" : ""
                      }`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="m-1 shrink-0 self-center text-muted-foreground"
                    aria-label="Content herunterladen (.md)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(j.id);
                    }}
                  >
                    <FileDown className="h-4 w-4" />
                  </Button>
                  {canManage && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="m-1 shrink-0 self-center text-muted-foreground hover:text-destructive"
                          aria-label="Job löschen"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Job löschen?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Der Job „{j.source_url}“ und alle zugehörigen Schritte werden dauerhaft
                            entfernt. Das kann nicht rückgängig gemacht werden.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deletingId === j.id}
                            onClick={() => onDelete(j.id)}
                          >
                            {deletingId === j.id ? "Löschen…" : "Löschen"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
                {openContentId === j.id && (
                  <div className="border-t border-border bg-muted/30 px-3 py-2">
                    {loadingContentId === j.id ? (
                      <p className="text-xs text-muted-foreground">Lade Content…</p>
                    ) : content[j.id] ? (
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                        {content[j.id]}
                      </pre>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Eye className="h-3.5 w-3.5" /> Noch kein Content vorhanden.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
        </CardContent>
      </Card>
    </div>
  );
}
