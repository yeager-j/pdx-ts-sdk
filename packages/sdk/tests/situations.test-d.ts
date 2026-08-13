/**
 * The declared situation target contract: `targetScope` on
 * `defineSituationType` types `startSituation`'s target ref, the same
 * witness pattern the event FROM contract uses.
 */

import { describe, expectTypeOf, it } from "vitest";

import type { SituationTypeItem } from "../src/generated/content-definers.ts";
import type { SituationTypeRef } from "../src/generated/refs.ts";
import { createMod, eventTarget } from "../src/index.ts";

describe("the declared situation target contract", () => {
  it("carries the declared scope on the defined object", () => {
    const mod = createMod({ name: "Situations", prefix: "st_test", supportedVersion: "4.4.*" });
    const sit = mod.situationType("sit", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    expectTypeOf(sit.targetScope).toEqualTypeOf<"planet">();

    const undeclared = mod.situationType("sit_undeclared", {
      name: "S2",
      monthlyProgress: { base: 1 },
    });
    expectTypeOf(undeclared.targetScope).toEqualTypeOf<undefined>();
  });

  it("requires a matching target ref at start sites", () => {
    const mod = createMod({ name: "Situations", prefix: "st_test", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const planetSit = mod.situationType("sit_planet", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("st_test_world");
    events.country(1, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.startSituation({ type: planetSit, target: world });
        // @ts-expect-error — a scope is named by a typed path, never a bare word
        country.startSituation({ type: planetSit, target: "some_target" });
        // @ts-expect-error — the type declared a planet target; a country ref does not satisfy it
        country.startSituation({ type: planetSit, target: ctx.self });
      },
    });
  });

  it("rejects a situation value that could be either of two declarations", () => {
    // The witness is a phantom property and therefore covariant: a ternary
    // over two differently targeted situation types carries both scopes at
    // once, and a planet target satisfies the union while the type that
    // actually starts may be the country one (SDK-181).
    const mod = createMod({
      name: "Situations",
      prefix: "st_test_either",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const planetSit = mod.situationType("planet_sit", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const countrySit = mod.situationType("country_sit", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "country",
    });
    const world = eventTarget<"planet">("st_test_either_world");
    const either = (0 as number) > 1 ? planetSit : countrySit;
    events.country(4, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        // @ts-expect-error — either type could start here, and they declare different targets
        country.startSituation({ type: either, target: world });
        country.startSituation({ type: planetSit, target: world });
      },
    });
  });

  it("keeps the unchecked path for undeclared and vanilla situations", () => {
    const mod = createMod({
      name: "Vanilla",
      prefix: "st_test_vanilla",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    // Nothing declares a target scope here, so `type` carries no `targetScope`
    // and the generated overload — narrowed by the overlay to refuse one —
    // still takes it.
    const undeclared = mod.situationType("sit_undeclared", {
      name: "S",
      monthlyProgress: { base: 1 },
    });
    const vanillaRef: SituationTypeRef = { id: "situation_kaleidoscope" };
    events.country(2, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.startSituation({ type: "situation_kaleidoscope", target: ctx.self });
        country.startSituation({ type: "situation_kaleidoscope" });
        country.startSituation({ type: vanillaRef, target: ctx.self });
        country.startSituation({ type: undeclared, target: ctx.self });
      },
    });
  });

  it("keeps the declaration through the registry's own item type", () => {
    // The same hole one level up from the ternary: `SituationTypeItem` is how
    // a feature's contents are named, and it used to drop `targetScope` on the
    // way to a start site (SDK-181).
    const mod = createMod({
      name: "Situations",
      prefix: "st_test_item",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const planetSit = mod.situationType("sit_item", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const kept: SituationTypeItem<"planet"> = planetSit;
    const widened: SituationTypeItem = planetSit;
    const world = eventTarget<"planet">("st_test_item_world");
    events.country(5, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.startSituation({ type: kept, target: world });
        // @ts-expect-error — the declaration survived the annotation; a country does not satisfy it
        country.startSituation({ type: kept, target: ctx.self });
        // @ts-expect-error — widened to every scope at once, so there is no one scope to check
        country.startSituation({ type: widened, target: ctx.self });
      },
    });
  });

  it("ergonomics: an effect body's .target(...) needs no restated <T>", () => {
    // Before SDK-53 this body's scope was a plain `SituationScope`, whose
    // `.target<S2>(...)` cannot infer S2 from a bare closure — so opening the
    // target required restating what `targetScope: "planet"` above already
    // said: `situation.target<"planet">(...)`. Omitting the type argument
    // used to be a type error (S2 fell back to its `ScopeName` constraint,
    // so the callback parameter typed as a union with no planet-only
    // members); it is what this test now pins as passing.
    const mod = createMod({
      name: "Ergonomics",
      prefix: "st_test_ergo",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const planetSit = mod.situationType("sit_ergo", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("st_test_ergo_world");
    events.country(3, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.startSituation({
          type: planetSit,
          target: world,
          effect: (situation) => {
            situation.target((planet) => {
              // Compiles with no cast: `planet` is narrowed to `PlanetScope`
              // straight from `targetScope`, not asserted at this call site.
              planet.destroyColony();
              // @ts-expect-error — narrowed to PlanetScope; a country-only effect does not belong here
              planet.setCountryFlag("nope");
            });
            // @ts-expect-error — the scope is already the declared "planet"; a second, explicit <T> is the restatement this closes
            situation.target<"planet">(() => {});
          },
        });
      },
    });
  });
});
