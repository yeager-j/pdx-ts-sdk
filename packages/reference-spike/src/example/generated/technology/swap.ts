// Extracted from packages/reference-spike/content/technology.mdx:363 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="swap"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod, hasCountryFlag } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Rite Engines",
  prefix: "rite" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const resonantDrive = mod.technology("resonant_drive", {
  name: "Resonant Drive",
  desc: "A field that pushes against the shape of space rather than through it.",
  area: "physics",
  tier: 3,
  category: "field_manipulation",
  cost: 6000,
  technologySwap: [
    {
      // The swap's own id, and the localization key its name is written under.
      // Nothing mints this one for you.
      name: "rite_tech_choral_drive",
      trigger: hasCountryFlag("rite_choir_ascendant"),
      inheritIcon: false,
      area: "society",
      category: ["statecraft"],
      weight: 120,
    },
  ],
});

export const feature = mod.feature("resonant_drive", [resonantDrive]);
