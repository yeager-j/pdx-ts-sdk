import { describe, it } from "vitest";

import type { ModifierClosure, TriggeredModifier } from "../src/content/types.ts";
import type { BuildingDef } from "../src/generated/building.ts";
import type {
  EconomicCategoryItem,
  ScriptedModifierItem,
} from "../src/generated/content-definers.ts";
import type { EconomicModifierType } from "../src/generated/enums.ts";
import type { JobRef } from "../src/generated/refs.ts";
import { createMod } from "../src/index.ts";
import { always, vanilla } from "../src/stellaris.ts";

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
function shipModifiers(_m: ModifierClosure<"ship">): void {}

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
const ownedComponentTag = ownedModifierMod.componentTag("artillery_role");
const secondOwnedEconomic = ownedModifierMod.economicCategory("second_operations", {
  modifierCategory: "country",
  generateAddModifiers: ["cost"],
  generateMultModifiers: ["upkeep"],
});
const differentEconomic = ownedModifierMod.economicCategory("different_operations", {
  modifierCategory: "country",
  generateMultModifiers: ["cost"],
});
const triggeredCostKey = ownedModifierMod.economicCategory("starbase_shipyard_build", {});
const triggeredProducesKey = ownedModifierMod.economicCategory("planet_technician", {});
const triggeredUpkeepKey = ownedModifierMod.economicCategory("ship_military", {});
const triggeredLogisticsKey = ownedModifierMod.economicCategory("logistics_lane", {});
const otherTriggeredKey = ownedModifierMod.economicCategory("other_shipyard_build", {});
const triggeredEconomic = ownedModifierMod.economicCategory("triggered_operations", {
  modifierCategory: "country",
  triggeredCostModifier: [
    { key: triggeredCostKey, modifierTypes: ["add"] },
    { key: triggeredCostKey, modifierTypes: ["mult"] },
  ],
  triggeredProducesModifier: [{ key: triggeredProducesKey, modifierTypes: ["add", "mult"] }],
  triggeredUpkeepModifier: [{ key: triggeredUpkeepKey, modifierTypes: ["mult"] }],
  triggeredLogisticsModifier: [{ key: triggeredLogisticsKey, modifierTypes: ["add", "mult"] }],
});
const sameTriggeredEconomic = ownedModifierMod.economicCategory("same_triggered_operations", {
  modifierCategory: "country",
  triggeredCostModifier: [
    { key: triggeredCostKey, modifierTypes: ["add"] },
    { key: triggeredCostKey, modifierTypes: ["mult"] },
  ],
  triggeredProducesModifier: [{ key: triggeredProducesKey, modifierTypes: ["add", "mult"] }],
  triggeredUpkeepModifier: [{ key: triggeredUpkeepKey, modifierTypes: ["mult"] }],
  triggeredLogisticsModifier: [{ key: triggeredLogisticsKey, modifierTypes: ["add", "mult"] }],
});
const otherTriggeredEconomic = ownedModifierMod.economicCategory("other_triggered_operations", {
  modifierCategory: "country",
  triggeredCostModifier: [{ key: otherTriggeredKey, modifierTypes: ["mult"] }],
});
const sameCapabilityKeyEconomic = ownedModifierMod.economicCategory("same_key_capabilities", {
  modifierCategory: "country",
  triggeredCostModifier: [
    { key: triggeredCostKey, modifierTypes: ["mult"] },
    { key: otherTriggeredKey, modifierTypes: ["mult"] },
  ],
});
const differingCapabilityKeyEconomic = ownedModifierMod.economicCategory(
  "differing_key_capabilities",
  {
    modifierCategory: "country",
    triggeredCostModifier: [
      { key: triggeredCostKey, modifierTypes: ["add"] },
      { key: otherTriggeredKey, modifierTypes: ["mult"] },
    ],
  }
);
const emptyTriggeredEconomic = ownedModifierMod.economicCategory("empty_triggered_operations", {
  modifierCategory: "country",
  triggeredCostModifier: [{ key: triggeredCostKey, modifierTypes: [] }],
});
const optionalTriggeredEconomic = ownedModifierMod.economicCategory("optional_triggered_fields", {
  modifierCategory: "country",
  triggeredCostModifier: [
    { key: triggeredCostKey, modifierTypes: ["mult"], useParentIcon: true, trigger: always() },
  ],
});
ownedModifierMod.economicCategory("misspelled_triggered_field", {
  modifierCategory: "country",
  // @ts-expect-error — nested triggered rows reject misspelled generated fields
  triggeredCostModifier: [{ key: triggeredCostKey, modifierTypes: ["mult"], useParentIcom: true }],
});
const mutableTriggeredTypes: EconomicModifierType[] = ["mult"];
const readonlyTriggeredTypes: readonly EconomicModifierType[] = ["mult"];
const widenedMutableEconomic = ownedModifierMod.economicCategory("widened_mutable", {
  modifierCategory: "country",
  triggeredCostModifier: [{ key: triggeredCostKey, modifierTypes: mutableTriggeredTypes }],
});
const widenedReadonlyEconomic = ownedModifierMod.economicCategory("widened_readonly", {
  modifierCategory: "country",
  triggeredCostModifier: [{ key: triggeredCostKey, modifierTypes: readonlyTriggeredTypes }],
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

countryModifiers((m) => {
  const triggered = m.economic(triggeredEconomic).triggered(triggeredCostKey);
  triggered.cost.mult(1);
  triggered.resource("energy").cost.add(1);
  triggered.resource("energy").cost.mult(1);
  // @ts-expect-error — the broad form permits only mult
  triggered.cost.add(1);
  // @ts-expect-error — no broad additive operation
  triggered.produces.add(1);
  const produces = m.economic(triggeredEconomic).triggered(triggeredProducesKey);
  produces.produces.mult(1);
  produces.resource("energy").produces.add(1);
  produces.resource("energy").produces.mult(1);
  const upkeep = m.economic(triggeredEconomic).triggered(triggeredUpkeepKey);
  upkeep.upkeep.mult(1);
  // @ts-expect-error — ship_military has no resource-specific add
  upkeep.resource("energy").upkeep.add(1);
  const logistics = m.economic(triggeredEconomic).triggered(triggeredLogisticsKey);
  logistics.logistics.mult(1);
  logistics.resource("energy").logistics.add(1);
  logistics.resource("energy").logistics.mult(1);
  const empty = m.economic(emptyTriggeredEconomic).triggered(triggeredCostKey);
  // @ts-expect-error — an empty declared row has no modifier operations
  empty.cost.mult(1);
  m.economic(optionalTriggeredEconomic).triggered(triggeredCostKey).cost.mult(1);
  // @ts-expect-error — widened mutable modifier types cannot prove capabilities
  m.economic(widenedMutableEconomic).triggered(triggeredCostKey).cost.mult(1);
  // @ts-expect-error — widened readonly modifier types cannot prove capabilities
  m.economic(widenedReadonlyEconomic).triggered(triggeredCostKey).cost.mult(1);
  // @ts-expect-error — undeclared triggered key
  m.economic(triggeredEconomic).triggered("not_declared");
  const widenedKey: string = "starbase_shipyard_build";
  // @ts-expect-error — widened keys cannot prove a declared row
  m.economic(triggeredEconomic).triggered(widenedKey);
  // @ts-expect-error — a scripted modifier is the wrong registry for a triggered key
  m.economic(triggeredEconomic).triggered(ownedScripted);
});

declare const chooseOwnedModifier: boolean;
const sameScriptedWitness = chooseOwnedModifier ? ownedScripted : secondCountryScripted;
const differentScriptedWitness = chooseOwnedModifier ? ownedScripted : planetScripted;
const sameEconomicWitness = chooseOwnedModifier ? ownedEconomic : secondOwnedEconomic;
const differentEconomicWitness = chooseOwnedModifier ? ownedEconomic : differentEconomic;
const sameTriggeredWitness = chooseOwnedModifier ? triggeredEconomic : sameTriggeredEconomic;
const differentTriggeredWitness = chooseOwnedModifier ? triggeredEconomic : otherTriggeredEconomic;
const sameCapabilityKey = chooseOwnedModifier ? triggeredCostKey : otherTriggeredKey;
const differingCapabilityKey = chooseOwnedModifier ? triggeredCostKey : otherTriggeredKey;
countryModifiers((m) => {
  m.scripted(sameScriptedWitness).set(1);
  m.economic(sameEconomicWitness).resource("energy").upkeep.mult(1);
  // @ts-expect-error — narrow items with different category witnesses before selecting one
  m.scripted(differentScriptedWitness).set(1);
  // @ts-expect-error — narrow items with different operation witnesses before selecting one
  m.economic(differentEconomicWitness).resource("energy").upkeep.mult(1);
  m.economic(sameTriggeredWitness).triggered(triggeredCostKey).cost.mult(1);
  // @ts-expect-error — differing triggered row witnesses require narrowing
  m.economic(differentTriggeredWitness).triggered(triggeredCostKey).cost.mult(1);
  m.economic(sameCapabilityKeyEconomic).triggered(sameCapabilityKey).cost.mult(1);
  // @ts-expect-error — differing capability witnesses require narrowing
  m.economic(differingCapabilityKeyEconomic).triggered(differingCapabilityKey).cost.mult(1);
});

// @ts-expect-error — a scripted modifier item cannot select an economic recorder
countryModifiers((m) => m.economic(ownedScripted));
// @ts-expect-error — an economic category item cannot select scripted modifiers
countryModifiers((m) => m.scripted(ownedEconomic).set(1));
// @ts-expect-error — incompatible declared category
federationModifiers((m) => m.scripted(planetScripted).set(1));
// @ts-expect-error — Countries-category economic modifiers are not valid on leaders
leaderModifiers((m) => m.economic(ownedEconomic).resource("energy").upkeep.mult(1));
// @ts-expect-error — triggered economic modifiers keep the source category scope
leaderModifiers((m) => m.economic(triggeredEconomic).triggered(triggeredCostKey).cost.mult(1));
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
  it("types component-tag modifier families only where Ships permits them", () => {
    shipModifiers((m) => {
      m.componentTag(ownedComponentTag).weapon.damage.mult(0.1);
      m.componentTag(ownedComponentTag).weapon.fire.rate.mult(0.1);
      m.componentTag(ownedComponentTag).speed.mult(0.1);
      m.componentTag("gunship").speed.mult(0.1);
      // @ts-expect-error — generated families accept no unchecked tag string
      m.componentTag("unknown_component_tag").speed.mult(0.1);
      // @ts-expect-error — content references from another registry are not component tags
      m.componentTag(vanilla.technology("tech_lasers_1")).speed.mult(0.1);
    });
    // @ts-expect-error — component-tag modifiers do not apply to pop groups
    popGroupModifiers((m) => m.componentTag(ownedComponentTag).speed.mult(0.1));
  });

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
