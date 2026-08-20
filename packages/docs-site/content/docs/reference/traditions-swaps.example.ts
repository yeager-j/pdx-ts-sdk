import { createMod, hasAuthority } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Adaptive Horizons",
  prefix: "adaptive_horizons",
  supportedVersion: "v4.4.*",
});

const machineCategoryDescription = mod.localization(
  "adaptive_horizons_machine_desc",
  "Map the galaxy as a network of signals, relays, and synchronized decisions."
);

const networkedSurveyors = mod.tradition("networked_surveyors", {
  name: "Networked Surveyors",
  flavor: "Every crew contributes to a shared map of the unknown.",
  effects: "Improves Physics Research.",
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
  traditionSwap: {
    adaptive_horizons_tradition_networked_surveyors_machine: {
      name: "Distributed Survey Processes",
      flavor: "Every sensor is one node in a single observing mind.",
      effects: "Improves Engineering Research instead of Physics Research.",
      inheritIcon: false,
      inheritEffects: false,
      trigger: hasAuthority("auth_machine_intelligence"),
      modifier: (modifier) => modifier.country.engineering.research.produces.mult(0.05),
      weight: { base: 1 },
    },
  },
  aiWeight: { base: 100 },
});

const relayPlanning = mod.tradition("relay_planning", {
  name: "Relay Planning",
  effects: "Increases naval capacity.",
  modifier: (modifier) => modifier.country.naval.cap.add(10),
  aiWeight: { base: 100 },
});

const sharedArchives = mod.tradition("shared_archives", {
  name: "Shared Archives",
  effects: "Improves Unity production.",
  modifier: (modifier) => modifier.country.unity.produces.mult(0.05),
  aiWeight: { base: 100 },
});

const predictiveModels = mod.tradition("predictive_models", {
  name: "Predictive Models",
  effects: "Improves Physics Research.",
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
  aiWeight: { base: 100 },
});

const synchronizedLogistics = mod.tradition("synchronized_logistics", {
  name: "Synchronized Logistics",
  effects: "Improves Engineering Research.",
  modifier: (modifier) => modifier.country.engineering.research.produces.mult(0.05),
  aiWeight: { base: 100 },
});

const adopt = mod.tradition("adopt", {
  name: "Adaptive Horizons",
  effects: "Adopting Adaptive Horizons improves research output.",
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
});

const finish = mod.tradition("finish", {
  name: "Adaptive Horizons Complete",
  effects: "Completing Adaptive Horizons improves Unity production.",
  modifier: (modifier) => modifier.country.unity.produces.mult(0.1),
});

const adaptiveHorizons = mod.traditionCategory("adaptive_horizons", {
  name: "Adaptive Horizons",
  desc: "Map the galaxy through exploration and shared experience.",
  conditionalDesc: [
    {
      trigger: hasAuthority("auth_machine_intelligence"),
      text: machineCategoryDescription.key,
    },
  ],
  treeTemplate: "tree_12_11",
  adoptionBonus: adopt,
  finishBonus: finish,
  traditions: [
    networkedSurveyors,
    relayPlanning,
    sharedArchives,
    predictiveModels,
    synchronizedLogistics,
  ],
  aiWeight: { base: 20 },
});

export const feature = mod.feature("adaptive_horizons", [
  machineCategoryDescription,
  adopt,
  networkedSurveyors,
  relayPlanning,
  sharedArchives,
  predictiveModels,
  synchronizedLogistics,
  finish,
  adaptiveHorizons,
]);

export default mod.compile([feature]);
