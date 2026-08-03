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
  scriptedEffect,
  scriptedTrigger,
  vanilla,
  type EventDef,
  type ScopeName,
  type ScriptedEffectCall,
  type SpriteRef,
  type TechnologyRef,
  type Trigger,
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

describe("scripted bindings without the package", () => {
  it("accepts any name", () => {
    // The pre-bound `@pdx-ts/stellaris-ids/triggers` exports are gone with the
    // package; the hand-declared form is what remains, and without an id set to
    // check against it accepts whatever the author writes.
    expectTypeOf(scriptedTrigger("no_such_trigger_anywhere", "country")()).toEqualTypeOf<
      Trigger<"country">
    >();
  });

  it("compiles BOTH call forms, which is the whole degradation story", () => {
    // This is the assertion the design turns on. With the package installed a
    // parameterless binding takes no arguments and a parameterized one requires
    // them; without it the SDK cannot tell which a name is, so the argument is
    // optional and both call forms stay legal. Any source that compiles with
    // the package therefore still compiles without it.
    const binding = scriptedTrigger("is_fallen_empire", "country");
    expectTypeOf(binding()).toEqualTypeOf<Trigger<"country">>();
    expectTypeOf(binding({ SCOPE: "root" })).toEqualTypeOf<Trigger<"country">>();
  });

  it("also accepts a boolean, negated included, since the arity is unknown either way (SDK-43)", () => {
    // Without the package the SDK cannot tell a parameterless trigger from a
    // parameterized one, so — same as the object-args form above — the
    // boolean call form has to stay legal too, not only for names the
    // installed package would resolve to an empty parameter list.
    const binding = scriptedTrigger("is_fallen_empire", "country");
    expectTypeOf(binding(false)).toEqualTypeOf<Trigger<"country">>();
    expectTypeOf(binding(true)).toEqualTypeOf<Trigger<"country">>();
  });

  it("still enforces the asserted scope", () => {
    // Losing the id sets must not lose scope checking: the assertion is the
    // author's either way, and the brand is what makes it bite.
    const inPlanet = (_condition: Trigger<"planet">): void => undefined;
    inPlanet(scriptedTrigger("x", "planet")());
    // @ts-expect-error a country assertion does not satisfy a planet slot.
    inPlanet(scriptedTrigger("x", "country")());
  });

  it("gives `.unchecked` the same shape as the plain form", () => {
    // With no set to check against there is nothing to relax, so the escape
    // hatch and the checked form coincide — and code written against either
    // keeps compiling when the package arrives.
    expectTypeOf(scriptedTrigger.unchecked("pd_habitability_check", "planet")()).toEqualTypeOf<
      Trigger<"planet">
    >();
  });

  it("widens `any` to every scope and a set to its union", () => {
    expectTypeOf(scriptedTrigger("x", "any")()).toEqualTypeOf<Trigger<ScopeName>>();
    expectTypeOf(scriptedTrigger("x", ["country", "sector"])()).toEqualTypeOf<
      Trigger<"country" | "sector">
    >();
  });

  it("keeps effect calls out of condition position", () => {
    const call = scriptedEffect("some_effect", "country")();
    expectTypeOf(call).toEqualTypeOf<ScriptedEffectCall<"country">>();
    // @ts-expect-error an effect call is not a condition, however alike they
    // serialize.
    const _condition: Trigger<"country"> = call;
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
