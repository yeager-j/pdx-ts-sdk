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
 * the generated source is *correct* rather than merely well-shaped — and the
 * negative control at the bottom is what proves they would have noticed.
 */

import path from "node:path";
import { format, resolveConfig, type Options } from "prettier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATALOG } from "../src/catalog/index.ts";
import type { ChoiceQuestion } from "../src/catalog/types.ts";
import { createGoldenProject, type GoldenProject } from "./helpers/golden-project.ts";
import { expectGolden } from "./helpers/goldens.ts";

/** Long enough to run `tsc` over the SDK's sources on a cold cache. */
const COMPILER_TIMEOUT = 180_000;

const NAME = "Resonance Theory";
const STEM = "resonance_theory";
const PREFIX = "golden_mod";

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

/**
 * Prettier in-process, against this repository's own configuration. The
 * `filepath` is a hint rather than a read: it selects the TypeScript parser and
 * decides which `.prettierrc` applies, which is the whole point — the promise is
 * about *this* configuration, not about Prettier's defaults.
 */
async function prettier(source: string): Promise<string> {
  const filepath = path.resolve(import.meta.dirname, "../src/catalog/recipes/technology.ts");
  const config = (await resolveConfig(filepath)) ?? {};
  return format(source, { ...config, filepath } satisfies Options);
}

describe("the source matrix", () => {
  it("has exactly one reachable variant in this release", () => {
    const counts = CATALOG.list().map((summary) => ({
      id: summary.id,
      variants: variants(CATALOG.view(summary.id).questions).length,
    }));
    expect(counts).toEqual([{ id: "technology", variants: 1 }]);
    expect(counts.reduce((total, recipe) => total + recipe.variants, 0)).toBe(1);
  });
});

describe("technology, with its only answer set", () => {
  const generated = CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} });

  it("names the file after the derived stem", () => {
    expect(generated.stem).toBe(STEM);
    expect(generated.basename).toBe(`${STEM}.ts`);
  });

  it("matches the reviewed golden byte for byte", () => {
    expectGolden("recipes/technology/default.ts", generated.contents);
  });

  it("renders the same bytes a second time", () => {
    const again = CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} });
    expect(again.contents).toBe(generated.contents);
  });

  it("is already formatted, so an author's first `npm run format` is a no-op", async () => {
    expect(await prettier(generated.contents)).toBe(generated.contents);
  });

  it("ends with exactly one newline and carries no trailing whitespace", () => {
    expect(generated.contents.endsWith("\n")).toBe(true);
    expect(generated.contents.endsWith("\n\n")).toBe(false);
    expect(generated.contents.split("\n").filter((line) => /\s$/.test(line))).toEqual([]);
  });

  describe("in a real project", () => {
    let project: GoldenProject;

    beforeAll(() => {
      project = createGoldenProject();
      project.place(generated.basename, generated.contents);
    }, COMPILER_TIMEOUT);

    afterAll(() => project?.dispose());

    it(
      "typechecks against the real SDK surface",
      () => {
        const result = project.typecheck();
        expect(result.output).toBe("");
        expect(result.status).toBe(0);
      },
      COMPILER_TIMEOUT
    );

    it(
      "builds, and emits the technology and its localization",
      () => {
        const result = project.build();
        expect(result.status, result.output).toBe(0);

        const technology = `common/technology/${PREFIX}_${STEM}.txt`;
        const localization = `localisation/english/${PREFIX}_${STEM}_l_english.yml`;
        expect(project.outFiles()).toEqual([technology, "descriptor.mod", localization]);
        expect(project.readOut(technology)).toContain(`${PREFIX}_tech_${STEM}`);
        expect(project.readOut(localization)).toContain(NAME);
      },
      COMPILER_TIMEOUT
    );
  });
});

describe("the compiler gate", () => {
  let project: GoldenProject;

  beforeAll(() => {
    project = createGoldenProject();
  });

  afterAll(() => project?.dispose());

  it(
    "fails on a generated call the SDK would refuse",
    () => {
      // The negative control. Without it, a compiler step that silently stopped
      // seeing the generated file would pass forever, and the matrix above
      // would be proving nothing at all.
      const good = CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} });
      const bad = good.contents.replace('area: "physics"', 'area: "chemistry"');
      expect(bad, "the mutation must actually have applied").not.toBe(good.contents);

      project.place(good.basename, bad);
      const result = project.typecheck();
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("chemistry");
    },
    COMPILER_TIMEOUT
  );
});
