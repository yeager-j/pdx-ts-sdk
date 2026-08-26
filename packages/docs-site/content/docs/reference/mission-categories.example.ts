import { createMod } from "@pdx-ts/sdk";
import { vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Signal Expeditions",
  prefix: "signal_expeditions",
  supportedVersion: "v4.4.*",
});

const signalSurvey = mod.missionCategory("signal_survey", {
  name: "Signal Surveys",
  short: "Surveys",
  isContract: false,
  mapIcon: vanilla.spriteType("GFX_nomad_contract_science_icon"),
  logIcon: "gfx/interface/icons/contracts/science_contract_icon_log.dds",
});

export const feature = mod.feature("signal_survey_category", [signalSurvey]);

export default mod.compile([feature]);
