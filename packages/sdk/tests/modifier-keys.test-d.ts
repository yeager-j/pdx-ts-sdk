import { describe, it } from "vitest";

import type { ModifierClosure, TriggeredModifier } from "../src/content/types.ts";
import type { BuildingDef } from "../src/generated/building.ts";
import type {
  EconomicCategoryItem,
  ScriptedModifierItem,
} from "../src/generated/content-definers.ts";
import type { JobRef } from "../src/generated/refs.ts";
import { createMod, vanilla } from "../src/index.ts";

declare module "../src/content/types.ts" {
  interface CustomModifiers {
    readonly mymod_custom_scripted?: number;
    readonly [k: `mymod_gen_${string}`]: number | undefined;
  }
}

function countryModifiers(_m: ModifierClosure<"country">): void {}
function colonyModifiers(_m: ModifierClosure<"colony">): void {}
function popGroupModifiers(_m: ModifierClosure<"pop_group">): void {}
function federationModifiers(_m: ModifierClosure<"federation">): void {}
function leaderModifiers(_m: ModifierClosure<"leader">): void {}

const ownedModifierMod = createMod({ name: "Owned", prefix: "mymod", supportedVersion: "v4.4.*" });
const ownedScripted = ownedModifierMod.scriptedModifier("efficiency", { category: "country" });
const planetScripted = ownedModifierMod.scriptedModifier("planet_efficiency", {
  category: "planet",
});
const secondCountryScripted = ownedModifierMod.scriptedModifier("second_efficiency", {
  category: "country",
});
const ownedEconomic = ownedModifierMod.economicCategory("operations", {
  modifierCategory: "country",
  generateAddModifiers: ["cost"],
  generateMultModifiers: ["upkeep"],
});
const secondOwnedEconomic = ownedModifierMod.economicCategory("second_operations", {
  modifierCategory: "country",
  generateAddModifiers: ["cost"],
  generateMultModifiers: ["upkeep"],
});
const differentEconomic = ownedModifierMod.economicCategory("different_operations", {
  modifierCategory: "country",
  generateMultModifiers: ["cost"],
});
const scriptedAlias: ScriptedModifierItem<"country"> = ownedScripted;
const economicAlias: EconomicCategoryItem = ownedEconomic;
void scriptedAlias;
void economicAlias;
declare const bareScripted: ScriptedModifierItem;
declare const bareEconomic: EconomicCategoryItem;
// @ts-expect-error — a bare scripted item has no unambiguous category witness
countryModifiers((m) => m.scripted(bareScripted).set(1));
// @ts-expect-error — a bare economic item has no operation witness
countryModifiers((m) => m.economic(bareEconomic).resource("energy").cost.add(1));

countryModifiers((m) => {
  m.scripted(ownedScripted).set(1);
  m.economic(ownedEconomic).resource("energy").cost.add(1);
  // @ts-expect-error — cost has no declared multiplier
  m.economic(ownedEconomic).resource("energy").cost.mult(1);
  m.economic(ownedEconomic).resource("energy").upkeep.mult(1);
  m.economic(ownedEconomic).upkeep.mult(1);
  // @ts-expect-error — no broad additive operation
  m.economic(ownedEconomic).upkeep.add(1);
  // @ts-expect-error — triggered_* declarations do not create recorder operations
  m.economic(ownedEconomic).triggeredCost.mult(1);
});

declare const chooseOwnedModifier: boolean;
const sameScriptedWitness = chooseOwnedModifier ? ownedScripted : secondCountryScripted;
const differentScriptedWitness = chooseOwnedModifier ? ownedScripted : planetScripted;
const sameEconomicWitness = chooseOwnedModifier ? ownedEconomic : secondOwnedEconomic;
const differentEconomicWitness = chooseOwnedModifier ? ownedEconomic : differentEconomic;
countryModifiers((m) => {
  m.scripted(sameScriptedWitness).set(1);
  m.economic(sameEconomicWitness).resource("energy").upkeep.mult(1);
  // @ts-expect-error — narrow items with different category witnesses before selecting one
  m.scripted(differentScriptedWitness).set(1);
  // @ts-expect-error — narrow items with different operation witnesses before selecting one
  m.economic(differentEconomicWitness).resource("energy").upkeep.mult(1);
});

// @ts-expect-error — a scripted modifier item cannot select an economic recorder
countryModifiers((m) => m.economic(ownedScripted));
// @ts-expect-error — an economic category item cannot select scripted modifiers
countryModifiers((m) => m.scripted(ownedEconomic).set(1));
// @ts-expect-error — incompatible declared category
federationModifiers((m) => m.scripted(planetScripted).set(1));
// @ts-expect-error — Countries-category economic modifiers are not valid on leaders
leaderModifiers((m) => m.economic(ownedEconomic).resource("energy").upkeep.mult(1));
const unsupportedScripted = ownedModifierMod.scriptedModifier("unsupported", { category: "none" });
// @ts-expect-error — unsupported modifier categories are rejected
countryModifiers((m) => m.scripted(unsupportedScripted).set(1));
const unsupportedComponent = ownedModifierMod.scriptedModifier("component", {
  category: "component",
});
const unsupportedPopJob = ownedModifierMod.scriptedModifier("pop_job", { category: "pop_job" });
// @ts-expect-error — component is unsupported
countryModifiers((m) => m.scripted(unsupportedComponent).set(1));
// @ts-expect-error — pop_job is unsupported
countryModifiers((m) => m.scripted(unsupportedPopJob).set(1));

describe("modifier path safety", () => {
  it("supports all job-derived colony operations and static paths", () => {
    const job: JobRef = { id: "mymod_job" };
    colonyModifiers((m) => {
      m.job(job).add(1);
      m.job(job).per.pop(1);
      m.job(job).per.crime(1);
      m.job(job).max.workforce.add(1);
      m.job(job).max.workforce.mult(1);
      m.job(job).automated.workforce.mult(1);
      m.job(job).workforce.mult(1);
      m.job(job).bonus.workforce.mult(1);
      m.job.technician.add(1);
      m.job(vanilla.job("farmer")).add(1);
      const selected = m.job(job);
      // @ts-expect-error — selecting a reference returns operations, not another selector
      selected(job);
      // @ts-expect-error — concrete vanilla paths stay on m.job, not the selected family
      selected.technician.add(1);
    });
  });

  it("limits pop-group job operations and rejects non-job refs", () => {
    const job: JobRef = { id: "mymod_job" };
    popGroupModifiers((m) => {
      m.job(job).workforce.mult(1);
      m.job(job).bonus.workforce.mult(1);
      // @ts-expect-error — colony-only operation
      m.job(job).add(1);
    });
    // @ts-expect-error — unrelated scopes have no callable job family
    federationModifiers((m) => m.job(job).add(1));
    // @ts-expect-error — technology refs cannot select job modifiers
    colonyModifiers((m) => m.job(vanilla.technology("tech_lasers_1")).add(1));
  });
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
