import { createMod, hasAuthority, not, numAscensionPerks } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Adaptive Destinies",
  prefix: "adaptive_destinies",
  supportedVersion: "v4.4.*",
});

const baseTooltip = mod.localization(
  "adaptive_destinies_perk_tooltip",
  "Unlocks projects that adapt our institutions to new forms of intelligence."
);

const machineTooltip = mod.localization(
  "adaptive_destinies_machine_tooltip",
  "Machine empires also improve Engineering Research."
);

const adaptiveDestinies = mod.ascensionPerk("adaptive_destinies", {
  name: "Adaptive Destinies",
  desc: "No single form of government can contain every possible future.",
  potential: not(hasAuthority("auth_hive_mind")),
  possible: numAscensionPerks(">=", 2),
  modifier: (modifier) => modifier.country.unity.produces.mult(0.1),
  triggeredModifier: [
    {
      when: hasAuthority("auth_machine_intelligence"),
      modifiers: (modifier) => modifier.country.engineering.research.produces.mult(0.1),
    },
  ],
  onEnabled: (country) => country.setCountryFlag("adaptive_destinies_adopted"),
  customTooltip: baseTooltip.key,
  traditionSwap: {
    adaptive_destinies_ascension_perk_machine_destinies: {
      name: "Machine Destinies",
      flavor: "Every possible future can be evaluated, selected, and built.",
      effects: "Improves Unity and Engineering Research.",
      inheritIcon: true,
      inheritName: false,
      inheritEffects: false,
      customTooltipWithModifiers: [machineTooltip.key],
      modifier: (modifier) => {
        modifier.country.unity.produces.mult(0.1);
        modifier.country.engineering.research.produces.mult(0.1);
      },
      onEnabled: (country) => country.setCountryFlag("machine_destinies_adopted"),
      trigger: hasAuthority("auth_machine_intelligence"),
      weight: { base: 20 },
    },
  },
  aiWeight: {
    base: 10,
    modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
  },
});

export const feature = mod.feature("adaptive_destinies", [
  baseTooltip,
  machineTooltip,
  adaptiveDestinies,
]);

export default mod.compile([feature]);
