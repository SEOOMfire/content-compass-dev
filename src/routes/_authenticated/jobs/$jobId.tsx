import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, RefreshCw, ChevronDown, FileDown, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  runStepFn,
  applyAllChangesFn,
  exportJobReport,
  exportPromptVars,
  exportFullJobDocs,
} from "@/lib/pipeline.functions";
import { downloadMarkdown } from "@/lib/download";
import { renderBlock } from "@/lib/pipeline/render";
import { blockPlainText } from "@/lib/pipeline/validate";
import { useActiveWorkspace } from "@/lib/use-active-workspace";
import {
  isLegacyContext,
  PIPELINE,
  type Block,
  type Finding,
  type ImprovementProposal,
  type ImprovementResult,
  type JobContext,
  type LinkingResult,
  type LocalizedBlock,
  type ReviewIssue,
  type SemanticKeyword,
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

function Highlight({ text, keyword }: { text: string; keyword: string }) {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return <>{text}</>;
  const end = idx + keyword.length;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-inherit">{text.slice(idx, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/** Kleinster Textabschnitt (Satz bzw. Listenpunkt), der das Keyword enthält. */
function sentenceFor(text: string, keyword: string): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return text.trim();
  let start = idx;
  while (start > 0 && !/[.!?\n]/.test(text.charAt(start - 1))) start--;
  let end = idx + keyword.length;
  while (end < text.length && !/[.!?\n]/.test(text.charAt(end))) end++;
  if (end < text.length && /[.!?]/.test(text.charAt(end))) end++;
  return text.slice(start, end).trim();
}

/** Flache Textvorschau eines Verbesserungs-Patches. */
function patchPreview(patch: ImprovementProposal["patch"]): string | null {
  if (!patch) return null;
  if (typeof patch["text"] === "string") return patch["text"];
  if (Array.isArray(patch["items"]))
    return (patch["items"] as unknown[])
      .map((it) => (typeof it === "string" ? it : JSON.stringify(it)))
      .join("\n");
  if (Array.isArray(patch["rows"]))
    return (patch["rows"] as string[][]).map((r) => r.join(" | ")).join("\n");
  return JSON.stringify(patch);
}

/** Fertiger, kurzer Such-Prompt zum Kopieren nach ChatGPT – Antwort passt direkt ins Quellen-Feld. */
function sourceSearchPrompt(
  p: ImprovementProposal,
  country?: string,
  language?: string,
): string {
  const market = country || language ? `${country ?? "der Zielmarkt"}${language ? ` (${language})` : ""}` : "den Zielmarkt";
  const topic = [p.problem, p.suggestion].filter(Boolean).join(" ");
  return [
    `Du hilfst, für einen lokalisierten Artikel eine fehlende Quelle zu finden. Zielmarkt: ${market}.`,
    "",
    `Thema: ${topic}`,
    "",
    `Suche, ob es dafür eine konkrete Quelle/Lösung für ${country ?? "den Zielmarkt"} gibt.`,
    "",
    "Antworte NUR mit dem direkt verwertbaren Ergebnis (max. 1 Zeile):",
    "„Name der Quelle – URL“ – oder „keine“, wenn nichts gefunden wurde.",
    "",
    "Keine Einleitung, keine Erklärungen, keine Alternativen.",
  ].join("\n");
}

/** Fertiger Prompt, um für den ganzen Artikel anerkannte E-E-A-T-Quellen im Zielland zu finden. */
function eeatSourcesPrompt(country?: string, language?: string, title?: string): string {
  const market = country || language
    ? `${country ?? "den Zielmarkt"}${language ? ` (${language})` : ""}`
    : "den Zielmarkt";
  return [
    `Du hilfst, für einen lokalisierten Artikel passende, anerkannte Quellen zu finden. Zielmarkt: ${market}.`,
    "",
    `Thema des Artikels: ${title ?? "siehe unten"}`,
    "",
    `Finde seriöse, anerkannte und vertrauenswürdige Quellen aus ${country ?? "dem Zielmarkt"} (Behörden, Fachverbände, wissenschaftliche Institutionen, renommierte Fachportale), die für E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) als Beleg/Referenz geeignet sind.`,
    "",
    "Gib NUR eine kurze Liste zurück, direkt zum Einfügen – je Quelle eine Zeile:",
    "„Name der Quelle – URL“",
    "",
    "Keine Einleitung, keine Erklärungen, keine Alternativen.",
  ].join("\n");
}

function SourceFinderCard({
  country,
  language,
  title,
}: {
  country: string | undefined;
  language: string | undefined;
  title: string | undefined;
}) {
  return (
    <Card className="border-border bg-surface">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Passende Quellen finden</CardTitle>
          <p className="text-xs text-muted-foreground">
            Erzeugt einen Prompt, der im Zielland anerkannte Quellen für E-E-A-T findet.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(eeatSourcesPrompt(country, language, title));
            toast.success("Such-Prompt kopiert");
          }}
        >
          <Copy className="mr-1 h-3 w-3" /> Prompt kopieren
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
          {eeatSourcesPrompt(country, language, title)}
        </pre>
      </CardContent>
    </Card>
  );
}

function SemanticLinkPanel({
  semanticLinking,
  blocks,
  sourceBlocks,
  linking,
  pending,
  canManage,
  selected,
  linkingInserted,
  onToggle,
  onSelectAll,
  onSelectNone,
  onToggleStep5,
}: {
  semanticLinking: SemanticLinkingResult;
  blocks: LocalizedBlock[] | undefined;
  sourceBlocks: Block[] | undefined;
  linking: LinkingResult | undefined;
  pending: number;
  canManage: boolean;
  selected: string[];
  linkingInserted: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onToggleStep5: () => void;
}) {
  const eligible = semanticLinking.keywords.filter((k) => k.eligible && k.chosen);
  const below = semanticLinking.keywords.filter((k) => !k.eligible && k.chosen);
  const noCandidate = semanticLinking.keywords.filter((k) => !k.chosen);
  const selectable = [...eligible, ...below];
  const insertedIds = new Set(semanticLinking.inserted.map((i) => i.block_id));
  const blockById = new Map((blocks ?? []).map((b) => [b.id, b]));
  const sourceById = new Map((sourceBlocks ?? []).map((b) => [b.id, b]));

  // Wie oft dieselbe Ziel-URL vorgeschlagen wird (über alle auswählbaren Vorschläge).
  const urlCounts = new Map<string, number>();
  for (const k of selectable) {
    urlCounts.set(k.chosen!.url, (urlCounts.get(k.chosen!.url) ?? 0) + 1);
  }
  // Wie oft dieselbe Ziel-URL aktuell ausgewählt ist (Duplikat-Warnung).
  const selectedUrlCounts = new Map<string, number>();
  for (const id of selected) {
    const k = selectable.find((x) => x.block_id === id);
    if (k?.chosen)
      selectedUrlCounts.set(k.chosen.url, (selectedUrlCounts.get(k.chosen.url) ?? 0) + 1);
  }
  const hasDuplicateSelection = [...selectedUrlCounts.values()].some((n) => n > 1);

  function row(k: SemanticKeyword) {
    const src = blockById.get(k.block_id);
    const srcText = src ? sentenceFor(blockPlainText(src), k.keyword) : "";
    const de = sourceById.get(k.block_id);
    const deText = de ? blockPlainText(de) : "";
    const inText = insertedIds.has(k.block_id);
    const url = k.chosen!.url;
    const dupCount = urlCounts.get(url) ?? 0;
    const dupSelected = selectedUrlCounts.get(url) ?? 0;
    return (
      <div key={k.block_id} className="rounded-md border border-border p-2">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={!canManage}
            checked={selected.includes(k.block_id)}
            onChange={() => onToggle(k.block_id)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <strong>{k.keyword}</strong>
              <span className="text-muted-foreground">→</span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {k.chosen!.title || url} ↗
              </a>
              <Badge variant="secondary" className="tabular-nums">
                {(k.chosen!.probability * 100).toFixed(0)} %
              </Badge>
              {dupCount > 1 && (
                <span className="tabular-nums text-muted-foreground">
                  · {dupCount}× vorgeschlagen
                </span>
              )}
              {dupSelected > 1 && (
                <span className="rounded bg-amber-200/70 px-1 text-amber-900">
                  {dupSelected}× ausgewählt – nur 1× wird übernommen
                </span>
              )}
              {inText && (
                <Badge variant="outline" className="text-muted-foreground">
                  ✓ im Text
                </Badge>
              )}
            </span>
            {srcText && (
              <span className="mt-1 block border-l-2 border-border pl-2 text-muted-foreground">
                „<Highlight text={srcText} keyword={k.keyword} />“
              </span>
            )}
            {deText && (
              <span className="mt-1 block pl-2 text-muted-foreground">
                <span className="font-medium">DE:</span>{" "}
                {deText.length > 280 ? `${deText.slice(0, 280)}…` : deText}
              </span>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">Details</summary>
              <span className="mt-1 block text-muted-foreground">
                Block: <span className="tabular-nums">{k.block_id}</span>
                {k.intent && <> · Intent: {k.intent}</>} · Similarity{" "}
                <span className="tabular-nums">{k.chosen!.similarity.toFixed(2)}</span>
              </span>
              {k.candidates.length > 1 && (
                <ul className="mt-1 space-y-0.5 pl-4">
                  {k.candidates.map((c, i) => (
                    <li key={i} className="break-all">
                      <span className="tabular-nums text-muted-foreground">
                        {c.probability == null
                          ? "—"
                          : `${(c.probability * 100).toFixed(0)} %`}
                      </span>{" "}
                      · Sim {c.similarity.toFixed(2)} ·{" "}
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {c.title || c.url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </span>
        </label>
      </div>
    );
  }

  const hasSelectable = selectable.length > 0;

  return (
    <Card
      className={
        pending > 0 ? "border-2 border-amber-400 bg-surface" : "border-border bg-surface"
      }
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">
            {pending > 0 ? `${pending} Linkvorschläge prüfen` : "Linkauswahl"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Links an-/abwählbar – werden mit „Alle Änderungen übernehmen“ angewendet.
          </p>
        </div>
        {hasSelectable && canManage && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={onSelectAll}>
              Alle auswählen
            </Button>
            <Button size="sm" variant="outline" onClick={onSelectNone}>
              Keine
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {semanticLinking.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-destructive">
            {semanticLinking.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}

        {linking?.chosen && (
          <div
            className={`rounded-md border border-border p-2 ${
              linkingInserted ? "" : "bg-muted/40 opacity-70"
            }`}
          >
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!canManage || !linking.patched_block}
                checked={linkingInserted}
                onChange={() => onToggleStep5()}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <strong>{linking.chosen.anchor_de}</strong>
                  <span className="text-muted-foreground">→</span>
                  <a
                    href={linking.chosen.target_href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {linking.chosen.target_href} ↗
                  </a>
                  <Badge variant="outline" className="text-muted-foreground">
                    {linkingInserted ? "intern verlinkt" : "abgewählt"}
                  </Badge>
                </span>
                <span className="mt-1 block text-muted-foreground">
                  Interne Verlinkung (Schritt 5) · Block{" "}
                  <span className="tabular-nums">{linking.chosen.block_id}</span>
                </span>
              </span>
            </label>
          </div>
        )}

        {!hasSelectable ? (
          <p className="text-sm text-muted-foreground">
            Keine passenden Linkvorschläge gefunden.
          </p>
        ) : (
          <>
            {eligible.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Passende Vorschläge (≥ 80 %)</p>
                {eligible.map(row)}
              </div>
            )}
            {below.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Weitere Vorschläge (unter 80 %)</p>
                {below.map(row)}
              </div>
            )}
          </>
        )}

        {noCandidate.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Keine Kandidaten · {noCandidate.length}
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {noCandidate.map((k) => (
                <li key={k.block_id}>
                  <span className="tabular-nums text-muted-foreground">{k.block_id}</span> ·{" "}
                  <strong>{k.keyword}</strong>
                  <span className="text-muted-foreground"> · {k.note ?? "kein Kandidat"}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {semanticLinking.notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {semanticLinking.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {hasDuplicateSelection && (
          <p className="text-sm text-amber-700">
            Achtung: mehrere Vorschläge zeigen auf dieselbe URL – nur der erste wird übernommen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ImprovementPanel({
  improve,
  blocks,
  country,
  language,
  canManage,
  selected,
  userTexts,
  onToggle,
  onSelectAll,
  onSelectNone,
  onUserText,
}: {
  improve: ImprovementResult;
  blocks: LocalizedBlock[] | undefined;
  country: string | undefined;
  language: string | undefined;
  canManage: boolean;
  selected: string[];
  userTexts: Record<string, string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onUserText: (id: string, value: string) => void;
}) {
  const appliedIds = new Set(improve.applied);
  const blockById = new Map((blocks ?? []).map((b) => [b.id, b]));

  if (!improve.proposals.length) {
    return (
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Verbesserungen & Quellen</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">Keine Vorschläge.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-surface">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Verbesserungen & Quellen</CardTitle>
          <p className="text-xs text-muted-foreground">
            An-/abwählbar – wird mit „Alle Änderungen übernehmen“ angewendet.
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSelectAll()}
            >
              Alle auswählen
            </Button>
            <Button size="sm" variant="outline" onClick={() => onSelectNone()}>
              Keine
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {improve.proposals.map((p) => {
          const applied = appliedIds.has(p.id);
          const current = p.block_id ? blockById.get(p.block_id) : undefined;
          return (
            <div key={p.id} className="rounded-md border border-border p-2">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={!canManage}
                  checked={selected.includes(p.id)}
                  onChange={() => onToggle(p.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <Badge variant={p.kind === "verbesserung" ? "default" : "secondary"}>
                      {p.kind === "verbesserung" ? "Verbesserung" : "Quelle"}
                    </Badge>
                    <strong>{p.title}</strong>
                    {p.block_id && (
                      <span className="tabular-nums text-muted-foreground">· {p.block_id}</span>
                    )}
                    {applied && (
                      <Badge variant="outline" className="text-muted-foreground">
                        ✓ übernommen
                      </Badge>
                    )}
                  </span>
                  <span className="mt-1 block text-muted-foreground">{p.problem}</span>
                  {p.suggestion && (
                    <span className="mt-1 block text-muted-foreground">
                      Empfehlung: {p.suggestion}
                    </span>
                  )}
                  {(current || p.patch) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground">Details</summary>
                      {current && (
                        <span className="mt-1 block border-l-2 border-border pl-2 text-muted-foreground">
                          Aktuell: {blockPlainText(current)}
                        </span>
                      )}
                      {p.patch && (
                        <span className="mt-1 block border-l-2 border-emerald-400 pl-2 text-emerald-700">
                          Vorschlag: {patchPreview(p.patch)}
                        </span>
                      )}
                    </details>
                  )}
                </span>
              </label>
              {p.kind === "quelle" && (
                <div className="mt-2 rounded border border-dashed border-border bg-muted/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Such-Prompt für ChatGPT
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(sourceSearchPrompt(p, country, language));
                        toast.success("Such-Prompt kopiert");
                      }}
                    >
                      <Copy className="mr-1 h-3 w-3" /> Kopieren
                    </Button>
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    {sourceSearchPrompt(p, country, language)}
                  </pre>
                </div>
              )}
              {p.patch == null && (
                <input
                  type="text"
                  placeholder="Quelle eintragen (URL oder Text) – wird als „Quelle: …“ ans Blockende angehängt"
                  className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  value={userTexts[p.id] ?? ""}
                  disabled={!canManage}
                  onChange={(e) => onUserText(p.id, e.target.value)}
                />
              )}
              {p.kind === "verbesserung" &&
                p.patch != null &&
                typeof p.patch["text"] === "string" && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Vorschlag (bearbeitbar) – direkt übernehmen oder anpassen:
                    </span>
                    <textarea
                      className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                      rows={4}
                      value={userTexts[p.id] ?? (p.patch["text"] as string)}
                      disabled={!canManage}
                      onChange={(e) => onUserText(p.id, e.target.value)}
                    />
                  </div>
                )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function JobDetail() {
  const { jobId } = Route.useParams();
  const qc = useQueryClient();
  const { role } = useActiveWorkspace();
  const canManage = role === "manager" || role === "admin";
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [panelScrollRequest, setPanelScrollRequest] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Pending Änderungen (werden mit „Alle Änderungen übernehmen“ angewendet).
  const [linkingInserted, setLinkingInserted] = useState(false);
  const [semanticSelected, setSemanticSelected] = useState<string[]>([]);
  const [improveSelected, setImproveSelected] = useState<string[]>([]);
  const [userTexts, setUserTexts] = useState<Record<string, string>>({});
  const [applyingAll, setApplyingAll] = useState(false);

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

  // Nach „Komplett ausführen“ zur offenen Linkauswahl springen (sofern Vorschläge vorliegen).
  useEffect(() => {
    if (panelScrollRequest > 0 && (job.data?.semantic_links_pending ?? 0) > 0) {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [panelScrollRequest, job.data?.semantic_links_pending]);

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
      setPanelScrollRequest((n) => n + 1);
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

  // Pending-Zustand aus dem Kontext initialisieren/zurücksetzen.
  const semSig = [
    (ctx.semanticLinking?.inserted ?? []).map((i) => i.block_id).join(","),
    ctx.semanticLinking
      ? ctx.semanticLinking.keywords
          .filter((k) => k.eligible && k.chosen)
          .map((k) => k.block_id)
          .join(",")
      : "",
    ctx.semanticLinking ? "1" : "0",
  ].join("|");
  useEffect(() => {
    if (!ctx.semanticLinking) {
      setSemanticSelected([]);
      return;
    }
    if ((job.data?.semantic_links_pending ?? 0) > 0) {
      // Frischer Lauf: empfohlene (≥ 80 %) + bereits eingesetzte Links vorauswählen.
      const eligible = ctx.semanticLinking.keywords
        .filter((k) => k.eligible && k.chosen)
        .map((k) => k.block_id);
      const inserted = ctx.semanticLinking.inserted.map((i) => i.block_id);
      setSemanticSelected([...new Set([...eligible, ...inserted])]);
    } else {
      // Nach dem Übernehmen exakt den gespeicherten Zustand abbilden.
      setSemanticSelected(ctx.semanticLinking.inserted.map((i) => i.block_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semSig, job.data?.semantic_links_pending]);

  useEffect(() => {
    setLinkingInserted(ctx.linking?.inserted ?? false);
  }, [ctx.linking?.inserted]);

  const impSig = [
    (ctx.improve?.proposals ?? []).map((p) => p.id).join(","),
    (ctx.improve?.applied ?? []).join(","),
    Object.keys(ctx.improve?.overrides ?? {}).join(","),
    ctx.improve ? "1" : "0",
  ].join("|");
  useEffect(() => {
    if (!ctx.improve) {
      setImproveSelected([]);
      setUserTexts({});
      return;
    }
    setImproveSelected(ctx.improve.applied ?? []);
    setUserTexts(ctx.improve.overrides ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impSig]);

  async function applyAll() {
    setApplyingAll(true);
    try {
      const res = await applyAllChangesFn({
        data: {
          jobId,
          linkingInserted,
          semanticBlockIds: semanticSelected,
          improvementProposalIds: improveSelected,
          userTexts,
        },
      });
      if (res.ok)
        toast.success(
          `${res.inserted} Link(s), ${res.applied} Vorschlag/Vorschläge übernommen (${res.patched} Textänderungen)`,
        );
      else toast.error(res.error ?? "Übernehmen fehlgeschlagen");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fehler");
    } finally {
      setApplyingAll(false);
    }
  }

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

                  {def.key === "semantic_links" && (
                    <p className="text-muted-foreground">
                      {output && Array.isArray(output["keywords"])
                        ? `${(output["keywords"] as unknown[]).length} Keyword(s) vorgeschlagen – siehe Linkauswahl unten.`
                        : "Siehe Linkauswahl unten."}
                    </p>
                  )}

                  {def.key === "improve" && (
                    <p className="text-muted-foreground">
                      {output && Array.isArray(output["proposals"])
                        ? `${(output["proposals"] as unknown[]).length} Vorschlag/Vorschläge – siehe Panel unten.`
                        : "Siehe Panel unten."}
                    </p>
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
                      def.key !== "semantic_links" &&
                      def.key !== "improve"
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

      {ctx.semanticLinking && (
        <div ref={panelRef}>
          <SemanticLinkPanel
            semanticLinking={ctx.semanticLinking}
            blocks={ctx.localized?.blocks}
            sourceBlocks={ctx.source?.blocks}
            linking={ctx.linking}
            pending={job.data?.semantic_links_pending ?? 0}
            canManage={canManage}
            selected={semanticSelected}
            linkingInserted={linkingInserted}
            onToggle={(id) =>
              setSemanticSelected((cur) =>
                cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
              )
            }
            onSelectAll={() =>
              setSemanticSelected(
                ctx.semanticLinking!.keywords.filter((k) => k.chosen).map((k) => k.block_id),
              )
            }
            onSelectNone={() => setSemanticSelected([])}
            onToggleStep5={() => setLinkingInserted((cur) => !cur)}
          />
        </div>
      )}

      {ctx.improve && (
        <>
          <SourceFinderCard
            country={market?.country}
            language={market?.language}
            title={ctx.localized?.meta?.title}
          />
          <ImprovementPanel
            improve={ctx.improve}
            blocks={ctx.localized?.blocks}
            country={market?.country}
            language={market?.language}
            canManage={canManage}
            selected={improveSelected}
            userTexts={userTexts}
            onToggle={(id) =>
              setImproveSelected((cur) =>
                cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
              )
            }
            onSelectAll={() => setImproveSelected(ctx.improve!.proposals.map((p) => p.id))}
            onSelectNone={() => setImproveSelected([])}
            onUserText={(id, value) => setUserTexts((cur) => ({ ...cur, [id]: value }))}
          />
        </>
      )}

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

      {canManage && (ctx.semanticLinking || ctx.improve || ctx.linking) && (
        <Card className="border-2 border-primary/40 bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Alle Änderungen übernehmen</CardTitle>
              <p className="text-xs text-muted-foreground">
                Wendet alle ausgewählten/abgewählten Links, Quellen und Verbesserungen in einem Schritt an.
              </p>
            </div>
            <Button onClick={applyAll} disabled={applyingAll}>
              {applyingAll ? "Übernehme…" : "Alle Änderungen übernehmen"}
            </Button>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
