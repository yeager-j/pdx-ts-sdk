/**
 * The building recipe's slice of the matrix — see `recipe-matrix.test.ts` for
 * what the matrix as a whole proves and how it is split.
 *
 * One golden project hosts every compiler run in this file, on the same
 * economy as the technology slice: incremental typechecks after the first, and
 * a negative control that proves the compiler still sees the swapped file.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATALOG } from "../src/catalog/index.ts";
import type { GeneratedFeatureSource } from "../src/catalog/types.ts";
import { createGoldenProject, type GoldenProject } from "./helpers/golden-project.ts";
import {
  COMPILER_TIMEOUT,
  compileUncommented,
  describeSource,
  expectRefused,
  expectTypechecks,
  MATERIALIZATION_MANIFEST,
  NAME,
  PREFIX,
  STEM,
} from "./helpers/matrix.ts";

const generate = (): GeneratedFeatureSource =>
  CATALOG.generate({ recipeId: "building", name: NAME, answers: {} });

describe("building, with its only answer set", () => {
  describeSource("recipes/building/default.ts", generate);
});

describe("building, in a real project", () => {
  const generated = generate();
  let project: GoldenProject;

  beforeAll(() => {
    project = createGoldenProject();
    project.place(generated.basename, generated.contents);
  }, COMPILER_TIMEOUT);

  afterAll(() => project?.dispose());

  it(
    "typechecks against the real SDK surface",
    () => {
      expectTypechecks(project);
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

  it(
    "the commented examples compile as written, once their `// ` is removed",
    () => {
      compileUncommented(project, generate(), ["prerequisites", "upgrades"]);
    },
    COMPILER_TIMEOUT
  );

  it(
    "the compiler gate fails on a building category the game does not have",
    () => {
      expectRefused(project, generate(), 'category: "research"', 'category: "cabbage"', "cabbage");
    },
    COMPILER_TIMEOUT
  );
});
