/**
 * The declared situation target contract: `targetScope` on
 * `defineSituationType` types `startSituation`'s target ref, the same
 * witness pattern the event FROM contract uses.
 */

import { describe, expectTypeOf, it } from "vitest";

import { createEvents, createSituationTypes, eventTarget } from "../src/index.ts";

describe("the declared situation target contract", () => {
  it("carries the declared scope on the defined object", () => {
    const situations = createSituationTypes();
    const sit = situations.defineSituationType({
      id: "st_test_sit",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    expectTypeOf(sit.targetScope).toEqualTypeOf<"planet">();

    const undeclared = situations.defineSituationType({
      id: "st_test_sit_undeclared",
      name: "S2",
      monthlyProgress: { base: 1 },
    });
    expectTypeOf(undeclared.targetScope).toEqualTypeOf<undefined>();
  });

  it("requires a matching target ref at start sites", () => {
    const situations = createSituationTypes();
    const events = createEvents("st_test_events", "st_test");
    const planetSit = situations.defineSituationType({
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
    const events = createEvents("st_test_vanilla_events", "st_test_vanilla");
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
});
