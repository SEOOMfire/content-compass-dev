/**
 * Tests für scripts/content-index-lib.mjs. Ausführen: bun test
 */
import { describe, expect, test } from "bun:test";
import {
  buildPayload,
  classifyContentType,
  filterContentUrl,
  hashPayload,
  isContentSitemapUrl,
  robotsSitemapUrls,
  sitemapIndexEntriesFromXml,
  urlsetEntriesFromXml,
} from "../scripts/content-index-lib.mjs";

const CH_MARKET = { magazine_root: "/fr/magazine/" };

describe("filterContentUrl", () => {
  test("erlaubt Magazin-URLs unter magazine_root", () => {
    expect(filterContentUrl("https://fressnapf.ch/fr/magazine/hund/barbet/", CH_MARKET)).toBe(true);
  });

  test("verwirft URLs außerhalb des Magazin-Roots", () => {
    expect(filterContentUrl("https://fressnapf.ch/fr/produkte/hund/", CH_MARKET)).toBe(false);
    expect(filterContentUrl("https://fressnapf.ch/fr/", CH_MARKET)).toBe(false);
  });

  test("verwirft Shop-/Kategorie-Pfade", () => {
    expect(filterContentUrl("https://fressnapf.ch/fr/magazine/category/hund/", CH_MARKET)).toBe(
      false,
    );
    expect(
      filterContentUrl("https://fressnapf.ch/fr/magazine/hund/product/barbet/", CH_MARKET),
    ).toBe(false);
    expect(filterContentUrl("https://fressnapf.ch/fr/magazine/search?q=x", CH_MARKET)).toBe(false);
  });
});

describe("classifyContentType", () => {
  test("Kategorie-Übersicht (Tiefe 1) ist hub", () => {
    expect(classifyContentType("/fr/magazine/hund/", "/fr/magazine/", 500)).toBe("hub");
  });

  test("Artikel (Tiefe 2) ist ratgeber", () => {
    expect(classifyContentType("/fr/magazine/hund/barbet/", "/fr/magazine/", 500)).toBe("ratgeber");
  });

  test("kurze Artikel (< 250 Wörter) sind hub", () => {
    expect(classifyContentType("/fr/magazine/hund/barbet/", "/fr/magazine/", 100)).toBe("hub");
  });
});

describe("buildPayload", () => {
  test("H1 + Meta + Überschriften als ## + Fließtext", () => {
    const payload = buildPayload({
      h1: "Le Barbet",
      metaDescription: "Tout sur le barbet",
      blocks: [
        { kind: "heading", level: 2, text: "Soins" },
        { kind: "text", text: "Brossez le chien." },
        { kind: "heading", level: 3, text: "Régime" },
      ],
    });
    expect(payload).toBe(
      "Le Barbet\n\nTout sur le barbet\n\n## Soins\n\nBrossez le chien.\n\n### Régime",
    );
  });

  test("leere Felder entfallen", () => {
    expect(buildPayload({})).toBe("");
  });
});

describe("hashPayload", () => {
  test("sha256-Hex, deterministisch", () => {
    const a = hashPayload("x");
    const b = hashPayload("x");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(hashPayload("y"));
  });
});

describe("Sitemap-Parsing", () => {
  test("isContentSitemapUrl", () => {
    expect(isContentSitemapUrl("https://x/sitemap-content-fr.xml", "fr")).toBe(true);
    expect(isContentSitemapUrl("https://x/sitemap-content-fr.xml", "de")).toBe(false);
    expect(isContentSitemapUrl("https://x/sitemap.xml", null)).toBe(false);
  });

  test("sitemapIndexEntriesFromXml", () => {
    const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://x/a.xml</loc></sitemap><sitemap><loc>https://x/b.xml</loc></sitemap></sitemapindex>`;
    expect(sitemapIndexEntriesFromXml(xml)).toEqual(["https://x/a.xml", "https://x/b.xml"]);
  });

  test("urlsetEntriesFromXml", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://x/1</loc><lastmod>2026-09-03</lastmod></url><url><loc>https://x/2</loc></url></urlset>`;
    expect(urlsetEntriesFromXml(xml)).toEqual([
      { loc: "https://x/1", lastmod: "2026-09-03" },
      { loc: "https://x/2", lastmod: null },
    ]);
  });

  test("robotsSitemapUrls", () => {
    expect(
      robotsSitemapUrls("User-agent: *\nSitemap: https://x/sitemap.xml\nSitemap: https://x/s2.xml"),
    ).toEqual(["https://x/sitemap.xml", "https://x/s2.xml"]);
  });
});
