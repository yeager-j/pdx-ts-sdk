import { describe, it } from "vitest";

import type { ModifierClosure, TriggeredModifier } from "../src/content/types.ts";
import type { BuildingDef } from "../src/generated/building.ts";

declare module "../src/content/types.ts" {
  interface CustomModifiers {
    readonly mymod_custom_scripted?: number;
    readonly [k: `mymod_gen_${string}`]: number | undefined;
  }
}

function countryModifiers(_m: ModifierClosure<"country">): void {}

describe("modifier path safety", () => {
  it("accepts real paths valid in the scope, including generated names", () => {
    countryModifiers((m) => {
      m.country.unity.produces.mult(0.01);
      m.command.limit.add(1);
      m.pop.happiness(0.05);
      m.shipsize.corvette.hull.mult(0.1);
    });
  });

  it("rejects a misspelled path segment", () => {
    // @ts-expect-error — `prodces` is a typo
    countryModifiers((m) => m.country.unity.prodces.mult(0.01));
  });

  it("rejects calling an interior segment that is not itself a modifier", () => {
    // @ts-expect-error — `country_unity` is not a modifier, only a path prefix
    countryModifiers((m) => m.country.unity(0.01));
  });

  it("makes a name that prefixes longer names callable and traversable", () => {
    countryModifiers((m) => {
      m.bonus.pop.growth(0.1);
      m.bonus.pop.growth.mult(0.05);
    });
  });

  it("rejects a modifier from a scope it does not support", () => {
    // @ts-expect-error — cohesion applies in federation scope, not country
    countryModifiers((m) => m.cohesion.ethics.penalty.mult(0.1));
  });

  it("propagates the triggered-modifier scope onto both modifier slots", () => {
    const triggered: TriggeredModifier<"country"> = {
      // @ts-expect-error — federation-only modifier in a country clause
      modifier: (m) => m.cohesion.ethics.penalty.mult(0.1),
    };
    void triggered;
  });

  it("scopes building planet modifiers to colony", () => {
    const def: BuildingDef = {
      id: "mymod_building_x",
      name: "X",
      planetModifier: (m) => {
        m.planet.pop.assembly.mult(0.01);
        // @ts-expect-error — federation-only modifier in colony scope
        m.cohesion.ethics.penalty.mult(0.1);
      },
    };
    void def;
  });

  it("checks raw() flat names against the scope's full key set", () => {
    countryModifiers((m) => {
      m.raw("country_unity_produces_mult", 0.01);
      // @ts-expect-error — misspelled flat name
      m.raw("country_unity_prodces_mult", 0.01);
      // @ts-expect-error — federation-only flat name in country scope
      m.raw("cohesion_ethics_penalty_mult", 0.1);
    });
  });

  it("admits declared custom names and patterns through raw()", () => {
    countryModifiers((m) => {
      m.raw("mymod_custom_scripted", 0.5);
      m.raw("mymod_gen_energy_output", 0.5);
      // @ts-expect-error — an undeclared name needs unchecked()
      m.raw("some_other_mods_modifier", 1);
    });
  });

  it("accepts any string through unchecked()", () => {
    countryModifiers((m) => m.unchecked("some_other_mods_modifier", 1));
  });
});
