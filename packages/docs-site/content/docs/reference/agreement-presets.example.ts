import { createMod } from "@pdx-ts/sdk";
import { vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Frontier Tribute",
  prefix: "frontier_tribute",
  supportedVersion: "v4.4.*",
});

const frontierTribute = mod.agreementPreset("frontier_tribute", {
  name: "Frontier Tribute",
  desc: "An independent subject pays for protection at the frontier.",
  flavor: "Security in exchange for a share of frontier production.",
  icon: vanilla.spriteType("GFX_diplomacy_status_is_tributary"),
  termData: {
    discreteTerms: [
      { key: "specialist_type", value: "specialist_none" },
      { key: "subject_integration", value: "subject_can_not_be_integrated" },
      { key: "subject_diplomacy", value: "subject_can_do_diplomacy" },
      { key: "joins_overlord_wars", value: "joins_overlord_wars_none" },
      { key: "subject_holdings_limit", value: "subject_holdings_limit_0" },
    ],
    resourceTerms: [{ key: "resource_subsidies_basic", value: 0.3 }],
  },
  overlordWeight: { base: 90 },
  subjectWeight: { base: 50 },
  hidden: false,
  shouldAiUseForProposals: true,
  canPresetBeChanged: true,
});

export const feature = mod.feature("frontier_tribute", [frontierTribute]);

export default mod.compile([feature]);
