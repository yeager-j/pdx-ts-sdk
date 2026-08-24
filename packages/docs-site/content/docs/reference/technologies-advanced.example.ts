import { createMod } from "@pdx-ts/sdk";
import { hasCivic, isNomadic, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Adaptive Science",
  prefix: "adaptive_science",
  supportedVersion: "v4.4.*",
});

const unlockTitle = mod.localization(
  "orbital_dynamics_unlock_title",
  "Unlocks: Resonance Observatory"
);
const unlockDesc = mod.localization(
  "orbital_dynamics_unlock_desc",
  "Resonance Observatories improve planetary Physics Research."
);
const gatewayDescription = mod.localization(
  "gateway_adaptive_science_orbital",
  "Adaptive Orbital Science path: Researching this technology leads to further advancements in orbital science.",
  { prefix: false }
);

const orbitalDynamics = mod.technology("orbital_dynamics", {
  name: "Orbital Dynamics",
  desc: "Predictive models turn orbital motion into a precise scientific instrument.",
  area: "physics",
  tier: 2,
  category: "computing",
  cost: 4_000,
  prerequisites: [vanilla.technology("tech_space_science_1")],
  gateway: "adaptive_science_orbital",
  weight: 80,
  weightModifier: {
    modifiers: [{ factor: 2, when: hasCivic("civic_technocracy") }],
  },
  aiWeight: { base: 1 },
  isRare: true,
  featureFlags: ["experimental_subspace_navigation"],
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
  prereqforDesc: [
    {
      custom: [{ title: unlockTitle.key, desc: unlockDesc.key }],
    },
  ],
  technologySwap: [
    {
      name: "adaptive_science_tech_orbital_dynamics",
      inheritName: true,
      inheritIcon: true,
      inheritEffects: false,
      trigger: isNomadic(),
      modifier: (modifier) => modifier.raw("starbase_waystations_upkeep_mult", -0.2),
    },
  ],
});

const resonanceObservatory = mod.building("resonance_observatory", {
  name: "Resonance Observatory",
  desc: "A planetary observatory synchronized with the motion of the system.",
  baseBuildtime: 360,
  category: "research",
  icon: "building_research_lab_1",
  buildingSets: ["research"],
  canBuild: true,
  prerequisites: [orbitalDynamics],
  planetModifier: (modifier) => modifier.planet.jobs.physics.research.produces.mult(0.1),
});

const orbitalForecasting = mod.technology("orbital_forecasting", {
  name: "Orbital Forecasting",
  desc: "Each refinement makes long-range orbital predictions more accurate.",
  area: "physics",
  tier: 5,
  category: "computing",
  cost: 10_000,
  costPerLevel: 2_500,
  levels: -1,
  prerequisites: [orbitalDynamics],
  weight: 50,
  weightGroups: ["repeatable"],
  modWeightIfGroupPicked: { repeatable: 0.01 },
  modifier: (modifier) => modifier.all.technology.research.speed(0.02),
  aiWeight: { base: 1 },
});

export const feature = mod.feature("orbital_science", [
  unlockTitle,
  unlockDesc,
  gatewayDescription,
  orbitalDynamics,
  resonanceObservatory,
  orbitalForecasting,
]);

export default mod.compile([feature]);
