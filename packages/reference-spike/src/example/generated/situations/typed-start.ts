// Extracted from packages/reference-spike/content/situations.mdx:414 by src/build/stories.ts. Do not edit.
// Edit the fenced `story="typed-start"` block in that file and re-run:
//   npm run stories -w @pdx-ts/reference-spike

import { createMod, eventTarget, hasCountryFlag, not } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Orbital Drift",
  prefix: "drift" as const,
  version: "0.1.0",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace();

export const orbit = mod.situationType("orbit", {
  name: "Orbital Drift",
  monthlyProgress: { base: 3 },
  potential: not(hasCountryFlag("drift_orbit_resolved")),
  targetScope: "planet",
  onStart: (situation) => situation.setSituationFlag("drift_orbit_started"),
});

const driftingWorld = eventTarget<"planet">("drift_drifting_world");

export const discovered = events.country(1, {
  title: "A World Adrift",
  desc: "Long-range survey confirms the orbit is decaying.",
  isTriggeredOnly: true,
  immediate: (country) => {
    country.startSituation({
      type: orbit,
      target: driftingWorld,
      // The body's `target(...)` is a planet scope because the declaration
      // above said so. No second type argument needed.
      effect: (situation) => {
        situation.target((planet) => planet.setPlanetFlag("drift_drifting"));
      },
    });
  },
});

export const feature = mod.feature("orbit", [orbit, discovered]);
