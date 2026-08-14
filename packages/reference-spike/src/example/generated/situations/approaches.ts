// Extracted from packages/reference-spike/content/situations.mdx:222 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="approaches"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Algae Bloom",
  prefix: "bloom" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const algae = mod.situationType("algae", {
  name: "Algae Bloom",
  monthlyProgress: { base: 2 },
  approach: {
    bloom_algae_harvest: {
      name: "Harvest It",
      desc: "Turn the bloom into feedstock and accept the smell.",
      icon: "GFX_situation_approach_harvest",
      iconBackground: "GFX_situation_approach_harvest_bg",
      default: true,
      modifier: (m) => m.country.food.produces.mult(0.05),
    },
    bloom_algae_purge: {
      name: "Purge It",
      desc: "Bleach the shallows and start the ecology over.",
      icon: "GFX_situation_approach_purge",
      iconBackground: "GFX_situation_approach_purge_bg",
      modifier: (m) => m.country.unity.produces.mult(-0.02),
    },
  },
});

export const feature = mod.feature("algae", [algae]);
