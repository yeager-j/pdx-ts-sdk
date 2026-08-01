/**
 * The declared situation target contract: `targetScope` on
 * `defineSituationType` types `startSituation`'s target ref, the same
 * witness pattern the event FROM contract uses.
 */

import { describe, expectTypeOf, it } from "vitest";

import { eventTarget } from "../src/effect-core.ts";
import { Mod } from "../src/mod.ts";

function makeMod(): Mod<"st_test"> {
  return new Mod({
    name: "Situation target type tests",
    prefix: "st_test",
    supportedVersion: "4.4.*",
  });
}

describe("the declared situation target contract", () => {
  it("carries the declared scope on the defined object", () => {
    const mod = makeMod();
    const sit = mod.defineSituationType({
      id: "st_test_sit",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    expectTypeOf(sit.targetScope).toEqualTypeOf<"planet">();

    const undeclared = mod.defineSituationType({
      id: "st_test_sit_undeclared",
      name: "S2",
      monthlyProgress: { base: 1 },
    });
    expectTypeOf(undeclared.targetScope).toEqualTypeOf<undefined>();
  });

  it("requires a matching target ref at start sites", () => {
    const mod = makeMod();
    const planetSit = mod.defineSituationType({
      id: "st_test_sit_planet",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("st_test_world");
    mod.defineCountryEvent({
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
    const mod = makeMod();
    mod.defineCountryEvent({
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
