/**
 * Tests für Schritt 5 (interner Link per hreflang). Ausführen: bun test
 */
import { describe, expect, test } from "bun:test";
import { extractBlocks } from "../src/lib/pipeline/extract.server";
import {
  internalLinks,
  linkDocument,
  matchHreflang,
  parseHreflang,
  validateLinkPatch,
  type FetchPage,
} from "../src/lib/pipeline/links";
import type { PromptCall } from "../src/lib/pipeline/localize";
import { toMarketProfile } from "../src/lib/pipeline/market";
import { renderMarkdown } from "../src/lib/pipeline/render";
import type { Block, LocalizedDoc, SourceDoc } from "../src/lib/pipeline/types";

const AT = toMarketProfile({
  country: "Österreich",
  language: "Deutsch",
  language_variant: "Österreichisches Deutsch",
  locale: "de-AT",
  brand: "Fressnapf",
  domain: "www.fressnapf.at",
  institutions: {},
  forbidden_claims: [],
});

const PL = toMarketProfile({
  country: "Polen",
  language: "Polnisch",
  language_variant: "Standardpolnisch",
  locale: "pl-PL",
  brand: "Maxi Zoo",
  domain: "maxizoo.pl",
  institutions: {},
  forbidden_claims: [],
});

const SOURCE_URL = "https://www.fressnapf.de/magazin/hund/barbet/";

function hreflangPage(alts: Record<string, string>): string {
  const links = Object.entries(alts)
    .map(([lang, href]) => `<link rel="alternate" hreflang="${lang}" href="${href}">`)
    .join("");
  return `<html><head>${links}</head><body><p>x</p></body></html>`;
}

function fakeFetch(pages: Record<string, { status?: number; html?: string }>): {
  fetch: FetchPage;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const p = pages[url];
      if (!p) return { status: 404, finalUrl: url, html: "" };
      return { status: p.status ?? 200, finalUrl: url, html: p.html ?? "<html></html>" };
    },
  };
}

function mockCall(responses: unknown[], seen: Record<string, unknown>[] = []): PromptCall {
  let i = 0;
  return async (vars) => {
    seen.push(vars);
    const data = responses[Math.min(i, responses.length - 1)];
    i++;
    return { data, model: "mock", promptSnapshot: "SNAP", tokensIn: 5, tokensOut: 7 };
  };
}

describe("Schritt 1 · Linkerfassung", () => {
  test("Links werden je Block erfasst, Blocktext bleibt reiner Ankertext", () => {
    const html = `<main>
      <h1>Barbet</h1>
      <p>Mehr zum <a href="/magazin/hund/fellpflege/">Thema <b>Fellpflege</b></a> lesen.</p>
      <ul><li>Siehe <a href="https://www.fressnapf.de/magazin/hund/erziehung/#top">Erziehung</a></li></ul>
      <p>Extern: <a href="https://example.com/x">Beispiel</a> und <a href="mailto:a@b.de">Mail</a></p>
    </main>`;
    const { blocks, links } = extractBlocks(html);
    expect(blocks[1]).toMatchObject({
      type: "paragraph",
      text: "Mehr zum Thema **Fellpflege** lesen.",
    });
    expect(links.map((l) => [l.block_id, l.anchor])).toEqual([
      ["b2", "Thema Fellpflege"],
      ["b3", "Erziehung"],
      ["b4", "Beispiel"],
      ["b4", "Mail"],
    ]);
    const internal = internalLinks(links, SOURCE_URL);
    expect(internal).toEqual([
      {
        block_id: "b2",
        href: "https://www.fressnapf.de/magazin/hund/fellpflege/",
        anchor: "Thema Fellpflege",
      },
      {
        block_id: "b3",
        href: "https://www.fressnapf.de/magazin/hund/erziehung/",
        anchor: "Erziehung",
      },
    ]);
  });

  test("Verweis auf die Seite selbst ist kein Kandidat", () => {
    const internal = internalLinks(
      [{ block_id: "b1", href: "/magazin/hund/barbet#abschnitt", anchor: "oben" }],
      SOURCE_URL,
    );
    expect(internal).toEqual([]);
  });
});

describe("hreflang", () => {
  const alts = parseHreflang(
    hreflangPage({
      "de-DE": "https://www.fressnapf.de/a/",
      de: "https://www.fressnapf.de/a/",
      "de-AT": "https://www.fressnapf.at/a/",
      pl: "https://www.maxizoo.pl/a/",
      "x-default": "https://www.fressnapf.com/a/",
    }),
    "https://www.fressnapf.de/a/",
  );

  test("exakte Locale mit passender Domain", () => {
    expect(matchHreflang(alts, AT)).toEqual({
      hreflang: "de-AT",
      href: "https://www.fressnapf.at/a/",
    });
  });

  test("reiner Sprachcode zählt nur auf der Marktdomain", () => {
    expect(matchHreflang(alts, PL)?.href).toBe("https://www.maxizoo.pl/a/");
    const ch = toMarketProfile({ locale: "de-CH", domain: "fressnapf.ch" });
    expect(matchHreflang(alts, ch)).toBeNull();
  });

  test("Locale auf fremder Domain wird verworfen", () => {
    const wrong = parseHreflang(
      hreflangPage({ "de-AT": "https://www.fressnapf.de/at/a/" }),
      "https://www.fressnapf.de/a/",
    );
    expect(matchHreflang(wrong, AT)).toBeNull();
  });
});

describe("validateLinkPatch", () => {
  const block = {
    id: "b2",
    type: "paragraph",
    text: "Mehr zum Thema **Fellpflege** lesen.",
  } as Block;
  const url = "https://www.fressnapf.at/a/";

  test("akzeptiert genau einen Link bei unverändertem Text", () => {
    const v = validateLinkPatch(
      block,
      { text: `Mehr zum Thema [**Fellpflege**](${url}) lesen.` },
      url,
    );
    expect(v.ok).toBe(true);
  });

  test("lehnt zwei Links, falsche URL oder veränderten Text ab", () => {
    expect(
      validateLinkPatch(
        block,
        { text: `Mehr zum [Thema](${url}) [Fellpflege](${url}) lesen.` },
        url,
      ).ok,
    ).toBe(false);
    expect(
      validateLinkPatch(block, { text: "Mehr zum Thema [Fellpflege](https://x.at/) lesen." }, url)
        .ok,
    ).toBe(false);
    expect(
      validateLinkPatch(block, { text: `Mehr über [Fellpflege](${url}) lesen.` }, url).ok,
    ).toBe(false);
  });
});

describe("linkDocument", () => {
  const blocks: Block[] = [
    { id: "b1", type: "heading", level: 1, text: "Barbet" },
    { id: "b2", type: "paragraph", text: "Mehr zum Thema Fellpflege lesen." },
    { id: "b3", type: "paragraph", text: "Infos zur Erziehung." },
  ];
  const source: SourceDoc = {
    url: SOURCE_URL,
    finalUrl: SOURCE_URL,
    httpStatus: 200,
    title: "Barbet",
    metaDescription: null,
    wordCount: 10,
    blocks,
    links: [
      { block_id: "b1", href: "https://www.fressnapf.de/h/", anchor: "Barbet" },
      { block_id: "b2", href: "https://www.fressnapf.de/fell/", anchor: "Fellpflege" },
      { block_id: "b3", href: "https://www.fressnapf.de/erz/", anchor: "Erziehung" },
    ],
  };
  const localized: LocalizedDoc = {
    meta: { title: "Barbet", meta_description: "", slug: "barbet" },
    blocks: blocks.map((b) => ({ ...b })),
  };

  test("erster Treffer wird genau einmal eingefügt, Überschriften werden übersprungen", async () => {
    const target = "https://www.fressnapf.at/erz/";
    const { fetch, calls } = fakeFetch({
      "https://www.fressnapf.de/fell/": {
        html: hreflangPage({ "de-DE": "https://www.fressnapf.de/fell/" }),
      },
      "https://www.fressnapf.de/erz/": { html: hreflangPage({ "de-AT": target }) },
      [target]: {},
    });
    const seen: Record<string, unknown>[] = [];
    const res = await linkDocument({
      source,
      localized,
      market: AT,
      fetchPage: fetch,
      call: mockCall([{ text: `Infos zur [Erziehung](${target}).` }], seen),
    });
    expect(calls).not.toContain("https://www.fressnapf.de/h/");
    expect(res.linking.chosen).toMatchObject({
      block_id: "b3",
      target_href: target,
      hreflang: "de-AT",
    });
    expect(res.linking.inserted).toBe(true);
    expect(res.linking.checked.map((c) => c.href)).toEqual([
      "https://www.fressnapf.de/fell/",
      "https://www.fressnapf.de/erz/",
    ]);
    expect(seen[0]?.["anchor_de"]).toBe("Erziehung");
    expect(localized.blocks[2]).toMatchObject({ text: "Infos zur Erziehung." });
    const md = renderMarkdown(res.blocks, localized.meta);
    expect(md.match(/\]\(https?:/g)?.length).toBe(1);
    expect(md).toContain(`[Erziehung](${target})`);
  });

  test("ohne Treffer bleibt der Text unverändert", async () => {
    const { fetch } = fakeFetch({});
    const res = await linkDocument({
      source,
      localized,
      market: AT,
      fetchPage: fetch,
      call: mockCall([]),
    });
    expect(res.linking.chosen).toBeNull();
    expect(res.linking.warnings).toEqual([]);
    expect(res.blocks).toEqual(localized.blocks);
  });

  test("fehlerhafte Antwort: Nachfrage, danach Warnung ohne Link", async () => {
    const target = "https://www.fressnapf.at/fell/";
    const { fetch } = fakeFetch({
      "https://www.fressnapf.de/fell/": { html: hreflangPage({ "de-AT": target }) },
      [target]: {},
    });
    const seen: Record<string, unknown>[] = [];
    const res = await linkDocument({
      source,
      localized,
      market: AT,
      fetchPage: fetch,
      call: mockCall([{ text: "Ganz anderer Text." }], seen),
    });
    expect(seen).toHaveLength(2);
    expect(String(seen[1]?.["correction_notes"])).toContain("verändert");
    expect(res.linking.inserted).toBe(false);
    expect(res.linking.warnings).toHaveLength(1);
    expect(res.blocks).toEqual(localized.blocks);
  });

  test("Zeitbudget beendet die hreflang-Prüfung", async () => {
    let t = 0;
    const { fetch, calls } = fakeFetch({});
    const res = await linkDocument({
      source,
      localized,
      market: AT,
      fetchPage: async (url) => {
        t += 60_000;
        return fetch(url);
      },
      call: mockCall([]),
      budgetMs: 50_000,
      now: () => t,
    });
    expect(calls).toHaveLength(1);
    expect(res.linking.notes.some((n) => n.includes("Zeitbudget"))).toBe(true);
    expect(res.linking.chosen).toBeNull();
  });

  test("Altjob ohne Linkdaten ergibt eine Warnung", async () => {
    const { links: _omit, ...legacy } = source;
    const res = await linkDocument({
      source: legacy,
      localized,
      market: AT,
      fetchPage: fakeFetch({}).fetch,
      call: mockCall([]),
    });
    expect(res.linking.warnings[0]).toContain("Schritt 1");
  });
});
