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
 * negative controls at the bottom are what prove they would have noticed.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EVENT_KINDS } from "@pdx-ts/sdk";
import { format, resolveConfig, type Options } from "prettier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATALOG } from "../src/catalog/index.ts";
import { VANILLA_EXAMPLE_IDS as BUILDING_IDS } from "../src/catalog/recipes/building.ts";
import {
  VANILLA_EXAMPLE_IDS as EVENT_IDS,
  EVENT_KIND_CHOICES,
} from "../src/catalog/recipes/event.ts";
import {
  VANILLA_EXAMPLE_IDS as TECHNOLOGY_IDS,
  VANILLA_CURATED_VALUES as TECHNOLOGY_VALUES,
} from "../src/catalog/recipes/technology.ts";
import type { ChoiceQuestion, GeneratedFeatureSource } from "../src/catalog/types.ts";
import { main } from "../src/cli.ts";
import { capture } from "./helpers/capture.ts";
import { createGoldenProject, type GoldenProject } from "./helpers/golden-project.ts";
import { expectGolden } from "./helpers/goldens.ts";

/** Long enough to run `tsc` over the SDK's sources on a cold cache. */
const COMPILER_TIMEOUT = 180_000;

const NAME = "Resonance Theory";
const STEM = "resonance_theory";
const PREFIX = "golden_mod";
const MATERIALIZATION_MANIFEST = ".pdx-sdk-manifest.json";

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

/**
 * The bytes-level chain every variant runs before any compiler sees it.
 *
 * Shared rather than restated per recipe: twelve variants asserting the same
 * five things in twelve wordings is twelve places for one of them to go quietly
 * missing, and the per-recipe difference that matters — what the build has to
 * emit — is asserted where it belongs, below each recipe's own describe.
 */
function describeSource(golden: string, generate: () => GeneratedFeatureSource): void {
  const generated = generate();

  it("names the file after the derived stem", () => {
    expect(generated.stem).toBe(STEM);
    expect(generated.basename).toBe(`${STEM}.ts`);
  });

  it("matches the reviewed golden byte for byte", () => {
    expectGolden(golden, generated.contents);
  });

  it("renders the same bytes a second time", () => {
    expect(generate().contents).toBe(generated.contents);
  });

  it("is already formatted, so an author's first `npm run format` is a no-op", async () => {
    expect(await prettier(generated.contents)).toBe(generated.contents);
  });

  it("ends with exactly one newline and carries no trailing whitespace", () => {
    expect(generated.contents.endsWith("\n")).toBe(true);
    expect(generated.contents.endsWith("\n\n")).toBe(false);
    expect(generated.contents.split("\n").filter((line) => /\s$/.test(line))).toEqual([]);
  });
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

describe("technology, with its only answer set", () => {
  const generate = (): GeneratedFeatureSource =>
    CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} });
  const generated = generate();

  describeSource("recipes/technology/default.ts", generate);

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
        expect(project.outFiles()).toEqual([
          MATERIALIZATION_MANIFEST,
          technology,
          "descriptor.mod",
          localization,
        ]);
        expect(project.readOut(technology)).toContain(`${PREFIX}_tech_${STEM}`);
        expect(project.readOut(localization)).toContain(NAME);
      },
      COMPILER_TIMEOUT
    );
  });
});

describe("building, with its only answer set", () => {
  const generate = (): GeneratedFeatureSource =>
    CATALOG.generate({ recipeId: "building", name: NAME, answers: {} });
  const generated = generate();

  describeSource("recipes/building/default.ts", generate);

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
      "builds, and emits the building, its economy block, and its localization",
      () => {
        const result = project.build();
        expect(result.status, result.output).toBe(0);

        const building = `common/buildings/${PREFIX}_${STEM}.txt`;
        const localization = `localisation/english/${PREFIX}_${STEM}_l_english.yml`;
        expect(project.outFiles()).toEqual([
          MATERIALIZATION_MANIFEST,
          building,
          "descriptor.mod",
          localization,
        ]);

        const buildingOut = project.readOut(building);
        expect(buildingOut).toContain(`${PREFIX}_building_${STEM} = {`);
        expect(buildingOut).toContain("building_sets = { research }");
        expect(buildingOut).toContain("base_buildtime = 240");
        expect(buildingOut).toContain("category = research");
        // The `amounts` wrapper is a TypeScript shape, not a game one: it has
        // to disappear into a plain resource map under `cost`/`upkeep`.
        expect(buildingOut).toContain("category = planet_buildings");
        expect(buildingOut).toContain("minerals = 300");
        expect(buildingOut).toContain("energy = 2");
        expect(buildingOut).not.toContain("amounts");
        // Curated absence, asserted rather than assumed.
        expect(buildingOut).not.toContain("produces");

        expect(project.readOut(localization)).toContain(NAME);
      },
      COMPILER_TIMEOUT
    );
  });
});

/** Both visibilities against all four kinds, in the order the questions ask. */
const EVENT_VARIANTS = (["visible", "hidden"] as const).flatMap((visibility) =>
  (["country", "planet", "ship", "fleet"] as const).map((kind) => [visibility, kind] as const)
);

/** The script effect each kind's own flag effect has to emit. */
const FLAG_EFFECTS = {
  country: "set_country_flag",
  planet: "set_planet_flag",
  ship: "set_ship_flag",
  fleet: "set_fleet_flag",
} as const;

/** Everything a window needs, and everything a hidden event must not carry. */
const WINDOW_FIELDS = ["title", "desc", "picture", "options"] as const;

describe.each(EVENT_VARIANTS)(
  "event, answering visibility=%s event-kind=%s",
  (visibility, kind) => {
    const answers = { visibility, "event-kind": kind };
    const generate = (): GeneratedFeatureSource =>
      CATALOG.generate({ recipeId: "event", name: NAME, answers });
    const generated = generate();

    describeSource(`recipes/event/${visibility}-${kind}.ts`, generate);

    it.each(WINDOW_FIELDS)("writes %s only when the event has a window", (field) => {
      // The comment form counts too. "Structurally absent" means an author
      // reading the hidden variant is never shown a window field at all, not
      // even one commented out — an example that cannot be taken up is worse
      // than no example.
      const written = new RegExp(String.raw`^\s*(?:// )?${field}:`, "m").test(generated.contents);
      expect(written).toBe(visibility === "visible");
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
        "builds, and emits the kind's own event with the kind's own effect",
        () => {
          const result = project.build();
          expect(result.status, result.output).toBe(0);

          const events = `events/${PREFIX}_${STEM}.txt`;
          const localization = `localisation/english/${PREFIX}_${STEM}_l_english.yml`;
          // No window, no localized text, so no localization file at all. That
          // absence is the structural proof the window fields are gone rather
          // than merely emitted empty.
          expect(project.outFiles()).toEqual(
            visibility === "visible"
              ? [MATERIALIZATION_MANIFEST, "descriptor.mod", events, localization]
              : [MATERIALIZATION_MANIFEST, "descriptor.mod", events]
          );

          const eventsOut = project.readOut(events);
          expect(eventsOut).toContain(`namespace = ${PREFIX}_${STEM}`);
          expect(eventsOut).toContain(`${EVENT_KIND_CHOICES[kind]} = {`);
          expect(eventsOut).toContain(`id = ${PREFIX}_${STEM}.1`);
          expect(eventsOut).toContain("is_triggered_only = yes");
          // The one line that differs per kind, which is the whole point of
          // the `event-kind` question. The flag carries the mod prefix because
          // flag names are shared with every other mod the player has loaded,
          // and the prefix reaches the emitted string through `mod.config` —
          // so this also proves that interpolation survives the build.
          expect(eventsOut).toContain(`${FLAG_EFFECTS[kind]} = ${PREFIX}_${STEM}_fired`);

          if (visibility === "visible") {
            expect(eventsOut).toContain(`title = ${PREFIX}_${STEM}.1.name`);
            expect(eventsOut).toContain(`desc = ${PREFIX}_${STEM}.1.desc`);
            expect(eventsOut).toContain("option = {");
            expect(eventsOut).not.toContain("hide_window");
            expect(project.readOut(localization)).toContain("PLACEHOLDER:");
          } else {
            expect(eventsOut).toContain("hide_window = yes");
            expect(eventsOut).toContain("immediate = {");
            expect(eventsOut).not.toContain("title");
            expect(eventsOut).not.toContain("desc");
            expect(eventsOut).not.toContain("option");
            expect(eventsOut).not.toContain("picture");
          }
        },
        COMPILER_TIMEOUT
      );
    });
  }
);

describe.each([["one"], ["two"]] as const)("research-quest, answering projects=%s", (projects) => {
  const generate = (): GeneratedFeatureSource =>
    CATALOG.generate({ recipeId: "research-quest", name: NAME, answers: { projects } });
  const generated = generate();

  describeSource(`recipes/research-quest/${projects}.ts`, generate);

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
          MATERIALIZATION_MANIFEST,
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

  /** Uncomments the named examples, then compiles the result. */
  function compileUncommented(
    generated: GeneratedFeatureSource,
    examples: readonly string[]
  ): void {
    const { source, uncommented } = uncomment(generated.contents, examples);
    expect(uncommented, "every example must actually have been uncommented").toEqual([...examples]);

    project.place(generated.basename, source);
    const result = project.typecheck();
    expect(result.output).toBe("");
    expect(result.status).toBe(0);
  }

  it(
    "compile as written in technology, once their `// ` is removed",
    () => {
      compileUncommented(CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} }), [
        "prerequisites",
        "weight",
      ]);
    },
    COMPILER_TIMEOUT
  );

  it(
    "compile as written in building, once their `// ` is removed",
    () => {
      compileUncommented(CATALOG.generate({ recipeId: "building", name: NAME, answers: {} }), [
        "prerequisites",
        "upgrades",
      ]);
    },
    COMPILER_TIMEOUT
  );

  it.each(EVENT_VARIANTS)(
    "compile as written in event visibility=%s event-kind=%s, once their `// ` is removed",
    (visibility, kind) => {
      // A hidden event has no window, so `picture` is not among its examples —
      // and the field gate above is what proves that is an absence rather than
      // an example this test forgot to name.
      compileUncommented(
        CATALOG.generate({
          recipeId: "event",
          name: NAME,
          answers: { visibility, "event-kind": kind },
        }),
        visibility === "visible" ? ["picture", "fireOnlyOnce"] : ["fireOnlyOnce"]
      );
    },
    COMPILER_TIMEOUT
  );

  it.each([["one"], ["two"]] as const)(
    "compile as written in research-quest projects=%s, once their `// ` is removed",
    (projects) => {
      compileUncommented(
        CATALOG.generate({ recipeId: "research-quest", name: NAME, answers: { projects } }),
        ["timelimit"]
      );
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
 * builds and only fails when the game silently ignores the definition.
 *
 * Read as text rather than imported: `packages/stellaris-ids` is outside this
 * program on purpose — its module augmentation is global — and this needs the
 * committed bytes, not the types.
 */
describe("the vanilla ids the examples cite", () => {
  const ID_REGISTRIES = path.resolve(import.meta.dirname, "../../stellaris-ids/src/registries");

  /**
   * Each recipe's declared citations, with the variant whose source has to
   * carry them. The `event` recipe cites only from its visible branch: a hidden
   * event has no window to put a picture in.
   */
  const CITATIONS: readonly (readonly [
    string,
    Readonly<Record<string, readonly string[]>>,
    Record<string, string>,
  ])[] = [
    ["technology", TECHNOLOGY_IDS, {}],
    ["building", BUILDING_IDS, {}],
    ["event", EVENT_IDS, { visibility: "visible", "event-kind": "country" }],
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

    const registryFile = path.join(ID_REGISTRIES, `${registry}.ts`);
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

describe("the compiler gate", () => {
  let project: GoldenProject;

  beforeAll(() => {
    project = createGoldenProject();
  });

  afterAll(() => project?.dispose());

  /** Renders a variant, mutates one substring, and requires `tsc` to refuse it. */
  function expectRefused(
    generated: GeneratedFeatureSource,
    from: string,
    to: string,
    reported: string
  ): void {
    const bad = generated.contents.replace(from, to);
    expect(bad, "the mutation must actually have applied").not.toBe(generated.contents);

    project.place(generated.basename, bad);
    const result = project.typecheck();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(reported);
  }

  it(
    "fails on a generated call the SDK would refuse",
    () => {
      // The negative control. Without it, a compiler step that silently stopped
      // seeing the generated file would pass forever, and the matrix above
      // would be proving nothing at all.
      expectRefused(
        CATALOG.generate({ recipeId: "technology", name: NAME, answers: {} }),
        'area: "physics"',
        'area: "chemistry"',
        "chemistry"
      );
    },
    COMPILER_TIMEOUT
  );

  it(
    "fails on a building category the game does not have",
    () => {
      expectRefused(
        CATALOG.generate({ recipeId: "building", name: NAME, answers: {} }),
        'category: "research"',
        'category: "cabbage"',
        "cabbage"
      );
    },
    COMPILER_TIMEOUT
  );

  it(
    "fails on an effect the selected event kind does not put in scope",
    () => {
      // The direct proof that the `event-kind` answer really fixes the root
      // callback scope: `setCountryFlag` is a perfectly real effect, and it is
      // simply not one a ship can record.
      expectRefused(
        CATALOG.generate({
          recipeId: "event",
          name: NAME,
          answers: { visibility: "visible", "event-kind": "ship" },
        }),
        "ship.setShipFlag(",
        "ship.setCountryFlag(",
        "setCountryFlag"
      );
    },
    COMPILER_TIMEOUT
  );

  it(
    "fails on a generated research-quest call the SDK would refuse",
    () => {
      // The same control for the feature recipe: its file coordinates several
      // registries, so this proves the compiler sees that file too.
      expectRefused(
        CATALOG.generate({
          recipeId: "research-quest",
          name: NAME,
          answers: { projects: "two" },
        }),
        'eventScope: "country_event"',
        'eventScope: "cabbage_event"',
        "cabbage_event"
      );
    },
    COMPILER_TIMEOUT
  );
});
