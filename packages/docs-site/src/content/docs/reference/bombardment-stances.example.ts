import { createMod, hasPolicyFlag, owner } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Measured Bombardment",
  prefix: "measured_bombardment",
  supportedVersion: "v4.4.*",
});

const measured = mod.bombardmentStance("measured", {
  name: "Measured",
  desc: "Target defenses while limiting civilian harm.",
  trigger: owner(hasPolicyFlag("orbital_bombardment_selective")),
  default: false,
  stopWhenArmiesDead: true,
  stopWhenGroundCombat: true,
  acceptSurrender: true,
  abductPops: false,
  planetDamage: 0.5,
  armyDamage: 1,
  killPopChance: { base: 0.25 },
  minPopsToKillPop: 2100,
  killPopAmount: { min: 0, max: 200 },
  aiWeight: { base: 1 },
});

export const feature = mod.feature("measured_bombardment", [measured]);

export default mod.compile([feature]);
