/**
 * Search reaches a page from both languages.
 *
 * The acceptance claim is specific: an author who only knows the SDK's names
 * finds the page, and so does an author who only knows the PDXScript keys. The
 * cases below are written as the two vocabularies rather than as index
 * internals, because that is the claim.
 *
 * Each page brings its own two vocabularies; the structural assertions are the
 * same for all of them.
 */

import { describe, expect, it } from "vitest";

import { pageById, PAGES } from "../src/build/pages.ts";
import { readSnapshot } from "../src/build/snapshot.ts";
import { buildSearchIndex, scopeOptions, search } from "../src/search.ts";

/** The two spellings of the same thing, per page. */
const VOCABULARIES: Readonly<Record<string, { sdk: readonly string[]; pdx: readonly string[] }>> = {
  situations: {
    sdk: ["situationType", "monthlyProgress", "startSituation", "targetScope", "sectionWeight"],
    pdx: [
      "situation_type",
      "monthly_progress",
      "start_situation",
      "section_weight",
      "on_progress_complete",
    ],
  },
  technology: {
    sdk: ["technologySwap", "prereqforDesc", "weightModifier", "aiWeight", "costPerLevel"],
    pdx: [
      "technology_swap",
      "prereqfor_desc",
      "weight_modifier",
      "ai_weight",
      "mod_weight_if_group_picked",
    ],
  },
};

describe.each(PAGES.map((page) => [page.id, page] as const))("search — %s", (id, page) => {
  const build = readSnapshot(page);
  const index = buildSearchIndex(build);
  const vocabulary = VOCABULARIES[id]!;

  for (const term of [...vocabulary.sdk, ...vocabulary.pdx]) {
    it(`finds something for "${term}"`, () => {
      expect(search(index, term).length, `nothing matched ${term}`).toBeGreaterThan(0);
    });
  }

  it("returns the same order for the same query", () => {
    const once = search(index, "modifier").map((entry) => entry.title);
    expect(once).toEqual(search(index, "modifier").map((entry) => entry.title));
  });

  it("filters by claim status", () => {
    const unresolved = search(index, "", { statuses: ["unresolved-behavior"] });
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every((entry) => entry.status === "unresolved-behavior")).toBe(true);
  });

  it("filters by entry kind", () => {
    const fields = search(index, "modifier", { kinds: ["field"] });
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((entry) => entry.kind === "field")).toBe(true);
  });

  it("every result names a section the page actually renders", () => {
    const sections = new Set(build.sections.map((section) => section.id));
    for (const entry of index) {
      expect(sections.has(entry.sectionId), `${entry.id} points at ${entry.sectionId}`).toBe(true);
    }
  });

  it("sends a field hit to the section that renders the table", () => {
    // Not to the first section, which is where a lost result would land. The
    // table's section is found by which components it renders, so this fails
    // if a page moves the table and nothing notices.
    const table = build.sections.find((section) => section.components.includes("FieldTable"));
    expect(table, "no section renders the field table").toBeDefined();
    const field = index.find((entry) => entry.kind === "field");
    expect(field?.sectionId).toBe(table!.id);
  });

  it("returns nothing for a term no page covers", () => {
    expect(search(index, "hyperlane bore")).toEqual([]);
  });
});

describe("the Situation page's own vocabulary", () => {
  const index = buildSearchIndex(readSnapshot(pageById("situations")));
  const titles = (query: string): string[] => search(index, query).map((entry) => entry.title);

  it("reaches the same field from either spelling", () => {
    expect(titles("monthly_progress")).toContain("monthlyProgress");
    expect(titles("monthlyProgress")).toContain("monthlyProgress");
  });

  it("reaches the page through a game word that is not a symbol", () => {
    expect(search(index, "progress bar").length).toBeGreaterThan(0);
    expect(search(index, "situation log").length).toBeGreaterThan(0);
  });

  it("reaches a field spelled the other way round", () => {
    // The rules type the field `<named_color>`; the game's own directories and
    // CWT keywords are British. A reader who learned the word from either one
    // has to land on the same row.
    expect(titles("colour")).toContain("stages.color");
    expect(titles("color")).toContain("stages.color");
    expect(search(index, "localisation").length).toBeGreaterThan(0);
    expect(search(index, "localization").length).toBeGreaterThan(0);
  });

  it("filters by scope", () => {
    const options = scopeOptions(index);
    expect(options).toContain("situation");
    expect(options).toContain("any");
    const anyScope = search(index, "", { scopes: ["any"] });
    expect(anyScope.map((entry) => entry.title)).toContain("stages.targetModifier");
  });
});

describe("the Technology page's own vocabulary", () => {
  const index = buildSearchIndex(readSnapshot(pageById("technology")));
  const titles = (query: string): string[] => search(index, query).map((entry) => entry.title);

  it("reaches the page through the words a research card uses", () => {
    for (const term of ["research", "tier", "prerequisites", "patchTechnology"]) {
      expect(search(index, term).length, term).toBeGreaterThan(0);
    }
  });

  it("reaches the same field from either spelling", () => {
    expect(titles("prereqfor_desc")).toContain("prereqforDesc");
    expect(titles("prereqforDesc")).toContain("prereqforDesc");
  });

  it("finds the Recipe story by what it is rather than by its id", () => {
    expect(search(index, "recipe").length).toBeGreaterThan(0);
  });

  it("filters by scope, and country is the one every clause is in", () => {
    expect(scopeOptions(index)).toContain("country");
    const country = search(index, "", { scopes: ["country"] });
    expect(country.map((entry) => entry.title)).toContain("potential");
  });
});
