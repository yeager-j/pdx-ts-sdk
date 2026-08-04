/**
 * The declared situation target contract: `targetScope` on
 * `defineSituationType` types `startSituation`'s target ref, the same
 * witness pattern the event FROM contract uses.
 */

import { describe, expectTypeOf, it } from "vitest";

import { defineSituationType, eventTarget, namespace } from "../src/index.ts";

describe("the declared situation target contract", () => {
  it("carries the declared scope on the defined object", () => {
    const sit = defineSituationType({
      id: "st_test_sit",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    expectTypeOf(sit.targetScope).toEqualTypeOf<"planet">();

    const undeclared = defineSituationType({
      id: "st_test_sit_undeclared",
      name: "S2",
      monthlyProgress: { base: 1 },
    });
    expectTypeOf(undeclared.targetScope).toEqualTypeOf<undefined>();
  });

  it("requires a matching target ref at start sites", () => {
    const events = namespace("st_test");
    const planetSit = defineSituationType({
      id: "st_test_sit_planet",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("st_test_world");
    events.defineCountryEvent({
      id: 1,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.startSituation({ type: planetSit, target: world });
        // @ts-expect-error — the type declared a planet target; a country ref does not satisfy it
        country.startSituation({ type: planetSit, target: ctx.self });
        // The raw-string path intentionally stays open through the generated
        // signature — same escape hatch every branded reference keeps.
        country.startSituation({ type: planetSit, target: "some_target" });
      },
    });
  });

  it("keeps the string-typed path for undeclared and vanilla situations", () => {
    const events = namespace("st_test_vanilla");
    events.defineCountryEvent({
      id: 2,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.startSituation({ type: "situation_kaleidoscope", target: "owner" });
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
    const events = namespace("st_test_ergo");
    const planetSit = defineSituationType({
      id: "st_test_sit_ergo",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("st_test_ergo_world");
    events.defineCountryEvent({
      id: 3,
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
