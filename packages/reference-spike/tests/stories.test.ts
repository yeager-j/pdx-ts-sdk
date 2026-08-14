/**
 * The stories' independent freshness gate.
 *
 * Typecheck, build and synthesize are three separate promises. The first is the
 * repository's own `npm run typecheck`, which compiles the extracted modules as
 * part of the root program — that is the whole reason they are committed rather
 * than generated into a scratch directory. This file makes the other two, and
 * checks the extraction itself is current, because a story that has drifted
 * from its source is a page showing code nothing ran.
 *
 * The assertions about output are narrow and specific: the things each page
 * claims a family of small stories can show that one big example cannot.
 */

import { describe, expect, it } from "vitest";

import { parsePage } from "../src/build/mdx.ts";
import { pageById, PAGES, type ReferencePage } from "../src/build/pages.ts";
import { checkStories, rootIndexIsStale, storySourcesOf } from "../src/build/stories.ts";
import { storyWarnings, synthesizeStories } from "../src/example/synthesize.ts";

const outputs = Object.fromEntries(PAGES.map((page) => [page.id, synthesizeStories(page.id)]));

function definitionFile(page: ReferencePage, story: string, directory: string): string {
  const files = outputs[page.id]?.[story] ?? {};
  const found = Object.entries(files).find(([path]) => path.startsWith(directory));
  expect(found, `story "${story}" wrote no file under ${directory}`).toBeDefined();
  return found![1];
}

const situations = pageById("situations");
const technology = pageById("technology");
const situationFile = (story: string) => definitionFile(situations, story, "common/situations/");
const technologyFile = (story: string) => definitionFile(technology, story, "common/technology/");

describe("the page index is current", () => {
  it("names exactly the pages that exist", () => {
    expect(rootIndexIsStale(PAGES)).toBe(false);
  });
});

describe.each(PAGES.map((page) => [page.id, page] as const))("extraction — %s", (id, page) => {
  it("every committed story module matches its source", () => {
    const { stale } = checkStories(page);
    expect(
      stale,
      "the sources and the extracted modules disagree — run `npm run stories -w @pdx-ts/reference-spike`"
    ).toEqual([]);
  });

  it("every source became a story the page can render", () => {
    const sources = storySourcesOf(page);
    expect(Object.keys(outputs[id] ?? {}).sort()).toEqual(
      [
        ...sources.fences.map((story) => story.id),
        ...sources.recipes.map((recipe) => recipe.id),
      ].sort()
    );
  });

  it("no story is empty", () => {
    for (const story of parsePage(page).stories) {
      expect(story.code.trim().length, `${story.id} is empty`).toBeGreaterThan(50);
    }
  });

  it("every story synthesizes a descriptor and at least one definition file", () => {
    for (const [story, files] of Object.entries(outputs[id] ?? {})) {
      expect(Object.keys(files), story).toContain("descriptor.mod");
      expect(
        Object.keys(files).some((file) => file.startsWith("common/")),
        story
      ).toBe(true);
    }
  });
});

/**
 * The build's own opinion of every story, which nothing used to read.
 *
 * `mod.warnings` is data rather than console output, so a story could compile,
 * synthesize, render on the page, and still teach something the build already
 * knew was wrong — with the diagnosis sitting in a list no part of this package
 * looked at. Both pages had one. The Technology page wrote English into a
 * localization-key field; the Situation page omitted `descKey` on two
 * `monthlyProgress` rows, which keys their text by a hash of itself and
 * orphans any translation the moment somebody rewords the sentence.
 *
 * Held at zero for every page, deliberately, rather than pinned to a reviewed
 * set. A documentation page is the wrong place to demonstrate a pattern the SDK
 * complains about: prose can describe the mistake, and the Situation page now
 * does, but the code a reader copies should be code the build is happy with.
 */
describe("what the fold said about each story", () => {
  it.each(PAGES.map((page) => page.id))("no %s story warns", (pageId) => {
    const warned = Object.entries(storyWarnings(pageId)).filter(
      ([, entries]) => entries.length > 0
    );
    expect(
      Object.fromEntries(warned),
      "the build diagnosed a story this page displays — fix the story, or describe the problem " +
        "in prose instead of shipping code that trips it"
    ).toEqual({});
  });
});

describe("the Situation stories show what the page claims they show", () => {
  it("two stages write one container, entries in source order", () => {
    const file = situationFile("stages");
    expect(file.match(/^\tstages = \{$/gm)).toHaveLength(1);
    const inside = file.slice(file.indexOf("\tstages = {"));
    expect(inside.indexOf("tide_swell_calm = {")).toBeLessThan(
      inside.indexOf("tide_swell_surge = {")
    );
  });

  it("two approaches write the key twice, each carrying its own name", () => {
    const file = situationFile("approaches");
    expect(file.match(/^\tapproach = \{$/gm)).toHaveLength(2);
    expect(file).toContain("name = bloom_algae_harvest");
    expect(file).toContain("name = bloom_algae_purge");
    expect(file.indexOf("bloom_algae_harvest")).toBeLessThan(file.indexOf("bloom_algae_purge"));
  });

  it("stage and approach keys each generate their own localization pair", () => {
    const localization = Object.entries(outputs["situations"]?.["stages"] ?? {}).find(([path]) =>
      path.startsWith("localisation/")
    )?.[1];
    for (const id of ["tide_swell_calm", "tide_swell_surge"]) {
      expect(localization, `${id} name`).toContain(`\n ${id}:0 "`);
      expect(localization, `${id} desc`).toContain(`\n ${id}_desc:0 "`);
    }
  });

  it("each monthlyProgress modifier row gets a generated localization key", () => {
    const file = situationFile("progress");
    expect(file.match(/desc = rust_situation_type_decay_monthly_progress_\w+/g)).toHaveLength(2);
  });

  it("the typed start site writes the declared target and nothing for targetScope", () => {
    const files = outputs["situations"]?.["typed-start"] ?? {};
    const events = Object.entries(files).find(([path]) => path.startsWith("events/"))?.[1] ?? "";
    expect(events).toContain("start_situation = {");
    expect(events).toContain("target = event_target:drift_drifting_world");
    expect(situationFile("typed-start")).not.toContain("target_scope");
  });

  it("the minimal story really is minimal", () => {
    const file = situationFile("minimal");
    expect(file).toContain("monthly_progress = {");
    expect(file).not.toContain("stages");
    expect(file).not.toContain("approach");
  });

  it("the section-weights story compiles the mode nobody can verify", () => {
    // Deliberately asserting only that it emits. The page says the build has
    // no opinion about whether this is correct; a test that claimed otherwise
    // would be the page lying through its gate.
    const file = situationFile("section-weights");
    expect(file).toContain("total_progress = {");
    expect(file).toContain("section_weight = {");
    expect(file).not.toContain("end = ");
  });
});

describe("the Technology stories show what the page claims they show", () => {
  it("the Recipe story is the Catalog's bytes, and they build", () => {
    const file = technologyFile("recipe-starter");
    // The capability came from `#mod`, so the ids carry the spike's prefix
    // rather than anything the Recipe chose — which is exactly the split the
    // page describes: a Recipe writes content, a project decides identity.
    expect(file).toContain("ember_tech_filament_weaving = {");
    expect(file).toContain("\tarea = physics\n");
    expect(file).toContain("\tcost = 2000\n");
    // The commented-out example lines are comments and reach no output.
    expect(file).not.toContain("prerequisites");
  });

  it("the minimal story writes only the three keys the rules demand", () => {
    const file = technologyFile("minimal");
    expect(file).toContain("lumen_tech_optics = {");
    for (const key of ["area", "tier", "category"]) {
      expect(file, key).toContain(`\t${key} = `);
    }
    // No cost: the story is the page's evidence that the surface accepts a
    // technology the rules would have asked one of.
    expect(file).not.toContain("cost");
  });

  it("prerequisites are a quoted list, and a binding writes its minted id", () => {
    const file = technologyFile("prerequisites");
    expect(file).toContain('"tech_basic_science_lab_1"');
    expect(file).toContain('"deep_tech_lensing"');
    expect(file).toContain('"tech_lasers_2"');
  });

  it("an unlock line becomes a localization key, and a modifier does not", () => {
    const file = technologyFile("unlocks");
    expect(file).toContain("prereqfor_desc = {");
    expect(file).toContain("custom = {");
    expect(file).toContain("modifier = {");
    const localization = Object.entries(outputs["technology"]?.["unlocks"] ?? {}).find(([path]) =>
      path.startsWith("localisation/")
    )?.[1];
    expect(localization).toContain("Reinforced Hull Plating");
  });

  it("a cost block writes the dual's other arm", () => {
    const file = technologyFile("cost-curve");
    expect(file).toContain("cost = {");
    expect(file).toContain("base = 3000");
    expect(file).toContain("factor = 0.75");
  });

  it("the three weights emit as three separate blocks", () => {
    const file = technologyFile("weighting");
    expect(file).toContain("\tweight = 100\n");
    expect(file).toContain("weight_modifier = {");
    expect(file).toContain("ai_weight = {");
  });

  it("a swap repeats the key at the sibling level and carries its own name", () => {
    const file = technologyFile("swap");
    expect(file.match(/^\ttechnology_swap = \{$/gm)).toHaveLength(1);
    expect(file).toContain("name = rite_tech_choral_drive");
    expect(file).toContain("inherit_icon = no");
  });
});
