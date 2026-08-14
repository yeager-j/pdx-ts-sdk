// Extracted from packages/reference-spike/content/technology.mdx:144 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="prerequisites"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Deep Survey",
  prefix: "deep" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const lensing = mod.technology("lensing", {
  name: "Gravitational Lensing",
  desc: "Bending starlight around a mass tells you what is behind it.",
  area: "physics",
  tier: 2,
  category: "computing",
  cost: 2000,
  // A vanilla id is a plain string, taken as given. `vanilla.technology(...)`
  // is the checked form, against the real id set.
  prerequisites: ["tech_basic_science_lab_1"],
});

export const arrays = mod.technology("arrays", {
  name: "Distributed Lens Arrays",
  desc: "One lens is an instrument. A thousand is an observatory.",
  area: "physics",
  tier: 3,
  category: "computing",
  cost: 6000,
  // The binding, not the id — this one moves if the technology is renamed.
  prerequisites: [lensing, "tech_lasers_2"],
});

export const feature = mod.feature("lensing", [lensing, arrays]);
