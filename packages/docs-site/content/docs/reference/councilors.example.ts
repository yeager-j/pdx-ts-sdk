import { createMod } from "@pdx-ts/sdk";
import { always } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Frontier Council",
  prefix: "frontier_council",
  supportedVersion: "v4.4.*",
});

const frontierMinister = mod.councilor("frontier_minister", {
  name: "Frontier Minister",
  desc: "Coordinates the administration of distant colonies.",
  leaderClass: ["official"],
  possible: always(),
  isLeaderPossible: always(),
  modifier: (modifier) => modifier.country.unity.produces.mult(0.02),
  aiPriority: 10,
  optional: always(),
  aiHiringWeight: { base: 10 },
});

export const feature = mod.feature("frontier_councilor", [frontierMinister]);

export default mod.compile([feature]);
