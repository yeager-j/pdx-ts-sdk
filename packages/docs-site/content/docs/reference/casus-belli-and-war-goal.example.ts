import { createMod } from "@pdx-ts/sdk";
import { and, hasClaim, isCountryType, isNomadic } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Frontier Claims",
  prefix: "frontier_claims",
  supportedVersion: "v4.4.*",
});

const frontierClaim = mod.casusBelli("frontier_claim", {
  name: "Frontier Claim",
  hint: "Claim a neighboring empire's frontier systems.",
  potential: and(isCountryType("default"), isNomadic(false)),
  isValid: (ctx) => hasClaim(ctx.from),
  showNotification: false,
  showInDiplomacy: true,
});

const frontierConquest = mod.warGoal("frontier_conquest", {
  name: "Frontier Conquest",
  desc: "Take claimed systems from the target empire.",
  casusBelli: frontierClaim,
  threatMultiplier: 0.75,
  potential: isNomadic(false),
  possible: (ctx) => ctx.from.trigger(isNomadic(false)),
  allowedPeaceOffers: ["status_quo", "surrender", "demand_surrender"],
  aiWeight: { base: 2 },
});

export const feature = mod.feature("frontier_war", [frontierClaim, frontierConquest]);

export default mod.compile([feature]);
