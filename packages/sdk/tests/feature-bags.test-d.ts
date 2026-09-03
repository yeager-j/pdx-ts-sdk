/**
 * The types of the bag forms: a features module is accepted where its every
 * export is a Feature of this capability, an Item bag places `ModItem`s, and
 * neither one Item nor one Feature passes as a bag.
 */

import { describe, expectTypeOf, it } from "vitest";

import type { CapabilityFeature, ModItem, PureMod } from "../src/index.ts";
import * as featuresWithString from "./fixtures/bags/features-with-string.ts";
import * as features from "./fixtures/bags/features.ts";
import * as foreignFeatures from "./fixtures/bags/foreign-features.ts";
import * as items from "./fixtures/bags/items.ts";
import { mod } from "./fixtures/bags/mod.ts";
import * as projectFeatures from "./fixtures/bags/project-features.ts";
import { project } from "./fixtures/bags/project.ts";

describe("a features module", () => {
  it("is accepted by mod.compile and project.build when every export is this mod's Feature", () => {
    expectTypeOf(mod.compile(features)).toEqualTypeOf<PureMod>();
    expectTypeOf(project.build(projectFeatures)).toEqualTypeOf<PureMod>();
    expectTypeOf(project.build([])).toEqualTypeOf<PureMod>();
    expectTypeOf(project.build()).toEqualTypeOf<Promise<PureMod>>();
    expectTypeOf(project.build({ additionalFeatures: [] })).toEqualTypeOf<Promise<PureMod>>();
  });

  it("is refused when an export is not a Feature, or is another capability's", () => {
    // @ts-expect-error — a string export is not a Feature
    mod.compile(featuresWithString);
    // @ts-expect-error — the Feature belongs to another prefix
    mod.compile(foreignFeatures);
    // @ts-expect-error — the project's prefix differs from the fixture mod's
    project.build(features);
  });
});

describe("an Item bag", () => {
  it("places ModItems, while the array form keeps its element type", () => {
    expectTypeOf(mod.feature("bag", items)).toEqualTypeOf<
      CapabilityFeature<"feature_bags", ModItem>
    >();
    expectTypeOf(mod.feature("array", [items.alpha])).toEqualTypeOf<
      CapabilityFeature<"feature_bags", typeof items.alpha>
    >();
  });

  it("is neither one Item nor one Feature", () => {
    // @ts-expect-error — one Item is placed inside an array, not as a bag
    mod.feature("item", items.alpha);
    // @ts-expect-error — a Feature is compiled, never placed
    mod.feature("feature", features.main);
  });
});
