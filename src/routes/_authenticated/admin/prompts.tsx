import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  savePrompt,
  testPrompt,
  exportAllPrompts,
  listPromptSamples,
} from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FIXED_TEMPERATURE,
  isReasoningModel,
  REASONING_EFFORT_OPTIONS,
} from "@/lib/pipeline/model-capabilities";
import { PIPELINE, type StepDef } from "@/lib/pipeline/types";
import { PROMPT_VARIABLE_HINTS, placeholdersIn } from "@/lib/pipeline/prompt-catalog";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/admin/prompts")({
  head: () => ({
    meta: [
      { title: "Prompts verwalten – Content-Lokalisierung" },
      {
        name: "description",
        content: "Prompts der Lokalisierungs-Pipeline bearbeiten, versionieren und testen.",
      },
      { property: "og:title", content: "Prompts verwalten" },
      {
        property: "og:description",
        content: "Prompts der Lokalisierungs-Pipeline bearbeiten, versionieren und testen.",
      },
    ],
  }),
  component: PromptsPage,
});

type Template = Tables<"prompt_templates">;

interface Draft {
  system_prompt: string;
  user_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  reasoning_effort: string;
}

interface TestResult {
  raw: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  json: { ok: true; pretty: string } | { ok: false; error: string } | null;
}

/** Auswählbare ChatGPT-Modelle (OpenAI-Modell-IDs, Stand 2026). Liste bei Bedarf erweitern. */
const CHATGPT_MODELS = [
  // Non-Reasoning (unterstützen temperature)
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-nano",
  "gpt-4.1-mini",
  "gpt-4.1",
  // Reasoning (kein temperature; nutzt max_completion_tokens + reasoning_effort)
  "o3-mini",
  "o4-mini",
  "gpt-5-nano",
  "gpt-5-mini",
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6",
];

/** Pipeline-Schritte mit KI-Prompt (scan, localize, review, links). */
const PROMPT_STEPS = PIPELINE.filter((s): s is StepDef & { promptKey: string } =>
  Boolean(s.promptKey),
);
const PIPELINE_KEYS = PROMPT_STEPS.map((s) => s.promptKey);

function toDraft(p: Template): Draft {
  return {
    system_prompt: p.system_prompt,
    user_prompt: p.user_prompt,
    model: p.model,
    temperature: Number(p.temperature ?? 0.3),
    max_tokens: p.max_tokens ?? 4000,
    reasoning_effort: p.reasoning_effort ?? (isReasoningModel(p.model) ? "medium" : ""),
  };
}

function variablesOf(p: Template): string[] {
  return Array.isArray(p.variables) ? (p.variables as string[]) : [];
}

function checkJson(raw: string): TestResult["json"] {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return { ok: true, pretty: JSON.stringify(JSON.parse(cleaned), null, 2) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ungültiges JSON" };
  }
}

function PromptsPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testVars, setTestVars] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [sampleId, setSampleId] = useState<string>("");
  const [showLegacy, setShowLegacy] = useState(false);
  const [busy, setBusy] = useState(false);

  const prompts = useQuery({
    queryKey: ["prompt-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_templates")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as Template[];
    },
  });

  const all = prompts.data ?? [];
  const legacy = all.filter((p) => !PIPELINE_KEYS.includes(p.step_key));
  const current = all.find((p) => p.id === active);
  const currentStep = current
    ? PROMPT_STEPS.find((s) => s.promptKey === current.step_key)
    : undefined;
  const isLegacy = Boolean(current && !currentStep);

  const samples = useQuery({
    queryKey: ["prompt-samples", current?.step_key],
    enabled: Boolean(current && currentStep),
    queryFn: () => listPromptSamples({ data: { templateKey: current!.step_key } }),
  });

  const dirty = useMemo(() => {
    if (!current || !draft) return false;
    return JSON.stringify(toDraft(current)) !== JSON.stringify(draft);
  }, [current, draft]);

  /** Platzhalter-Abgleich: im Text benutzt vs. vom Code befüllt. */
  const placeholderCheck = useMemo(() => {
    if (!current || !draft) return { unknown: [] as string[], unused: [] as string[] };
    const declared = variablesOf(current);
    const used = placeholdersIn(`${draft.system_prompt}\n${draft.user_prompt}`);
    return {
      unknown: used.filter((v) => !declared.includes(v)),
      unused: declared.filter((v) => !used.includes(v)),
    };
  }, [current, draft]);

  const modelOptions =
    draft && !CHATGPT_MODELS.includes(draft.model)
      ? [...CHATGPT_MODELS, draft.model]
      : CHATGPT_MODELS;
  const isReasoning = draft ? isReasoningModel(draft.model) : false;

  function onModelChange(value: string) {
    if (!draft) return;
    const reasoning = isReasoningModel(value);
    setDraft({
      ...draft,
      model: value,
      temperature: reasoning ? FIXED_TEMPERATURE : draft.temperature,
      reasoning_effort: reasoning ? draft.reasoning_effort || "medium" : "",
    });
  }

  function select(id: string) {
    if (id === active) return;
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    const p = all.find((x) => x.id === id);
    if (!p) return;
    setActive(id);
    setTestResult(null);
    setSampleId("");
    setTestVars(Object.fromEntries(variablesOf(p).map((v) => [v, ""])));
    setDraft(toDraft(p));
  }

  function applySample(id: string) {
    setSampleId(id);
    const sample = (samples.data ?? []).find((s) => s.id === id);
    if (!sample || !current) return;
    setTestVars(Object.fromEntries(variablesOf(current).map((v) => [v, sample.vars[v] ?? ""])));
    setTestResult(null);
  }

  async function copyPlaceholder(v: string) {
    try {
      await navigator.clipboard.writeText(`{{${v}}}`);
      toast.success(`{{${v}}} kopiert`);
    } catch {
      /* Zwischenablage nicht verfügbar */
    }
  }

  async function onSave() {
    if (!active || !draft) return;
    setBusy(true);
    try {
      const res = await savePrompt({
        data: { id: active, ...draft, reasoning_effort: draft.reasoning_effort || null },
      });
      toast.success(`Gespeichert als Version ${res.version}`);
      await qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    if (!current || !draft) return;
    setBusy(true);
    setTestResult(null);
    try {
      const res = await testPrompt({
        data: {
          stepKey: current.step_key,
          vars: testVars,
          draft: { ...draft, reasoning_effort: draft.reasoning_effort || null },
        },
      });
      setTestResult({
        raw: res.raw,
        model: res.model,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        json: res.responseFormat === "json" ? checkJson(res.raw) : null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onExportAll() {
    setBusy(true);
    try {
      const { filename, markdown } = await exportAllPrompts();
      const url = URL.createObjectURL(
        new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Alle Prompts heruntergeladen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit border-border bg-surface">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Pipeline-Prompts</CardTitle>
          <p className="text-xs text-muted-foreground">
            Die Pipeline nutzt vier KI-Prompts. Schritt 1 (Extraktion) und das Rendern laufen ohne
            KI.
          </p>
          <Button variant="outline" size="sm" onClick={onExportAll} disabled={busy}>
            Alle Prompts als .md
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {PROMPT_STEPS.map((step) => {
            const p = all.find((x) => x.step_key === step.promptKey);
            if (!p) {
              return (
                <div key={step.key} className="rounded-md px-2 py-1.5 text-sm">
                  <div className="text-muted-foreground">{step.label}</div>
                  <div className="text-xs text-destructive">
                    Vorlage „{step.promptKey}“ fehlt –{" "}
                    {step.promptKey === "link_integration" ? "Migration 0012" : "Migration 0010"}{" "}
                    ausführen.
                  </div>
                </div>
              );
            }
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => select(p.id)}
                className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${
                  active === p.id ? "bg-accent" : ""
                }`}
              >
                <span>
                  <span className="block">{step.label}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {p.step_key}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="secondary">v{p.version}</Badge>
                  <span className="text-xs text-muted-foreground">{p.model}</span>
                </span>
              </button>
            );
          })}

          {legacy.length > 0 && (
            <div className="pt-3">
              <button
                type="button"
                onClick={() => setShowLegacy(!showLegacy)}
                className="w-full px-2 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                {showLegacy ? "▾" : "▸"} Altvorlagen (nicht mehr verwendet, {legacy.length})
              </button>
              {showLegacy &&
                legacy.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => select(p.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent ${
                      active === p.id ? "bg-accent" : ""
                    }`}
                  >
                    <span>{p.name}</span>
                    <span>v{p.version}</span>
                  </button>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {current && draft ? (
        <div className="space-y-4">
          <Card className="border-border bg-surface">
            <CardHeader className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{currentStep?.label ?? current.name}</CardTitle>
                <Badge variant="outline" className="font-mono">
                  {current.step_key}
                </Badge>
                <Badge variant="secondary">v{current.version}</Badge>
                <Badge variant="outline">Ausgabe: {current.response_format ?? "text"}</Badge>
                {dirty && <Badge>Ungespeichert</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {currentStep?.description ?? current.description}
              </p>
              {isLegacy && (
                <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-xs">
                  Diese Vorlage gehört zur früheren 16-Schritt-Pipeline und wird nicht mehr
                  verwendet. Sie ist nur noch lesbar.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Modell</Label>
                  <Select value={draft.model} onValueChange={onModelChange} disabled={isLegacy}>
                    <SelectTrigger>
                      <SelectValue placeholder="Modell wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Temperature</Label>
                  {isReasoning ? (
                    <Input type="number" value={FIXED_TEMPERATURE} disabled />
                  ) : (
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={draft.temperature}
                      disabled={isLegacy}
                      onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                    />
                  )}
                  {isReasoning && (
                    <p className="text-xs text-muted-foreground">Fix (Reasoning-Modell)</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Max Tokens</Label>
                  <Input
                    type="number"
                    min={1}
                    value={draft.max_tokens}
                    disabled={isLegacy}
                    onChange={(e) => setDraft({ ...draft, max_tokens: Number(e.target.value) })}
                  />
                  {current.step_key === "localize_document" && (
                    <p className="text-xs text-muted-foreground">
                      Muss für den längsten Teil (bis ca. 2.500 Wörter) reichen.
                    </p>
                  )}
                </div>
                {isReasoning && (
                  <div className="space-y-1.5">
                    <Label>Reasoning Effort</Label>
                    <Select
                      value={draft.reasoning_effort || "medium"}
                      onValueChange={(value) => setDraft({ ...draft, reasoning_effort: value })}
                      disabled={isLegacy}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="medium" />
                      </SelectTrigger>
                      <SelectContent>
                        {REASONING_EFFORT_OPTIONS.map((effort) => (
                          <SelectItem key={effort} value={effort}>
                            {effort}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>System-Prompt</Label>
                <Textarea
                  rows={4}
                  value={draft.system_prompt}
                  readOnly={isLegacy}
                  onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>User-Prompt</Label>
                <Textarea
                  rows={18}
                  className="font-mono text-xs"
                  value={draft.user_prompt}
                  readOnly={isLegacy}
                  onChange={(e) => setDraft({ ...draft, user_prompt: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Platzhalter (vom Code befüllt · Klick kopiert)</Label>
                <div className="flex flex-wrap gap-1">
                  {variablesOf(current).map((v) => (
                    <button
                      key={v}
                      type="button"
                      title={PROMPT_VARIABLE_HINTS[v] ?? ""}
                      onClick={() => copyPlaceholder(v)}
                      className={`rounded border border-border px-1.5 py-0.5 font-mono text-xs hover:bg-accent ${
                        placeholderCheck.unused.includes(v)
                          ? "text-muted-foreground line-through"
                          : ""
                      }`}
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                  {!variablesOf(current).length && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                {placeholderCheck.unknown.length > 0 && (
                  <p className="text-xs text-destructive">
                    Unbekannte Platzhalter (bleiben beim Lauf leer):{" "}
                    {placeholderCheck.unknown.map((v) => `{{${v}}}`).join(", ")}
                  </p>
                )}
                {!isLegacy && placeholderCheck.unused.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nicht verwendet: {placeholderCheck.unused.map((v) => `{{${v}}}`).join(", ")}
                  </p>
                )}
              </div>

              {!isLegacy && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={onSave} disabled={busy || !dirty}>
                    Speichern (neue Version)
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDraft(toDraft(current))}
                    disabled={busy || !dirty}
                  >
                    Änderungen verwerfen
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {!isLegacy && (
            <Card className="border-border bg-surface">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Testlauf</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Testet den aktuellen Entwurf (auch ungespeichert). Platzhalter lassen sich mit den
                  aufgezeichneten Werten eines echten Joblaufs befüllen.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Werte aus Joblauf übernehmen</Label>
                  <Select value={sampleId} onValueChange={applySample}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          samples.isLoading
                            ? "Lade …"
                            : samples.data?.length
                              ? "Joblauf wählen"
                              : "Noch keine aufgezeichneten Läufe"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(samples.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {Object.keys(testVars).map((v) => {
                  const value = testVars[v] ?? "";
                  const long = value.length > 300 || value.includes("\n");
                  return (
                    <div key={v} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <Label className="font-mono text-xs">{`{{${v}}}`}</Label>
                        <span className="text-xs text-muted-foreground">
                          {PROMPT_VARIABLE_HINTS[v] ?? ""}
                          {value ? ` · ${value.length} Zeichen` : ""}
                        </span>
                      </div>
                      <Textarea
                        rows={long ? 6 : 1}
                        className="font-mono text-xs"
                        value={value}
                        onChange={(e) => setTestVars({ ...testVars, [v]: e.target.value })}
                      />
                    </div>
                  );
                })}

                <Button variant="outline" onClick={onTest} disabled={busy}>
                  {busy ? "…" : "Entwurf testen"}
                </Button>

                {testResult && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{testResult.model}</span>
                      <span>
                        · {testResult.tokensIn} → {testResult.tokensOut} Tokens
                      </span>
                      {testResult.json &&
                        (testResult.json.ok ? (
                          <Badge variant="secondary">gültiges JSON</Badge>
                        ) : (
                          <Badge variant="destructive">
                            ungültiges JSON: {testResult.json.error}
                          </Badge>
                        ))}
                    </div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                      {testResult.json?.ok ? testResult.json.pretty : testResult.raw}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Bitte links einen Prompt wählen.</p>
      )}
    </div>
  );
}
