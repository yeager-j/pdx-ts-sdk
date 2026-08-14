// Extracted from packages/reference-spike/content/situations.mdx:524 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="section-weights"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Terraform Reshape",
  prefix: "terra" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const reshape = mod.situationType("reshape", {
  name: "Terraform Reshape",
  monthlyProgress: { base: 5 },
  totalProgress: { base: 600 },
  stages: {
    terra_reshape_seed: {
      name: "Seeding",
      icon: "GFX_situation_stage_seed",
      iconBackground: "GFX_situation_stage_seed_bg",
      sectionWeight: { base: 25 },
    },
    terra_reshape_bloom: {
      name: "Blooming",
      icon: "GFX_situation_stage_bloom",
      iconBackground: "GFX_situation_stage_bloom_bg",
      sectionWeight: { base: 75 },
    },
  },
});

export const feature = mod.feature("reshape", [reshape]);
