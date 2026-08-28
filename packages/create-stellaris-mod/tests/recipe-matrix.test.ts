/**
 * Every reachable variant of every recipe, end to end.
 *
 * All questions are static and finite, so "every variant" is the Cartesian
 * product of the choices — enumerable, and asserted by count so a new question
 * cannot quietly widen the matrix past what this file proves.
 *
 * For each variant the chain is: render, compare with the committed golden,
 * render again and require the same bytes, run real Prettier and require the
 * same bytes, then put the file in a real project, run `tsc -p` over it, and
 * execute the project's own build. The last two are the only steps that can say
 * the generated source is *correct* rather than merely well-shaped — and each
 * recipe file's negative controls are what prove they would have noticed.
 *
 * The chain lives in the per-recipe files beside this one —
 * `recipe-matrix-technology`, `-building`, `-event-visible`, `-event-hidden`,
 * and `-research-quest` — so the compile gates spread across Vitest workers
 * instead of forming one serial tail. What stays here is what spans recipes:
 * the variant count that pins the split's coverage, and the sync gates over
 * the vanilla facts the curated examples restate.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { EVENT_KINDS } from "@pdx-ts/sdk/reference";
import { describe, expect, it } from "vitest";

import { CATALOG } from "../src/catalog/index.ts";
import { VANILLA_EXAMPLE_IDS as BUILDING_IDS } from "../src/catalog/recipes/building.ts";
import {
  VANILLA_EXAMPLE_IDS as EVENT_IDS,
  EVENT_KIND_CHOICES,
} from "../src/catalog/recipes/event.ts";
import { VANILLA_EXAMPLE_IDS as RESEARCH_QUEST_IDS } from "../src/catalog/recipes/research-quest.ts";
import {
  VANILLA_EXAMPLE_IDS as TECHNOLOGY_IDS,
  VANILLA_CURATED_VALUES as TECHNOLOGY_VALUES,
} from "../src/catalog/recipes/technology.ts";
import type { ChoiceQuestion } from "../src/catalog/types.ts";
import { NAME } from "./helpers/matrix.ts";

/** Every combination of every question's choices, in question order. */
function variants(questions: readonly ChoiceQuestion[]): Record<string, string>[] {
  return questions.reduce<Record<string, string>[]>(
    (answers, question) =>
      answers.flatMap((answer) =>
        question.choices.map((choice) => ({ ...answer, [question.key]: choice.value }))
      ),
    [{}]
  );
}

describe("the source matrix", () => {
  it("has exactly twelve reachable variants in this release", () => {
    const counts = CATALOG.list().map((summary) => ({
      id: summary.id,
      variants: variants(CATALOG.view(summary.id).questions).length,
    }));
    expect(counts).toEqual([
      { id: "building", variants: 1 },
      { id: "event", variants: 8 },
      { id: "research-quest", variants: 2 },
      { id: "technology", variants: 1 },
    ]);
    expect(counts.reduce((total, recipe) => total + recipe.variants, 0)).toBe(12);
  });
});

/**
 * A vanilla id in a curated example is a fact about the game restated inside
 * this package, and a restated fact gets a sync gate. The compiler cannot help
 * here: `prerequisites` takes a plain string for exactly the reason that makes
 * an intentional vanilla reference expressible, so a dead id typechecks and
 * builds and only fails when the game silently ignores the definition.
 *
 * Read as text rather than imported: this needs the committed bytes of the
 * generated unions, not the types, and the scaffolder has no runtime dependency
 * on the identifier package.
 */
describe("the vanilla ids the examples cite", () => {
  const ID_REGISTRIES = path.resolve(import.meta.dirname, "../../stellaris-ids/src/registries");

  /**
   * Each recipe's declared citations, with the variant whose source has to
   * carry them. The `event` recipe cites only from its visible branch: a hidden
   * event has no window to put media in.
   */
  const CITATIONS: readonly (readonly [
    string,
    Readonly<Record<string, readonly string[]>>,
    Record<string, string>,
  ])[] = [
    ["technology", TECHNOLOGY_IDS, {}],
    ["building", BUILDING_IDS, {}],
    ["event", EVENT_IDS, { visibility: "visible", "event-kind": "country" }],
    ["research-quest", RESEARCH_QUEST_IDS, { projects: "one" }],
  ];

  const cited = CITATIONS.flatMap(([recipeId, ids, answers]) =>
    Object.entries(ids).flatMap(([registry, registryIds]) =>
      registryIds.map((id) => [recipeId, registry, id, answers] as const)
    )
  );

  it.each(cited)("%s cites %s: %s, and it still exists", (recipeId, registry, id, answers) => {
    // Both directions. A declared id nothing renders would make the check below
    // pass forever on an example no author will ever read.
    const generated = CATALOG.generate({ recipeId, name: NAME, answers });
    expect(
      generated.contents,
      `${id} is declared in ${recipeId}'s VANILLA_EXAMPLE_IDS but appears nowhere in the ` +
        `generated source`
    ).toContain(id);

    // `@pdx-ts/stellaris-ids` names its files in kebab-case, splitting camel
    // humps as well as underscores: `spriteType` -> `sprite-type.ts`.
    const stem = registry
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replaceAll("_", "-")
      .toLowerCase();
    const registryFile = path.join(ID_REGISTRIES, `${stem}.ts`);
    expect(
      readFileSync(registryFile, "utf8"),
      `${id} is no longer in packages/stellaris-ids/src/registries/${registry}.ts. That package ` +
        `is regenerated from an install, so an id leaving it means the game dropped or renamed ` +
        `it — the curated example in src/catalog/recipes/${recipeId}.ts needs re-reviewing ` +
        `against the current game, not silently repointing at whatever is nearby.`
    ).toContain(`"${id}"`);
  });
});

describe("the vanilla scalar combinations the examples cite", () => {
  const TECHNOLOGY_CORPUS = path.resolve(
    import.meta.dirname,
    "../../sdk/tests/fixtures/corpus/technology.json"
  );

  it("keeps the technology recipe's tier and cost paired in real definitions", () => {
    const generated = CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} });
    for (const [field, value] of Object.entries(TECHNOLOGY_VALUES)) {
      expect(generated.contents).toContain(`${field}: ${value},`);
    }

    const corpus = JSON.parse(readFileSync(TECHNOLOGY_CORPUS, "utf8")) as {
      scalarTuples?: readonly {
        fields: readonly string[];
        values: readonly string[];
        definitions: number;
      }[];
    };
    const fields = Object.keys(TECHNOLOGY_VALUES);
    const values = Object.values(TECHNOLOGY_VALUES).map(String);
    const evidence = corpus.scalarTuples?.find(
      (tuple) =>
        tuple.fields.length === fields.length &&
        tuple.fields.every((field, index) => field === fields[index]) &&
        tuple.values.every((value, index) => value === values[index])
    );
    expect(
      evidence?.definitions,
      `tier ${TECHNOLOGY_VALUES.tier} and cost ${TECHNOLOGY_VALUES.cost} no longer co-occur in ` +
        "the committed vanilla technology corpus; re-review the recipe rather than preserving " +
        "its field marginals independently"
    ).toBeGreaterThan(0);
  });
});

/**
 * The `event` recipe offers four kinds, and cannot ask the SDK whether they are
 * still four kinds the game has: the CLI carries no runtime SDK dependency and a
 * recipe module is pure, so the mapping is exported as data instead. This is the
 * cross-check that restatement earns — a kind the SDK stops supporting, or
 * renames, fails here rather than in an author's project.
 */
describe("the event kinds the recipe offers", () => {
  const question = CATALOG.view("event").questions.find((each) => each.key === "event-kind");

  it("asks for exactly the kinds the exported table maps", () => {
    expect(question?.choices.map((choice) => choice.value)).toEqual(
      Object.keys(EVENT_KIND_CHOICES)
    );
  });

  it.each(Object.entries(EVENT_KIND_CHOICES))(
    "%s still names the SDK's %s, whose scope is the answer itself",
    (answer, kindKey) => {
      const kinds: Readonly<Record<string, { readonly scope: string | null } | undefined>> =
        EVENT_KINDS;
      const kind = kinds[kindKey];
      expect(kind, `${kindKey} is no longer a kind @pdx-ts/sdk declares`).toBeDefined();
      // The answer is the scope as well as the definer's name, which is what
      // makes `events.<answer>(...)` hand its callbacks that scope object.
      expect(kind?.scope, `${kindKey} no longer runs in ${answer} scope`).toBe(answer);
    }
  );
});
