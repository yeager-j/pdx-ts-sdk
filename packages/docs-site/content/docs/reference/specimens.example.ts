import { createMod } from "@pdx-ts/sdk";
import { hasAuthority } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Synthetic Archive",
  prefix: "synthetic_archive",
  supportedVersion: "v4.4.*",
});

const archiveCore = mod.specimen("archive_core", {
  name: "Synthetic Archive Core",
  descShort: "A memory lattice recovered from a silent machine world.",
  descDetails: "Its records preserve the rise and fall of a synthetic civilization.",
  icon: "GFX_specimen_archive_core",
  type: "historical_item",
  rarity: "rare",
  resources: [
    {
      category: "specimens",
      produces: { amounts: { unity: 5 } },
    },
  ],
  triggeredCountryModifier: [
    {
      when: hasAuthority("auth_machine_intelligence"),
      modifiers: (m) => m.country.unity.produces.mult(0.05),
    },
  ],
});

export const feature = mod.feature(undefined, [archiveCore]);

export default mod.compile([feature]);
