import { and, createMod, hasAuthority, isScopeValid } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Distributed Scholarship",
  prefix: "distributed_scholarship",
  supportedVersion: "v4.4.*",
});

const effects = mod.localization(
  "scholarship_effects",
  "Improves research output and adapts its Unity bonus to oligarchic governments."
);

const oligarchicEffects = mod.localization(
  "oligarchic_scholarship_effects",
  "Oligarchic institutions gain a larger Unity bonus."
);

const distributedScholarship = mod.civicOrOrigin("distributed_scholarship", {
  name: "Distributed Scholarship",
  desc: "Every institution shares discoveries through a common civic archive.",
  icon: "gfx/interface/icons/governments/civics/civic_technocracy.dds",
  description: effects.key,
  potential: {
    authority: { not: [{ values: ["auth_corporate"] }] },
    ethics: { not: [{ values: ["ethic_gestalt_consciousness"] }] },
  },
  possible: {
    authority: {
      or: [{ values: ["auth_democratic", "auth_oligarchic"] }],
    },
    ethics: {
      or: [{ values: ["ethic_materialist", "ethic_fanatic_materialist"] }],
    },
    civics: { not: [{ values: ["civic_technocracy"] }] },
  },
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.1),
  modification: false,
  swapType: [
    {
      description: oligarchicEffects.key,
      trigger: and(isScopeValid(), hasAuthority("auth_oligarchic")),
      modifier: (modifier) => modifier.unchecked("country_unity_produces_mult", 0.1),
    },
  ],
  randomWeight: { base: 8 },
  aiWeight: {
    base: 8,
    modifiers: [{ factor: 2, when: hasAuthority("auth_oligarchic") }],
  },
});

export const feature = mod.feature("distributed_scholarship", [
  effects,
  oligarchicEffects,
  distributedScholarship,
]);

export default mod.compile([feature]);
