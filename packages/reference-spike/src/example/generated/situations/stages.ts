// Extracted from packages/reference-spike/content/situations.mdx:166 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="stages"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Tidal Swell",
  prefix: "tide" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const swell = mod.situationType("swell", {
  name: "Tidal Swell",
  monthlyProgress: { base: 3 },
  stages: {
    tide_swell_calm: {
      name: "Calm",
      desc: "The tide charts still look ordinary.",
      icon: "GFX_situation_stage_calm",
      iconBackground: "GFX_situation_stage_calm_bg",
      end: { base: 40 },
    },
    tide_swell_surge: {
      name: "Surge",
      desc: "Coastal cities are moving inland.",
      icon: "GFX_situation_stage_surge",
      iconBackground: "GFX_situation_stage_surge_bg",
      end: { base: 100 },
    },
  },
});

export const feature = mod.feature("swell", [swell]);
