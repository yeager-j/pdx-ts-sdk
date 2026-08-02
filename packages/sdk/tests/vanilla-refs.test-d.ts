/**
 * The package-absent world (SDK-12 seam D).
 *
 * The root tsconfig excludes `packages/stellaris-ids`, so this program
 * genuinely does not contain the augmentation — this is not a simulation of
 * absence, it is absence. Every assertion here is the opposite of one in
 * `packages/stellaris-ids/tests/present.test-d.ts`: the `vanilla.*` helpers
 * still compile, still preserve literal ids, and still brand per registry;
 * only the id *sets* are gone.
 */

import { describe, expectTypeOf, it } from "vitest";

import {
  defineTechnology,
  vanilla,
  type EventDef,
  type SpriteRef,
  type TechnologyRef,
  type VanillaId,
} from "../src/index.ts";

describe("checked registry helpers without the package", () => {
  it("accepts any string and preserves the literal", () => {
    const tech = vanilla.technology("anything_at_all");
    expectTypeOf(tech.id).toEqualTypeOf<"anything_at_all">();
    expectTypeOf(tech).toExtend<TechnologyRef>();
  });

  it("flows into a ref field", () => {
    defineTechnology({
      id: "absent_probe_tech",
      name: "Probe",
      area: "physics",
      tier: 1,
      category: "computing",
      prerequisites: [vanilla.technology("tech_lasers_1")],
    });
  });

  it("still brands per registry, so a building is not a technology prerequisite", () => {
    defineTechnology({
      id: "absent_probe_tech_2",
      name: "Probe",
      area: "physics",
      tier: 1,
      category: "computing",
      // @ts-expect-error a `BuildingRef` is not a `TechnologyRef`. The brand is
      // structural and independent of the id package — losing id checking must
      // not lose registry checking.
      prerequisites: [vanilla.building("building_capital")],
    });
  });
});

describe("oversized registries without the package", () => {
  it("passes any string through the checked call form", () => {
    // `CheckedVanillaId<"sprite", Id>` short-circuits to `Id` when `"sprite"`
    // is not a key of `VanillaIds` — no navigation, but no false rejection.
    const sprite = vanilla.sprite("whatever");
    expectTypeOf(sprite.id).toEqualTypeOf<"whatever">();
    expectTypeOf(sprite).toExtend<SpriteRef>();
  });
});

describe("VanillaId resolution without the package", () => {
  it("is plain string for every registry", () => {
    expectTypeOf<VanillaId<"technology">>().toEqualTypeOf<string>();
    expectTypeOf<VanillaId<"sprite">>().toEqualTypeOf<string>();
  });
});

describe("event media fields", () => {
  it("accepts a plain string picture and show sound", () => {
    // The pre-SDK-12 authoring form has to keep working: `picture` widened from
    // `string` to `SpriteRef | string`, it did not move to `SpriteRef`.
    type CountryEvent = EventDef<"country", undefined>;
    expectTypeOf<string>().toExtend<NonNullable<CountryEvent["picture"]>>();
    expectTypeOf<string>().toExtend<NonNullable<CountryEvent["showSound"]>>();
  });
});
