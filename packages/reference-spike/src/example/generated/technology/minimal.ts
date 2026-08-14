// Extracted from packages/reference-spike/content/technology.mdx:76 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="minimal"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Lumen Survey",
  prefix: "lumen" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const optics = mod.technology("optics", {
  name: "Coherent Optics",
  area: "physics",
  tier: 1,
  category: "particles",
});

export const feature = mod.feature("optics", [optics]);
