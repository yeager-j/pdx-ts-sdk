import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Deep Space Logistics",
  prefix: "deep_space_logistics",
  supportedVersion: "v4.4.*",
});

const shipyardOperations = mod.economicCategory("shipyard_operations", {});

const expeditions = mod.economicCategory("expeditions", {
  useForAiBudget: true,
  modifierCategory: "country",
  generateMultModifiers: ["cost", "upkeep"],
  triggeredCostModifier: [{ key: shipyardOperations, modifierTypes: ["mult"] }],
});

const expeditionEfficiency = mod.scriptedModifier("expedition_efficiency_mult", {
  name: "Expedition Efficiency",
  percentage: true,
  good: true,
  category: "country",
});

const surveyProtocols = mod.edict("survey_protocols", {
  name: "Deep-Space Survey Protocols",
  description: "Fund long-range expeditions beyond charted space.",
  length: -1,
  icon: "GFX_edict_type_policy",
  resources: [
    {
      category: expeditions,
      cost: { amounts: { unity: 100 } },
      upkeep: {
        amounts: { energy: 5 },
        mult: `modifier:${expeditionEfficiency.id}`,
      },
    },
  ],
  modifier: (modifier) => {
    modifier.economic(expeditions).resource("energy").upkeep.mult(-0.25);
    modifier.economic(expeditions).triggered(shipyardOperations).cost.mult(-0.1);
    modifier.scripted(expeditionEfficiency).set(0.2);
  },
});

const routeDisruption = mod.staticModifier("route_disruption", {
  name: "Route Disruption",
  modifiers: (modifier) => {
    modifier.economic(expeditions).resource("energy").upkeep.mult(0.5);
    modifier.scripted(expeditionEfficiency).set(-0.1);
  },
});

export const feature = mod.feature("expedition_economy", [
  expeditions,
  shipyardOperations,
  expeditionEfficiency,
  surveyProtocols,
  routeDisruption,
]);

export default mod.compile([feature]);
