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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format, resolveConfig, type Options } from "prettier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATALOG } from "../src/catalog/index.ts";
import { VANILLA_EXAMPLE_IDS } from "../src/catalog/recipes/technology.ts";
import type { ChoiceQuestion } from "../src/catalog/types.ts";
import { main } from "../src/cli.ts";
import { capture } from "./helpers/capture.ts";
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
  it("has exactly three reachable variants in this release", () => {
    const counts = CATALOG.list().map((summary) => ({
      id: summary.id,
      variants: variants(CATALOG.view(summary.id).questions).length,
    }));
    expect(counts).toEqual([
      { id: "research-quest", variants: 2 },
      { id: "technology", variants: 1 },
    ]);
    expect(counts.reduce((total, recipe) => total + recipe.variants, 0)).toBe(3);
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

describe.each([["one"], ["two"]] as const)("research-quest, answering projects=%s", (projects) => {
  const generated = CATALOG.generate({
    recipeId: "research-quest",
    name: NAME,
    answers: { projects },
  });

  it("names the file after the derived stem", () => {
    expect(generated.stem).toBe(STEM);
    expect(generated.basename).toBe(`${STEM}.ts`);
  });

  it("matches the reviewed golden byte for byte", () => {
    expectGolden(`recipes/research-quest/${projects}.ts`, generated.contents);
  });

  it("renders the same bytes a second time", () => {
    const again = CATALOG.generate({
      recipeId: "research-quest",
      name: NAME,
      answers: { projects },
    });
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
      "builds, and emits every coordinated registry file",
      () => {
        const result = project.build();
        expect(result.status, result.output).toBe(0);

        const chain = `common/event_chains/${PREFIX}_${STEM}.txt`;
        const onActions = `common/on_actions/${PREFIX}_on_actions.txt`;
        const specialProjects = `common/special_projects/${PREFIX}_${STEM}.txt`;
        const events = `events/${PREFIX}_${STEM}.txt`;
        const localization = `localisation/english/${PREFIX}_${STEM}_l_english.yml`;
        expect(project.outFiles()).toEqual([
          chain,
          onActions,
          specialProjects,
          "descriptor.mod",
          events,
          localization,
        ]);

        expect(project.readOut(chain)).toContain(`${PREFIX}_event_chain_${STEM}`);

        const projectsOut = project.readOut(specialProjects);
        if (projects === "one") {
          expect(projectsOut).toContain(`key = ${PREFIX}_special_project_${STEM}\n`);
          expect(projectsOut).not.toContain("same_option_group_as");
        } else {
          expect(projectsOut).toContain(`key = ${PREFIX}_special_project_${STEM}_1`);
          expect(projectsOut).toContain(`key = ${PREFIX}_special_project_${STEM}_2`);
          expect(projectsOut).toContain(
            `same_option_group_as = { ${PREFIX}_special_project_${STEM}_1 }`
          );
        }

        const eventsOut = project.readOut(events);
        expect(eventsOut).toContain(`namespace = ${PREFIX}_${STEM}`);
        expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.1`);
        expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.2`);
        if (projects === "one") {
          expect(eventsOut).not.toContain(`id = ${PREFIX}_${STEM}.3`);
        } else {
          expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.3`);
        }
        expect(eventsOut).toContain("is_triggered_only = yes");
        expect(eventsOut).toContain(`begin_event_chain`);
        expect(eventsOut).toContain(`end_event_chain = ${PREFIX}_event_chain_${STEM}`);

        const onActionsOut = project.readOut(onActions);
        expect(onActionsOut).toContain("on_game_start_country");
        expect(onActionsOut).toContain(`${PREFIX}_${STEM}.1`);

        const localizationOut = project.readOut(localization);
        expect(localizationOut).toContain(NAME);
        expect(localizationOut).toContain("PLACEHOLDER:");
      },
      COMPILER_TIMEOUT
    );
  });
});

/**
 * The manifest is the single placement authority, proved the only way that
 * counts: move `contentDirectory`, run the real command, and build the project.
 *
 * The failure this guards against is the quiet one. `generate` honours the
 * manifest, so a project whose `src/mod.ts` discovered a hard-coded `content/`
 * would take the generated file happily and emit a mod without it — no error,
 * no warning, just a technology that is not in the game.
 */
describe("a project that moved its content directory", () => {
  let project: GoldenProject;
  let exitCode: number;
  let stdout: string;

  beforeAll(async () => {
    project = createGoldenProject();
    const manifestPath = path.join(project.dir, "stellaris-mod.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      contentDirectory: string;
    };
    manifest.contentDirectory = "src/features/generated";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    // The old directory stays, empty, so discovery finding the file is a
    // statement about the manifest rather than about the only directory left.
    const { io, out } = capture(project.dir);
    exitCode = await main(["generate", "technology", NAME, "--yes"], io);
    stdout = out();
  }, COMPILER_TIMEOUT);

  afterAll(() => project?.dispose());

  it("writes into the directory the manifest names", () => {
    expect(exitCode).toBe(0);
    expect(stdout.trim().endsWith(`src/features/generated/${STEM}.ts`)).toBe(true);
    expect(existsSync(path.join(project.dir, `src/features/generated/${STEM}.ts`))).toBe(true);
    expect(existsSync(path.join(project.dir, `src/content/${STEM}.ts`))).toBe(false);
  });

  it(
    "builds it, because discovery reads the same field",
    () => {
      const result = project.build();
      expect(result.status, result.output).toBe(0);
      expect(project.outFiles()).toContain(`common/technology/${PREFIX}_${STEM}.txt`);
    },
    COMPILER_TIMEOUT
  );
});

/**
 * "Uncomment-ready" is a promise the curated starter policy makes, and it is
 * exactly the kind of promise that rots: an example naming a file that does not
 * exist reads fine and breaks the first author who takes it up. So the examples
 * are uncommented mechanically and put through the same compiler the
 * as-generated file passes. The golden stays the as-generated bytes; this is a
 * second program built from them.
 */
describe("the commented examples", () => {
  let project: GoldenProject;

  beforeAll(() => {
    project = createGoldenProject();
  });

  afterAll(() => project?.dispose());

  it(
    "compile as written, once their `// ` is removed",
    () => {
      const generated = CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} });
      const { source, uncommented } = uncomment(generated.contents, ["prerequisites", "weight"]);
      expect(uncommented, "both examples must actually have been uncommented").toEqual([
        "prerequisites",
        "weight",
      ]);

      project.place(generated.basename, source);
      const result = project.typecheck();
      expect(result.output).toBe("");
      expect(result.status).toBe(0);
    },
    COMPILER_TIMEOUT
  );

  it.each([["one"], ["two"]] as const)(
    "compile as written in research-quest projects=%s, once their `// ` is removed",
    (projects) => {
      const generated = CATALOG.generate({
        recipeId: "research-quest",
        name: NAME,
        answers: { projects },
      });
      const { source, uncommented } = uncomment(generated.contents, ["timelimit"]);
      expect(uncommented, "the example must actually have been uncommented").toEqual(["timelimit"]);

      project.place(generated.basename, source);
      const result = project.typecheck();
      expect(result.output).toBe("");
      expect(result.status).toBe(0);
    },
    COMPILER_TIMEOUT
  );
});

/**
 * Strips the leading `// ` from every commented field line, and reports which
 * fields it found — an example that stopped matching would otherwise turn this
 * gate into a second compile of the unmodified file.
 */
function uncomment(
  source: string,
  fields: readonly string[]
): { source: string; uncommented: string[] } {
  const uncommented: string[] = [];
  const pattern = new RegExp(`^(\\s*)// ((?:${fields.join("|")}):.*)$`);
  const lines = source.split("\n").map((line) => {
    const match = pattern.exec(line);
    if (match === null) {
      return line;
    }
    uncommented.push(match[2]!.split(":")[0]!);
    return `${match[1]}${match[2]}`;
  });
  return { source: lines.join("\n"), uncommented };
}

/**
 * A vanilla id in a curated example is a fact about the game restated inside
 * this package, and a restated fact gets a sync gate. The compiler cannot help
 * here: `prerequisites` takes a plain string for exactly the reason that makes
 * an intentional vanilla reference expressible, so a dead id typechecks and
 * builds and only fails when the game silently ignores the technology.
 *
 * Read as text rather than imported: `packages/stellaris-ids` is outside this
 * program on purpose — its module augmentation is global — and this needs the
 * committed bytes, not the types.
 */
describe("the vanilla ids the examples cite", () => {
  const ID_REGISTRIES = path.resolve(import.meta.dirname, "../../stellaris-ids/src/registries");

  const cited = Object.entries(VANILLA_EXAMPLE_IDS).flatMap(([registry, ids]) =>
    ids.map((id) => [registry, id] as const)
  );

  it.each(cited)("%s: %s is still cited by the recipe, and still exists", (registry, id) => {
    // Both directions. A declared id nothing renders would make the check below
    // pass forever on an example no author will ever read.
    const generated = CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} });
    expect(
      generated.contents,
      `${id} is declared in VANILLA_EXAMPLE_IDS but appears nowhere in the generated source`
    ).toContain(id);

    const registryFile = path.join(ID_REGISTRIES, `${registry}.ts`);
    expect(
      readFileSync(registryFile, "utf8"),
      `${id} is no longer in packages/stellaris-ids/src/registries/${registry}.ts. That package ` +
        `is regenerated from an install, so an id leaving it means the game dropped or renamed ` +
        `it — the curated example in src/catalog/recipes/technology.ts needs re-reviewing ` +
        `against the current game, not silently repointing at whatever is nearby.`
    ).toContain(`"${id}"`);
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

  it(
    "fails on a generated research-quest call the SDK would refuse",
    () => {
      // The same control for the feature recipe: its file coordinates several
      // registries, so this proves the compiler sees that file too.
      const good = CATALOG.generate({
        recipeId: "research-quest",
        name: NAME,
        answers: { projects: "two" },
      });
      const bad = good.contents.replace(
        'eventScope: "country_event"',
        'eventScope: "cabbage_event"'
      );
      expect(bad, "the mutation must actually have applied").not.toBe(good.contents);

      project.place(good.basename, bad);
      const result = project.typecheck();
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("cabbage_event");
    },
    COMPILER_TIMEOUT
  );
});
