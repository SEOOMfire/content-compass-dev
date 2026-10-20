/**
 * Regressionstests der vereinfachten 4-Schritt-Pipeline
 * (extract → scan → localize → review). Prüft Struktur, Validierung und
 * Verdrahtung – nicht die Prompt-Qualität. Ausführen: bun test
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBlocks, cleanHeadingText } from "../src/lib/pipeline/extract.server";
import { renderMarkdown } from "../src/lib/pipeline/render";
import {
  blockSyntaxProblem,
  deterministicChecks,
  removableBlockIds,
  validateBlockPatch,
} from "../src/lib/pipeline/validate";
import {
  chunkBlocks,
  localizeDocument,
  LocalizeError,
  slugify,
  type PromptCall,
} from "../src/lib/pipeline/localize";
import { normalizeFindings } from "../src/lib/pipeline/scan";
import { reviewDocument } from "../src/lib/pipeline/review";
import { dependencyBlocker } from "../src/lib/pipeline/deps";
import { toMarketProfile, type MarketProfile } from "../src/lib/pipeline/market";
import {
  isLegacyContext,
  PIPELINE,
  type Block,
  type Finding,
  type LocalizedBlock,
} from "../src/lib/pipeline/types";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

const PL: MarketProfile = toMarketProfile({
  country: "Polen",
  language: "Polnisch",
  language_variant: "Standardpolnisch",
  locale: "pl-PL",
  brand: "Maxi Zoo",
  address_form: "informell",
  institutions: {
    VDH: "ZKwP (Związek Kynologiczny w Polsce)",
    Hundefuehrerschein: null,
    Brauchbarkeitspruefung: "próby pracy / Polski Związek Łowiecki",
  },
  forbidden_claims: ["Fressnapf"],
  localization_notes: null,
  closing_note: null,
});

const CH_DE: MarketProfile = toMarketProfile({
  country: "Schweiz",
  language: "Deutsch",
  language_variant: "Schweizer Hochdeutsch, kein „ß“",
  locale: "de-CH",
  brand: "Fressnapf",
  address_form: "informell",
  institutions: { VDH: "SKG", Hundefuehrerschein: null },
  forbidden_claims: ["ß"],
  closing_note: "Hinweis CH",
});

function mockCall(responses: unknown[], seen: Record<string, unknown>[] = []): PromptCall {
  let i = 0;
  return async (vars) => {
    seen.push(vars);
    const data = responses[Math.min(i, responses.length - 1)];
    i++;
    return { data, model: "mock", promptSnapshot: "SNAP", tokensIn: 10, tokensOut: 20 };
  };
}

// ---------------------------------------------------------------------------
// Schritt 1 · Extraktion
// ---------------------------------------------------------------------------

describe("extract · synthetisches Fixture", () => {
  const { title, metaDescription, blocks } = extractBlocks(fixture("synthetic.html"));

  test("Meta wird gelesen", () => {
    expect(title).toBe("Testartikel | FRESSNAPF");
    expect(metaDescription).toBe("Synthetisches Fixture für die Extraktion.");
  });

  test("erwartete Blockliste (Typen, Level, Reihenfolge)", () => {
    expect(blocks).toEqual([
      { id: "b1", type: "heading", level: 1, text: "Der Testhund" },
      { id: "b2", type: "paragraph", text: "Ein Testhund im Gras." },
      {
        id: "b3",
        type: "paragraph",
        text: "Der Testhund ist **sehr freundlich** und *verspielt*. Mehr beim VDH.",
      },
      { id: "b4", type: "heading", level: 2, text: "Herkunft" },
      { id: "b5", type: "heading", level: 3, text: "Frühe Geschichte" },
      { id: "b6", type: "paragraph", text: "Erste Zeile zweite Zeile." },
      { id: "b7", type: "heading", level: 4, text: "Gut zu wissen" },
      { id: "b8", type: "paragraph", text: "Ein Text-Div mit **fettem** Inhalt." },
      {
        id: "b9",
        type: "list",
        ordered: true,
        items: [
          { text: "Erster Schritt" },
          {
            text: "Zweiter Schritt",
            children: [{ text: "Unterpunkt A" }, { text: "Unterpunkt B mit Absatz" }],
          },
          { text: "Dritter Schritt als Absatz" },
        ],
      },
      {
        id: "b10",
        type: "table",
        hasHeader: false,
        rows: [
          ["Größe:", "mittel"],
          ["Gesamt | breit", ""],
          ["Fell:", "lockig<br>dicht"],
        ],
      },
      {
        id: "b11",
        type: "table",
        hasHeader: true,
        rows: [
          ["Merkmal", "Wert"],
          ["Gewicht", "20 kg"],
        ],
      },
      { id: "b12", type: "quote", text: "Ein Hund ist ein **Freund**." },
      { id: "b13", type: "heading", level: 2, text: "Fazit" },
      { id: "b14", type: "paragraph", text: "Ein toller Hund." },
    ]);
  });

  test("Noise entfernt (Script, Navigation, Breadcrumb, Datum, Karussell, Bildnachweis, Footer)", () => {
    const all = JSON.stringify(blocks);
    for (const noise of [
      "Darf nicht erscheinen",
      "Navigation",
      "Startseite",
      "Magazin",
      "Lesedauer",
      "Spielzeuge",
      "Hundepools",
      "stock.adobe.com",
      "© Fressnapf",
      "Weitere Beiträge",
    ]) {
      expect(all).not.toContain(noise);
    }
  });

  test("li > p wird nicht doppelt erfasst", () => {
    const all = JSON.stringify(blocks);
    expect(all.split("Dritter Schritt als Absatz").length - 1).toBe(1);
    expect(all.split("Unterpunkt B mit Absatz").length - 1).toBe(1);
  });

  test("cleanHeadingText entfernt Markdown-Marker", () => {
    expect(cleanHeadingText("## # Titel  ")).toBe("Titel");
  });
});

describe("extract · Barbet (fressnapf.de)", () => {
  const { blocks } = extractBlocks(fixture("barbet.html"));
  const headings = blocks.filter(
    (b): b is Extract<Block, { type: "heading" }> => b.type === "heading",
  );

  test("Struktur beginnt mit H1 und behält H2/H3/H4", () => {
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(headings.some((h) => h.level === 3)).toBe(true);
    expect(headings.find((h) => h.text === "Quellen")?.level).toBe(4);
    expect(headings.find((h) => h.text.startsWith("Bist du auf der Suche"))?.level).toBe(4);
    expect(headings.some((h) => h.text === "Steckbrief Barbet")).toBe(true);
  });

  test("Steckbrief ist eine Tabelle ohne Header mit 2 Spalten", () => {
    const table = blocks.find((b) => b.type === "table");
    expect(table).toBeDefined();
    if (table?.type !== "table") throw new Error("keine Tabelle");
    expect(table.hasHeader).toBe(false);
    expect(table.rows.length).toBeGreaterThan(5);
    expect(table.rows.every((r) => r.length === 2)).toBe(true);
    expect(table.rows[0]).toEqual(["Rasse:", "Barbet (alternativ: Französischer Wasserhund)"]);
  });

  test("Quellen sind eine nummerierte Liste", () => {
    const idx = blocks.findIndex((b) => b.type === "heading" && b.text === "Quellen");
    const next = blocks[idx + 1];
    expect(next).toMatchObject({ type: "list", ordered: true });
  });

  test("Noise entfernt: Datum/Lesedauer, Inhaltsverzeichnis, Karussell, Teaser", () => {
    const all = JSON.stringify(blocks);
    expect(all).not.toContain("Lesedauer");
    expect(all).not.toContain("Spielzeuge für deinen Barbet");
    expect(all).not.toContain("Weitere Themen im Überblick");
    expect(all).not.toContain("Mehr anzeigen");
    expect(headings.some((h) => h.text === "Inhalt")).toBe(false);
  });

  test("keine doppelten Absätze", () => {
    const paragraphs = blocks
      .filter((b) => b.type === "paragraph")
      .map((b) => (b as { text: string }).text);
    expect(new Set(paragraphs).size).toBe(paragraphs.length);
  });

  test("Fettungen bleiben erhalten", () => {
    expect(JSON.stringify(blocks)).toContain("**Brauchbarkeitsprüfung verpflichtend**");
  });

  test("IDs fortlaufend b1…bn", () => {
    expect(blocks.map((b) => b.id)).toEqual(blocks.map((_, i) => `b${i + 1}`));
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("render", () => {
  const { blocks } = extractBlocks(fixture("synthetic.html"));

  test("Snapshot-Markdown", () => {
    const md = renderMarkdown(
      blocks,
      { title: "T", meta_description: "D", slug: "s" },
      { closing_note: "Schluss" },
    );
    expect(md).toBe(
      [
        "**Title:** T  \n**Meta-Description:** D  \n**Slug-Vorschlag:** s",
        "---",
        "# Der Testhund",
        "Ein Testhund im Gras.",
        "Der Testhund ist **sehr freundlich** und *verspielt*. Mehr beim VDH.",
        "## Herkunft",
        "### Frühe Geschichte",
        "Erste Zeile zweite Zeile.",
        "#### Gut zu wissen",
        "Ein Text-Div mit **fettem** Inhalt.",
        "1. Erster Schritt\n2. Zweiter Schritt\n  - Unterpunkt A\n  - Unterpunkt B mit Absatz\n3. Dritter Schritt als Absatz",
        "| Größe: | mittel |\n| --- | --- |\n| Gesamt \\| breit |   |\n| Fell: | lockig<br>dicht |",
        "| Merkmal | Wert |\n| --- | --- |\n| Gewicht | 20 kg |",
        "> Ein Hund ist ein **Freund**.",
        "## Fazit",
        "Ein toller Hund.",
        "Schluss",
      ].join("\n\n") + "\n",
    );
  });

  test("gestrichene Blöcke werden nicht gerendert", () => {
    const md = renderMarkdown(
      [
        { id: "b1", type: "paragraph", text: "bleibt" },
        { id: "b2", type: "paragraph", text: "weg", removed: true },
      ],
      null,
    );
    expect(md).toBe("bleibt\n");
  });
});

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

describe("validate", () => {
  const para: Block = {
    id: "b1",
    type: "paragraph",
    text: "Der Barbet ist ein sehr freundlicher Hund.",
  };
  const list: Block = {
    id: "b2",
    type: "list",
    ordered: false,
    items: [{ text: "eins zwei" }, { text: "drei vier" }],
  };
  const table: Block = {
    id: "b3",
    type: "table",
    hasHeader: false,
    rows: [
      ["Größe:", "mittel"],
      ["Fell:", "lockig"],
    ],
  };
  const opts = { removable: false, sameLanguage: false };

  test("gültiger Absatz wird übernommen", () => {
    const res = validateBlockPatch(para, { text: "Barbet to bardzo przyjazny pies." }, opts);
    expect(res).toEqual({ ok: true, block: { ...para, text: "Barbet to bardzo przyjazny pies." } });
  });

  test("abweichende Tabellenform → Fehler", () => {
    expect(validateBlockPatch(table, { rows: [["Wielkość:", "średni"]] }, opts).ok).toBe(false);
    expect(
      validateBlockPatch(
        table,
        {
          rows: [
            ["Wielkość:", "średni", "x"],
            ["Sierść:", "kręcona"],
          ],
        },
        opts,
      ).ok,
    ).toBe(false);
    expect(
      validateBlockPatch(
        table,
        {
          rows: [
            ["Wielkość:", "średni"],
            ["Sierść:", "kręcona"],
          ],
        },
        opts,
      ).ok,
    ).toBe(true);
  });

  test("zusätzliche Listen-Items → Fehler", () => {
    const res = validateBlockPatch(list, { items: ["jeden dwa", "trzy cztery", "pięć"] }, opts);
    expect(res.ok).toBe(false);
  });

  test("# oder - am Zeilenanfang → Fehler", () => {
    expect(validateBlockPatch(para, { text: "# Barbet to pies" }, opts).ok).toBe(false);
    expect(validateBlockPatch(para, { text: "- Barbet to pies" }, opts).ok).toBe(false);
    expect(validateBlockPatch(para, { text: "Absatz eins\n\nAbsatz zwei" }, opts).ok).toBe(false);
    expect(blockSyntaxProblem("| a | b |")).not.toBeNull();
  });

  test("removed ist für ganze Blöcke immer erlaubt", () => {
    expect(validateBlockPatch(para, { removed: true }, opts)).toEqual({
      ok: true,
      block: { ...para, removed: true },
    });
  });

  test("Listenpunkte dürfen nur bei streichen entfallen", () => {
    expect(validateBlockPatch(list, { items: ["jeden dwa"] }, opts).ok).toBe(false);
    expect(
      validateBlockPatch(list, { items: ["jeden dwa"] }, { ...opts, removable: true }).ok,
    ).toBe(true);
  });

  test("unübersetzter Text → Fehler (außer bei Deutsch als Zielsprache)", () => {
    expect(validateBlockPatch(para, { text: para.text }, opts).ok).toBe(false);
    expect(validateBlockPatch(para, { text: para.text }, { ...opts, sameLanguage: true }).ok).toBe(
      true,
    );
    const short: Block = { id: "b9", type: "heading", level: 2, text: "Barbet" };
    expect(validateBlockPatch(short, { text: "Barbet" }, opts).ok).toBe(true);
  });

  test("falscher Typ / leerer Text → Fehler", () => {
    expect(validateBlockPatch(para, { items: ["x"] }, opts).ok).toBe(false);
    expect(validateBlockPatch(para, { text: "   " }, opts).ok).toBe(false);
  });

  test("removableBlockIds sammelt nur streichen-Funde", () => {
    const findings: Finding[] = [
      {
        id: "f1",
        block_ids: ["b1"],
        de_reference: "x",
        category: "quelle",
        decision: "streichen",
        target_equivalent: null,
        instruction: "",
      },
      {
        id: "f2",
        block_ids: ["b2"],
        de_reference: "y",
        category: "quelle",
        decision: "neutral",
        target_equivalent: null,
        instruction: "",
      },
    ];
    expect([...removableBlockIds(findings)]).toEqual(["b1"]);
  });
});

// ---------------------------------------------------------------------------
// Schritt 2 · Scan
// ---------------------------------------------------------------------------

describe("scan · normalizeFindings", () => {
  const blocks: Block[] = [
    { id: "b1", type: "paragraph", text: "Der VDH empfiehlt das." },
    { id: "b2", type: "paragraph", text: "Für die Zucht ist eine Brauchbarkeitsprüfung nötig." },
    { id: "b3", type: "paragraph", text: "Den Hundeführerschein gibt es in Niedersachsen." },
  ];

  test("unbekannte IDs werden verworfen, institutions hat Vorrang, null → neutral", () => {
    const res = normalizeFindings(
      {
        findings: [
          {
            block_ids: ["b1", "b99"],
            de_reference: "VDH",
            category: "organisation",
            decision: "neutral",
            target_equivalent: null,
            instruction: "",
          },
          {
            block_ids: ["b99"],
            de_reference: "Phantom",
            category: "sonstiges",
            decision: "neutral",
          },
          {
            block_ids: ["b3"],
            de_reference: "Hundeführerschein",
            category: "gesetz",
            decision: "ersetzen",
            target_equivalent: "Erfunden",
          },
          {
            block_ids: ["b2"],
            de_reference: "irgendwas",
            category: "falsch",
            decision: "ersetzen",
            target_equivalent: null,
          },
        ],
      },
      blocks,
      PL,
    );
    expect(res.dropped).toEqual([{ de_reference: "Phantom", reason: "keine gültige Block-ID" }]);
    const vdh = res.findings.find((f) => f.de_reference === "VDH")!;
    expect(vdh).toMatchObject({
      block_ids: ["b1"],
      decision: "ersetzen",
      target_equivalent: "ZKwP (Związek Kynologiczny w Polsce)",
    });
    const hfs = res.findings.find((f) => f.de_reference === "Hundeführerschein")!;
    expect(hfs).toMatchObject({ decision: "neutral", target_equivalent: null });
    const other = res.findings.find((f) => f.de_reference === "irgendwas")!;
    expect(other).toMatchObject({ category: "sonstiges", decision: "neutral" });
  });

  test("fehlende Institutionen aus dem Marktprofil werden ergänzt", () => {
    const res = normalizeFindings({ findings: [] }, blocks, PL);
    expect(res.seeded).toBe(3);
    expect(res.findings.map((f) => [f.de_reference, f.decision, f.block_ids])).toEqual([
      ["VDH", "ersetzen", ["b1"]],
      ["Hundefuehrerschein", "neutral", ["b3"]],
      ["Brauchbarkeitspruefung", "ersetzen", ["b2"]],
    ]);
    expect(res.findings.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
  });

  test("ersetzen/neutral gelten für alle Vorkommen, streichen bleibt auf gemeldete Blöcke beschränkt", () => {
    const doc: Block[] = [
      { id: "b1", type: "heading", level: 2, text: "Das Wasserschwein im Wasser" },
      {
        id: "b2",
        type: "paragraph",
        text: "Im deutschsprachigen Raum heißt es auch Wasserschwein.",
      },
      { id: "b3", type: "list", ordered: false, items: [{ text: "Wasserschweine sind gesellig" }] },
      { id: "b4", type: "paragraph", text: "Infos gibt es beim Amt XY." },
      { id: "b5", type: "paragraph", text: "Auch das Amt XY berät." },
    ];
    const res = normalizeFindings(
      {
        findings: [
          {
            block_ids: ["b2"],
            de_reference: "Wasserschwein",
            category: "sonstiges",
            decision: "ersetzen",
            target_equivalent: "kapibara",
            instruction: "Übliche Bezeichnung verwenden.",
          },
          {
            block_ids: ["b4"],
            de_reference: "Amt XY",
            category: "behoerde",
            decision: "streichen",
            target_equivalent: null,
            instruction: "Streichen.",
          },
        ],
      },
      doc,
      { ...PL, institutions: {} },
    );
    expect(res.findings.find((f) => f.de_reference === "Wasserschwein")!.block_ids).toEqual([
      "b1",
      "b2",
      "b3",
    ]);
    expect(res.findings.find((f) => f.de_reference === "Amt XY")!.block_ids).toEqual(["b4"]);
  });
});

// ---------------------------------------------------------------------------
// Schritt 3 · Lokalisieren (gemockter runPrompt)
// ---------------------------------------------------------------------------

describe("localize · gezielter Retry", () => {
  const blocks: Block[] = [
    { id: "b1", type: "heading", level: 1, text: "Der Barbet im Porträt" },
    { id: "b2", type: "paragraph", text: "Der Barbet ist ein freundlicher Hund mit Bart." },
    {
      id: "b3",
      type: "list",
      ordered: false,
      items: [{ text: "Er schwimmt gern im Wasser" }, { text: "Er braucht viel Bewegung" }],
    },
    { id: "b4", type: "paragraph", text: "Laut VDH gibt es wenige Züchter." },
  ];
  const findings: Finding[] = [
    {
      id: "f1",
      block_ids: ["b4"],
      de_reference: "VDH",
      category: "quelle",
      decision: "streichen",
      target_equivalent: null,
      instruction: "",
    },
  ];

  test("nur fehlerhafte Blöcke werden nachgefragt, Merge korrekt", async () => {
    const seen: Record<string, unknown>[] = [];
    const call = mockCall(
      [
        {
          meta: { title: "Barbet – portret", meta_description: "Opis", slug: "Barbet Portret" },
          blocks: [
            { id: "b1", text: "Barbet w portrecie" },
            { id: "b2", text: "# Barbet to przyjazny pies z brodą." },
            {
              id: "b3",
              items: ["Lubi pływać w wodzie", "Potrzebuje dużo ruchu", "Dodatkowy punkt"],
            },
            { id: "b4", removed: true },
          ],
        },
        {
          blocks: [
            { id: "b2", text: "Barbet to przyjazny pies z brodą." },
            { id: "b3", items: ["Lubi pływać w wodzie", "Potrzebuje dużo ruchu"] },
          ],
        },
      ],
      seen,
    );
    const res = await localizeDocument({
      blocks,
      findings,
      market: PL,
      sourceMeta: { title: "Barbet | FRESSNAPF", metaDescription: "Desc" },
      call,
    });
    expect(seen.length).toBe(2);
    expect(seen[0]!["block_ids"]).toBe("b1, b2, b3, b4");
    expect(seen[1]!["block_ids"]).toBe("b2, b3");
    expect(String(seen[1]!["correction_notes"])).toContain("b2");
    expect(String(seen[1]!["correction_notes"])).toContain("3 statt 2 Listenpunkte");
    expect(seen[1]!["include_meta"]).toBe("nein");
    expect(res.localized.meta).toEqual({
      title: "Barbet – portret",
      meta_description: "Opis",
      slug: "barbet-portret",
    });
    expect(res.localized.blocks).toEqual([
      { id: "b1", type: "heading", level: 1, text: "Barbet w portrecie" },
      { id: "b2", type: "paragraph", text: "Barbet to przyjazny pies z brodą." },
      {
        id: "b3",
        type: "list",
        ordered: false,
        items: [{ text: "Lubi pływać w wodzie" }, { text: "Potrzebuje dużo ruchu" }],
      },
      { ...blocks[3]!, removed: true },
    ]);
    expect(res.retried.map((r) => r.id)).toEqual(["b2", "b3"]);
    expect(res.stats.calls).toBe(2);
  });

  test("nach 2 Nachfragen bleibt der Schritt mit Block-IDs im Fehler", async () => {
    const call = mockCall([
      {
        meta: { title: "t", meta_description: "d", slug: "s" },
        blocks: [{ id: "b1", text: "Barbet w portrecie" }],
      },
    ]);
    let err: unknown;
    try {
      await localizeDocument({
        blocks,
        findings,
        market: PL,
        sourceMeta: { title: null, metaDescription: null },
        call,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LocalizeError);
    expect((err as LocalizeError).failed.map((f) => f.id)).toEqual(["b2", "b3", "b4"]);
    expect((err as LocalizeError).stats.calls).toBe(3);
  });

  test("lange Artikel werden an H2-Grenzen in mehrere Aufrufe geteilt", () => {
    const long = (n: number) => Array.from({ length: n }, () => "wort").join(" ");
    const doc: Block[] = [
      { id: "b1", type: "heading", level: 1, text: "Titel" },
      { id: "b2", type: "paragraph", text: long(50) },
      { id: "b3", type: "heading", level: 2, text: "A" },
      { id: "b4", type: "paragraph", text: long(60) },
      { id: "b5", type: "heading", level: 3, text: "A1" },
      { id: "b6", type: "paragraph", text: long(60) },
      { id: "b7", type: "heading", level: 2, text: "B" },
      { id: "b8", type: "paragraph", text: long(60) },
    ];
    const chunks = chunkBlocks(doc, 130);
    expect(chunks.map((c) => c.map((b) => b.id))).toEqual([
      ["b1", "b2"],
      ["b3", "b4", "b5", "b6"],
      ["b7", "b8"],
    ]);
    expect(chunkBlocks(doc, 10_000).length).toBe(1);
  });

  test("slugify", () => {
    expect(slugify("Barbet: wodny pies – Łódź!")).toBe("barbet-wodny-pies-lodz");
  });
});

// ---------------------------------------------------------------------------
// Schritt 4 · Review
// ---------------------------------------------------------------------------

describe("review", () => {
  const source: Block[] = [
    { id: "b1", type: "heading", level: 2, text: "Größe des Hundes" },
    { id: "b2", type: "paragraph", text: "Der VDH sagt, der Hund ist groß." },
    { id: "b3", type: "table", hasHeader: false, rows: [["Größe:", "mittel"]] },
  ];
  const findings: Finding[] = [
    {
      id: "f1",
      block_ids: ["b2"],
      de_reference: "VDH",
      category: "organisation",
      decision: "ersetzen",
      target_equivalent: "SKG",
      instruction: "",
    },
  ];

  test("CH-de: ß wird ersetzt, Restbestand gemeldet, gültiger KI-Fix übernommen, ungültiger verworfen", async () => {
    const localized = {
      meta: { title: "Grösse", meta_description: "d", slug: "s" },
      blocks: [
        { id: "b1", type: "heading", level: 2, text: "Größe des Hundes" },
        { id: "b2", type: "paragraph", text: "Der VDH sagt, der Hund ist groß." },
        { id: "b3", type: "table", hasHeader: false, rows: [["Größe:", "mittel"]] },
      ] as LocalizedBlock[],
    };
    const call = mockCall([
      {
        issues: [
          {
            block_id: "b2",
            problem: "VDH nicht ersetzt",
            fix: { text: "Die SKG sagt, der Hund ist gross." },
          },
          { block_id: "b3", problem: "Tabelle", fix: { rows: [["Grösse:", "mittel", "extra"]] } },
          { block_id: "b1", problem: "Stil", fix: null },
        ],
      },
    ]);
    const res = await reviewDocument({ source, localized, findings, market: CH_DE, call });
    const md = res.exportMarkdown;
    expect(md).not.toContain("ß");
    expect(md).toContain("## Grösse des Hundes");
    expect(md).toContain("Die SKG sagt, der Hund ist gross.");
    expect(md).toContain("| Grösse: | mittel |");
    expect(md.trimEnd().endsWith("Hinweis CH")).toBe(true);
    expect(res.review.applied).toContain("b2");
    const vdh = res.review.issues.find((i) => i.origin === "code" && i.problem.includes("VDH"));
    expect(vdh?.status).toBe("resolved");
    expect(res.review.issues.find((i) => i.block_id === "b3" && i.origin === "llm")?.status).toBe(
      "rejected",
    );
    expect(res.review.warnings.length).toBe(2);
  });

  test("KI-Fehler blockiert nicht", async () => {
    const localized = {
      meta: { title: "t", meta_description: "d", slug: "s" },
      blocks: source.map((b) => ({ ...b })) as LocalizedBlock[],
    };
    const call: PromptCall = async () => {
      throw new Error("Rate-Limit");
    };
    const res = await reviewDocument({
      source,
      localized,
      findings: [],
      market: { ...CH_DE },
      call,
    });
    expect(res.exportMarkdown).toContain("## Grösse des Hundes");
    expect(res.review.warnings.some((w) => w.includes("KI-Review nicht verfügbar"))).toBe(true);
  });

  test("deterministische Checks: verbotene Begriffe, Marke, Struktur", () => {
    const target: LocalizedBlock[] = [
      { id: "b1", type: "heading", level: 3, text: "Wielkość psa" },
      { id: "b2", type: "paragraph", text: "W sklepie Fressnapf i Maxi Zo znajdziesz karmę." },
      { id: "b3", type: "table", hasHeader: false, rows: [["Wielkość:", "średni"]] },
    ];
    const hits = deterministicChecks(source, target, [], PL).map(
      (h) => `${h.block_id}: ${h.problem}`,
    );
    expect(hits.some((h) => h.startsWith("b1: Überschrift H3 statt H2"))).toBe(true);
    expect(hits.some((h) => h.includes("Fressnapf"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pipeline-Verdrahtung
// ---------------------------------------------------------------------------

describe("pipeline", () => {
  test("genau 6 Schritte in fester Reihenfolge", () => {
    expect(PIPELINE.map((s) => s.key)).toEqual([
      "extract",
      "scan",
      "localize",
      "review",
      "links",
      "semantic_links",
    ]);
    expect(PIPELINE.filter((s) => s.promptKey).map((s) => s.promptKey)).toEqual([
      "localization_scan",
      "localize_document",
      "localization_review",
      "link_integration",
      "semantic_link_keywords",
    ]);
  });

  test("lineare Abhängigkeiten", () => {
    const source = {
      url: "u",
      finalUrl: "u",
      httpStatus: 200,
      title: null,
      metaDescription: null,
      wordCount: 1,
      blocks: [{ id: "b1", type: "paragraph", text: "x" } as Block],
    };
    expect(dependencyBlocker("extract", {})).toBeNull();
    expect(dependencyBlocker("scan", {})).toContain("Schritt 1");
    expect(dependencyBlocker("scan", { source })).toBeNull();
    expect(dependencyBlocker("localize", { source })).toContain("Schritt 2");
    expect(dependencyBlocker("localize", { source, findings: [] })).toBeNull();
    expect(dependencyBlocker("review", { source, findings: [] })).toContain("Schritt 3");
    const localized = {
      meta: { title: "t", meta_description: "", slug: "t" },
      blocks: source.blocks,
    };
    expect(dependencyBlocker("links", { source, findings: [], localized })).toContain("Schritt 4");
    expect(
      dependencyBlocker("links", {
        source,
        findings: [],
        localized,
        review: { issues: [], applied: [], warnings: [] },
        exportMarkdown: "x",
      }),
    ).toBeNull();
    expect(dependencyBlocker("semantic_links", { source, findings: [], localized })).toContain(
      "Schritt 4",
    );
    expect(
      dependencyBlocker("semantic_links", {
        source,
        findings: [],
        localized,
        review: { issues: [], applied: [], warnings: [] },
        exportMarkdown: "x",
      }),
    ).toBeNull();
  });

  test("Altjobs werden erkannt", () => {
    expect(isLegacyContext({})).toBe(false);
    expect(isLegacyContext({ source: { sections: [] }, exportMarkdown: "# alt" })).toBe(true);
    expect(isLegacyContext({ source: { blocks: [] } })).toBe(false);
  });
});
