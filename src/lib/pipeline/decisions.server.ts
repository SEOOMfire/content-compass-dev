import { DECISIONS_MODEL } from "./semantic-links.config";

const BASE_URL = (process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1").replace(
  /\/+$/,
  "",
);

function apiKey(): string {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("OPENAI_API_KEY fehlt – OpenAI-API nicht konfiguriert.");
  return key;
}

export interface DecisionResult {
  /** Wahrscheinlichkeit 0–1, oder null bei Refusal/nicht auswertbarer Antwort. */
  probability: number | null;
}

interface DecisionsResponse {
  answers?: { type?: string; name?: string | null; probability?: number }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Antwort defensiv parsen: predicate → probability, refusal/sonstiges → null. */
function probabilityFrom(json: DecisionsResponse): number | null {
  const answer = (json.answers ?? []).find((a) => a.type !== "refusal" || a.probability != null);
  if (!answer) return null;
  const p = answer.probability;
  if (typeof p === "number" && Number.isFinite(p)) return Math.min(1, Math.max(0, p));
  return null;
}

/**
 * Eine predicate-Frage an die Decisions API (Beta). Fehler werfen nicht,
 * sondern ergeben `{ probability: null }` – außer fehlendem Guthaben/Schlüssel,
 * das als Fehler durchgereicht wird (Wiederholen wäre sinnlos).
 */
export async function decidePredicate(args: {
  input: string;
  instructions: string;
  model?: string;
}): Promise<DecisionResult> {
  const model = args.model ?? DECISIONS_MODEL;
  const body = JSON.stringify({
    model,
    input: args.input,
    questions: [{ type: "predicate", name: "serves_intent", instructions: args.instructions }],
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
        body,
      });
      if (!res.ok) {
        let message = `OpenAI-Fehler ${res.status}`;
        let code = "";
        try {
          const err = (await res.json()) as {
            error?: { message?: string; code?: string; type?: string };
            message?: string;
          };
          message = err.error?.message ?? err.message ?? message;
          code = err.error?.code ?? err.error?.type ?? "";
        } catch {
          /* noop */
        }
        if (
          code === "insufficient_quota" ||
          /no credits|exceeded your current quota/i.test(message)
        )
          throw new Error(`OpenAI-Guthaben aufgebraucht. ${message}`);
        if (res.status === 402) throw new Error(`OpenAI-Guthaben aufgebraucht. ${message}`);
        throw new Error(message);
      }
      return { probability: probabilityFrom((await res.json()) as DecisionsResponse) };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Guthaben") || msg.includes("OPENAI_API_KEY") || msg.includes("403")) {
        throw err instanceof Error ? err : new Error("Decisions-Aufruf fehlgeschlagen");
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return { probability: null };
}
