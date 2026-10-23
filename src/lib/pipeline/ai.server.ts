import {
  modelId,
  supportsReasoningEffort,
  supportsTemperature,
  usesCompletionTokens,
} from "./model-capabilities";

const BASE_URL = (process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1").replace(/\/+$/, "");

export interface PromptTemplateRow {
  step_key: string;
  system_prompt: string;
  user_prompt: string;
  model: string;
  temperature: number | string | null;
  max_tokens: number | null;
  response_format: string | null;
  reasoning_effort: string | null;
  version: number;
}

export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v == null) return "";
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  });
}

/** Aufzeichnung aller Platzhalterwerte eines Schrittlaufs (für den Platzhalter-Report). */
export interface RecordedPromptVars {
  step_key: string;
  template_version: number;
  model: string;
  vars: Record<string, unknown>;
}

let varRecorder: RecordedPromptVars[] | null = null;

export function startVarRecording(): void {
  varRecorder = [];
}

export function collectRecordedVars(): RecordedPromptVars[] {
  const rec = varRecorder ?? [];
  varRecorder = null;
  return rec;
}

function apiKey(): string {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("OPENAI_API_KEY fehlt – OpenAI-API nicht konfiguriert.");
  return key;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
}

async function callChat(
  model: string,
  system: string,
  user: string,
  temperature: number,
  maxTokens: number,
  reasoningEffort: string | null,
): Promise<{ text: string; usage: Usage }> {
  const id = modelId(model);
  const params: Record<string, unknown> = {
    model: id,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (usesCompletionTokens(id)) {
    params["max_completion_tokens"] = maxTokens;
  } else {
    params["max_tokens"] = maxTokens;
  }
  if (supportsTemperature(id)) {
    params["temperature"] = temperature;
  }
  if (supportsReasoningEffort(id) && reasoningEffort) {
    params["reasoning_effort"] = reasoningEffort;
  }
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await gatewayError(res);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    usage: {
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    },
  };
}

async function gatewayError(res: Response): Promise<Error> {
  let message = `OpenAI-Fehler ${res.status}`;
  let code = "";
  try {
    const body = (await res.json()) as {
      error?: { message?: string; code?: string; type?: string };
      message?: string;
    };
    message = body.error?.message ?? body.message ?? message;
    code = body.error?.code ?? body.error?.type ?? "";
  } catch {
    /* noop */
  }
  // OpenAI meldet fehlendes Guthaben als 429 "insufficient_quota" – kein Rate-Limit, Wiederholen sinnlos.
  if (code === "insufficient_quota" || /no credits|exceeded your current quota/i.test(message)) {
    return new Error(`OpenAI-Guthaben aufgebraucht. ${message}`);
  }
  if (res.status === 429) return new Error(`Rate-Limit erreicht. ${message}`);
  if (res.status === 402) return new Error(`OpenAI-Guthaben aufgebraucht. ${message}`);
  return new Error(message);
}

export function extractJson(raw: string): unknown {  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Antwort enthielt kein gültiges JSON.");
  }
}

export interface LlmResult<T> {
  data: T;
  raw: string;
  model: string;
  promptSnapshot: string;
  tokensIn: number;
  tokensOut: number;
}

export async function runPrompt<T = unknown>(
  tpl: PromptTemplateRow,
  vars: Record<string, unknown>,
): Promise<LlmResult<T>> {
  const system = renderTemplate(tpl.system_prompt, vars);
  const user = renderTemplate(tpl.user_prompt, vars);
  const model = modelId(tpl.model);
  const temperature = Number(tpl.temperature ?? 0.3);
  const maxTokens = tpl.max_tokens ?? 4000;
  const reasoningEffort = tpl.reasoning_effort ?? null;
  if (varRecorder) {
    varRecorder.push({
      step_key: tpl.step_key,
      template_version: tpl.version,
      model,
      vars,
    });
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { text: raw, usage } = await callChat(model, system, user, temperature, maxTokens, reasoningEffort);
      const data =
        tpl.response_format === "json" ? (extractJson(raw) as T) : ((raw as unknown) as T);
      return {
        data,
        raw,
        model,
        promptSnapshot: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Guthaben") || msg.includes("403")) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM-Aufruf fehlgeschlagen");
}

export interface WebSearchResult {
  text: string;
  citations: { url: string; title: string | null }[];
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** Modell für die automatisierte Websuche (Schritt 9). */
export const WEB_SEARCH_MODEL = "gpt-4.1";

/**
 * OpenAI Chat Completions mit integriertem web_search-Tool.
 * Liefert die Antwort und die Quellen-Zitationen (url_citation-Annotationen).
 */
export async function webSearchCompletion(
  system: string,
  user: string,
): Promise<WebSearchResult> {
  const id = modelId(WEB_SEARCH_MODEL);
  const params: Record<string, unknown> = {
    model: id,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools: [{ type: "web_search" }],
    temperature: 0.2,
  };
  if (usesCompletionTokens(id)) {
    params["max_completion_tokens"] = 2000;
  } else {
    params["max_tokens"] = 2000;
  }
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await gatewayError(res);
  const json = (await res.json()) as {
    choices?: {
      message?: {
        content?: string;
        annotations?: { type?: string; url?: string; title?: string }[];
      };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;
  const citations = (message?.annotations ?? [])
    .filter((a) => a?.type === "url_citation" && typeof a?.url === "string")
    .map((a) => ({ url: a.url as string, title: typeof a.title === "string" ? a.title : null }));
  return {
    text: message?.content ?? "",
    citations,
    model: id,
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
  };
}
