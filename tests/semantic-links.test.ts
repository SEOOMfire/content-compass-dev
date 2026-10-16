/**
 * Tests für Schritt 6 (semantische interne Verlinkung). Ausführen: bun test
 */
import { describe, expect, test } from "bun:test";
import {
  alreadyLinkedUrls,
  applyLinkingPatch,
  insertLinkIntoBlock,
  insertLinkIntoText,
  semanticLinkDocument,
  type DecideFn,
  type EmbedFn,
  type MatchFn,
} from "../src/lib/pipeline/semantic-links";
import { toMarketProfile } from "../src/lib/pipeline/market";
import type { PromptCall } from "../src/lib/pipeline/localize";
import type { LocalizedBlock, LocalizedDoc } from "../src/lib/pipeline/types";

const CH = toMarketProfile({
  country: "Schweiz",
  language: "Französisch",
  language_variant: "Schweizer Französisch",
  locale: "fr-CH",
  brand: "Fressnapf",
  domain: "fressnapf.ch",
  institutions: {},
  forbidden_claims: [],
});

function doc(blocks: LocalizedBlock[]): LocalizedDoc {
  return { meta: { title: "Le chien", meta_description: "", slug: "le-chien" }, blocks };
}

function baseBlocks(): LocalizedBlock[] {
  return [
    { id: "b1", type: "heading", level: 1, text: "Le chien" },
    { id: "b2", type: "paragraph", text: "La toilette du chien est importante." },
    { id: "b3", type: "paragraph", text: "L'alimentation du chiot doit être équilibrée." },
    { id: "b4", type: "list", ordered: false, items: [{ text: "Choisir la bonne nourriture" }] },
  ];
}

function mockCall(data: unknown): PromptCall {
  return async () => ({ data, model: "mock", promptSnapshot: "SNAP", tokensIn: 3, tokensOut: 5 });
}

const keywordResponse = {
  keywords: [
    { block_id: "b2", keyword: "toilette du chien", intent: "Comment toiletter un chien ?" },
    { block_id: "b3", keyword: "alimentation du chiot", intent: "Comment nourrir un chiot ?" },
    { block_id: "b4", keyword: "bonne nourriture", intent: "Quelle nourriture choisir ?" },
  ],
};

const candidates = [
  {
    url: "https://fressnapf.ch/fr/magazine/soins/",
    title: "Soins",
    similarity: 0.9,
    content_payload: "A",
  },
  {
    url: "https://fressnapf.ch/fr/magazine/nutrition/",
    title: "Nutrition",
    similarity: 0.85,
    content_payload: "B",
  },
];

function matchAll(): MatchFn {
  return async () => candidates;
}

function decideByPayload(map: Record<string, number>): DecideFn {
  return async ({ payload }) => ({ probability: map[payload] ?? null });
}

const embed3: EmbedFn = async () => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

describe("insertLinkIntoText", () => {
  test("erstes Vorkommen außerhalb bestehender Links wird verlinkt", () => {
    expect(insertLinkIntoText("La toilette du chien.", "toilette du chien", "https://x/")).toBe(
      "La [toilette du chien](https://x/).",
    );
  });

  test("überspringt Vorkommen innerhalb bestehender Links", () => {
    const text = "Voir [toilette du chien](https://a/) puis toilette du chien ici.";
    expect(insertLinkIntoText(text, "toilette du chien", "https://b/")).toBe(
      "Voir [toilette du chien](https://a/) puis [toilette du chien](https://b/) ici.",
    );
  });

  test("ohne freies Vorkommen null", () => {
    expect(
      insertLinkIntoText("Voir [toilette du chien](https://a/).", "toilette du chien", "x"),
    ).toBeNull();
  });

  test("Groß-/Kleinschreibung wird erhalten (Anker = Originaltext)", () => {
    expect(insertLinkIntoText("Toilette du chien.", "toilette du chien", "https://x/")).toBe(
      "[Toilette du chien](https://x/).",
    );
  });
});

describe("insertLinkIntoBlock", () => {
  test("setzt in Listenpunkt", () => {
    const block: LocalizedBlock = {
      id: "b4",
      type: "list",
      ordered: false,
      items: [{ text: "Choisir la bonne nourriture" }],
    };
    const out = insertLinkIntoBlock(block, "bonne nourriture", "https://x/");
    expect(out).toMatchObject({
      type: "list",
      items: [{ text: "Choisir la [bonne nourriture](https://x/)" }],
    });
  });

  test("Überschrift/Tabelle werden nicht verlinkt", () => {
    expect(
      insertLinkIntoBlock(
        { id: "b1", type: "heading", level: 1, text: "Le chien" },
        "Le chien",
        "x",
      ),
    ).toBeNull();
  });
});

describe("applyLinkingPatch / alreadyLinkedUrls", () => {
  test("wendet Schritt-5-Block an und meldet dessen URL als verlinkt", () => {
    const blocks = baseBlocks();
    const patched: LocalizedBlock = {
      ...blocks[1]!,
      text: "La [toilette](https://step5/) du chien.",
    };
    const linking = {
      candidates: 1,
      checked: [],
      chosen: {
        block_id: "b2",
        source_href: "https://de/",
        anchor_de: "toilette",
        target_href: "https://step5/",
        hreflang: "fr-CH",
      },
      inserted: true,
      patched_block: patched,
      notes: [],
      warnings: [],
    };
    const out = applyLinkingPatch(doc(blocks), linking);
    expect(out[1]?.text).toContain("https://step5/");
    expect(alreadyLinkedUrls(out, linking)).toContain("https://step5/");
  });
});

describe("semanticLinkDocument", () => {
  test("setzt Links gierig: URL einmal, Score ≥ Schwelle", async () => {
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: CH,
      call: mockCall(keywordResponse),
      embed: embed3,
      matchPages: matchAll(),
      decide: decideByPayload({ A: 0.95, B: 0.6 }),
    });
    // Alle Keywords liefern denselben besten Treffer (A), aber URL nur einmal.
    expect(res.semanticLinking.inserted).toHaveLength(1);
    expect(res.semanticLinking.inserted[0]).toMatchObject({
      block_id: "b2",
      url: "https://fressnapf.ch/fr/magazine/soins/",
    });
    expect(res.blocks[1]?.text).toContain(
      "[toilette du chien](https://fressnapf.ch/fr/magazine/soins/)",
    );
    expect(res.semanticLinking.warnings).toEqual([]);
  });

  test("Threshold: keine Links, wenn alle Scores darunter liegen", async () => {
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: CH,
      call: mockCall(keywordResponse),
      embed: embed3,
      matchPages: matchAll(),
      decide: decideByPayload({ A: 0.5, B: 0.4 }),
      threshold: 0.8,
    });
    expect(res.semanticLinking.inserted).toEqual([]);
    expect(res.semanticLinking.keywords.every((k) => k.chosen === null)).toBe(true);
  });

  test("Dedupe: zweites Keyword im selben Block wird verworfen", async () => {
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: CH,
      call: mockCall({
        keywords: [
          { block_id: "b2", keyword: "toilette du chien", intent: "i1" },
          { block_id: "b2", keyword: "autre chose", intent: "i2" },
        ],
      }),
      embed: async () => [[1, 0, 0]],
      matchPages: matchAll(),
      decide: decideByPayload({ A: 0.9 }),
    });
    expect(res.semanticLinking.keywords).toHaveLength(1);
  });

  test("Keyword muss wörtlich im Block vorkommen", async () => {
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: CH,
      call: mockCall({
        keywords: [{ block_id: "b3", keyword: "mot absent", intent: "i" }],
      }),
      embed: async () => [[1, 0, 0]],
      matchPages: matchAll(),
      decide: decideByPayload({ A: 0.9 }),
    });
    expect(res.semanticLinking.keywords).toEqual([]);
    expect(res.semanticLinking.notes.some((n) => n.includes("Keine gültigen Keywords"))).toBe(true);
  });

  test("Embedding-Fehler ergibt Warnung, blockiert nicht", async () => {
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: CH,
      call: mockCall(keywordResponse),
      embed: async () => {
        throw new Error("embed down");
      },
      matchPages: matchAll(),
      decide: decideByPayload({ A: 0.9 }),
    });
    expect(res.semanticLinking.warnings.some((w) => w.includes("Embedding"))).toBe(true);
    expect(res.semanticLinking.inserted).toEqual([]);
  });

  test("Index-Fehler je Keyword wird als Hinweis geführt", async () => {
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: CH,
      call: mockCall(keywordResponse),
      embed: embed3,
      matchPages: async () => {
        throw new Error("rpc down");
      },
      decide: decideByPayload({ A: 0.9 }),
    });
    expect(res.semanticLinking.inserted).toEqual([]);
    expect(res.semanticLinking.keywords.every((k) => k.note?.includes("Index-Abfrage"))).toBe(true);
  });

  test("Refusal (probability null) ergibt keinen Link", async () => {
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: CH,
      call: mockCall(keywordResponse),
      embed: embed3,
      matchPages: matchAll(),
      decide: async () => ({ probability: null }),
    });
    expect(res.semanticLinking.inserted).toEqual([]);
    expect(
      res.semanticLinking.keywords.every((k) => k.candidates.every((c) => c.probability === null)),
    ).toBe(true);
  });

  test("ohne Locale warnt und bricht ab", async () => {
    const noLocale = toMarketProfile({ locale: null, domain: null });
    const res = await semanticLinkDocument({
      localized: doc(baseBlocks()),
      market: noLocale,
      call: mockCall(keywordResponse),
      embed: embed3,
      matchPages: matchAll(),
      decide: decideByPayload({ A: 0.9 }),
    });
    expect(res.semanticLinking.warnings.some((w) => w.includes("Locale"))).toBe(true);
    expect(res.semanticLinking.inserted).toEqual([]);
  });
});
