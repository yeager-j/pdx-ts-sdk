// Extracted from packages/reference-spike/content/technology.mdx:211 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="unlocks"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Foundry Works",
  prefix: "forge" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

// Two keys of this mod's own, so the unlock line has something to look up.
const platingTitle = mod.localization("unlock_plating", {
  english: "Reinforced Hull Plating",
});
const platingDesc = mod.localization("unlock_plating_desc", {
  english: "Ships refitted after this carry a second layer at no upkeep.",
});

export const microforge = mod.technology("microforge", {
  // `name` and `desc` here *are* English: they are localization slots the
  // build writes the keys for. The two fields below are the other kind.
  name: "Microforge Casting",
  desc: "Alloy poured in a vacuum sets without a grain to crack along.",
  area: "engineering",
  tier: 2,
  category: "materials",
  cost: 2000,
  // Runs in country scope, because a technology is a thing an empire has.
  modifier: (m) => {
    m.country.alloys.produces.mult(0.05);
  },
  prereqforDesc: [
    {
      custom: [{ title: platingTitle.key, desc: platingDesc.key }],
    },
  ],
});

export const feature = mod.feature("microforge", [microforge, platingTitle, platingDesc]);
