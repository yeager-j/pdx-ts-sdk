// Extracted from packages/reference-spike/content/situations.mdx:331 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="progress"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod, hasSituationFlag, not } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Hull Rust",
  prefix: "rust" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const decay = mod.situationType("decay", {
  name: "Hull Rust",
  monthlyProgress: {
    base: 2,
    modifiers: [
      {
        factor: 1.5,
        descKey: "corrosion_spreading",
        desc: "Corrosion is spreading through the frame.",
        when: hasSituationFlag("rust_corrosion_spreading"),
      },
      {
        subtract: 1,
        descKey: "drydock_holding",
        desc: "Drydock crews are keeping ahead of it.",
        when: not(hasSituationFlag("rust_corrosion_spreading")),
      },
    ],
  },
});

export const feature = mod.feature("decay", [decay]);
