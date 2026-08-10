/**
 * The declared situation target contract: `targetScope` on
 * `defineSituationType` types `startSituation`'s target ref, the same
 * witness pattern the event FROM contract uses.
 */

import { describe, expectTypeOf, it } from "vitest";

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
        // Known gap since SDK-93 lowered `start_situation.target` from `string`
        // to `ScopeValue`: the declared-contract overload still rejects a
        // country ref against a planet contract, but the generated overload
        // beneath it takes any `ScopeValue` (it has to — vanilla and
        // third-party situation ids declare no contract to check against), so
        // the call resolves there instead of failing. What the contract still
        // buys is the effect body's scope, pinned below.
        country.startSituation({ type: planetSit, target: ctx.self });
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
    events.country(2, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.startSituation({ type: "situation_kaleidoscope", target: ctx.self });
        country.startSituation({ type: "situation_kaleidoscope" });
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
