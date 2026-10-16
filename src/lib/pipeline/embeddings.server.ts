import { EMBEDDING_MODEL } from "./semantic-links.config";

const BASE_URL = (process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1").replace(
  /\/+$/,
  "",
);

function apiKey(): string {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("OPENAI_API_KEY fehlt – OpenAI-API nicht konfiguriert.");
  return key;
}

async function errorMessage(res: Response): Promise<string> {
  let message = `OpenAI-Fehler ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    message = body.error?.message ?? body.message ?? message;
  } catch {
    /* noop */
  }
  return message;
}

/**
 * Ein Embedding-Batch (ein Request). Liefert je Eingabetext einen Vektor der
 * Länge EMBEDDING_DIMENSIONS. Fehler werfen – der Aufrufer entscheidet über
 * die Degradierung.
 */
export async function embedTexts(
  texts: string[],
  model: string = EMBEDDING_MODEL,
): Promise<number[][]> {
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const json = (await res.json()) as {
    data?: { embedding?: number[]; index?: number }[];
  };
  const data = json.data ?? [];
  return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding ?? []);
}
