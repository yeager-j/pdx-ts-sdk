// Extracted from packages/reference-spike/content/technology.mdx:275 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="cost-curve"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod, hasCountryFlag } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Salvage Runs",
  prefix: "salv" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const reclamation = mod.technology("reclamation", {
  name: "Wreck Reclamation",
  desc: "Someone else's debris field is a parts bin with a bad address.",
  area: "engineering",
  tier: 2,
  category: "voidcraft",
  cost: {
    base: 3000,
    modifiers: [
      {
        factor: 0.75,
        when: hasCountryFlag("salv_salvage_doctrine"),
      },
    ],
  },
});

export const feature = mod.feature("reclamation", [reclamation]);
