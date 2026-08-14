// Extracted from packages/reference-spike/content/technology.mdx:313 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="weighting"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod, hasCountryFlag } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Hydro Survey",
  prefix: "hydro" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

export const tidalMapping = mod.technology("tidal_mapping", {
  name: "Tidal Mapping",
  desc: "The moon pulls the same ocean twice a day, and it writes it down.",
  area: "society",
  tier: 2,
  category: "new_worlds",
  cost: 2000,
  weight: 100,
  weightModifier: {
    modifiers: [
      {
        factor: 3,
        desc: "The survey fleet has already found something down there.",
        // Without this the row's localization key is a hash of the sentence
        // above, and editing the sentence orphans the translation.
        descKey: "anomaly_logged",
        when: hasCountryFlag("hydro_anomaly_logged"),
      },
    ],
  },
  aiWeight: { factor: 0.5 },
});

export const feature = mod.feature("tidal_mapping", [tidalMapping]);
