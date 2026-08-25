import { createMod } from "@pdx-ts/sdk";
import { hasAuthority } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Luminous Economy",
  prefix: "luminous_economy",
  supportedVersion: "v4.4.*",
});

const resolve = mod.resource("resolve", {
  name: "Resolve",
  desc: "Collective commitment to a purpose larger than survival.",
  tradable: false,
  category: "other",
  allowDeficit: false,
  visibilityPrerequisite: hasAuthority("auth_democratic"),
  aiWeight: { weight: 1 },
});

const volatileIsotopes = mod.resource("volatile_isotopes", {
  name: "Volatile Isotopes",
  desc: "Unstable matter used by advanced industrial processes.",
  tradable: true,
  category: "strategic",
  marketAmount: 10,
  marketPrice: 20,
  max: 5_000,
  specialMaxAmount: true,
  tooltipDecimals: 1,
  aiWeight: {
    base: 5,
    modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
  },
  aiWants: { base: 10 },
});

export const feature = mod.feature("resources", [resolve, volatileIsotopes]);

export default mod.compile([feature]);
