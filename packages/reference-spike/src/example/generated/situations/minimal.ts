// Extracted from packages/reference-spike/content/situations.mdx:122 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="minimal"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Quiet Drift",
  prefix: "quiet" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const drift = mod.situationType("drift", {
  name: "Quiet Drift",
  monthlyProgress: { base: 1 },
});

export const feature = mod.feature("drift", [drift]);
