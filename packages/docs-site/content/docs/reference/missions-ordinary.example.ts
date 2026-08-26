import { createMod, type CapabilityFeature } from "@pdx-ts/sdk";
import { onActions, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Signal Expeditions",
  prefix: "signal_expeditions",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("survey");
const signalsDecoded = mod.localization("signals_decoded", "Signals decoded");

const signalSurveyCategory = mod.missionCategory("signal_survey", {
  name: "Signal Surveys",
  short: "Surveys",
  isContract: false,
  mapIcon: vanilla.spriteType("GFX_nomad_contract_science_icon"),
  logIcon: "gfx/interface/icons/contracts/science_contract_icon_log.dds",
});

const signalSurveyChain = mod.eventChain("signal_survey", {
  title: "The Repeating Signal",
  desc: "Decode three transmissions from an ancient relay.",
  icon: "gfx/interface/icons/situation_log/situation_log_quest.dds",
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
});

const decodeSignals = mod.mission("decode_signals", {
  name: "Decode the Signal",
  desc: "Recover three complete transmissions from the ancient relay.",
  category: signalSurveyCategory,
  eventChain: signalSurveyChain,
  picture: "GFX_event_pictures_ancient_ruins",
  counter: { [signalsDecoded.key]: { max: 3 } },
  onSuccess: (country) => {
    country.addResource({ resource: "physics_research", amount: 500 });
  },
  onCancel: (country) => country.setCountryFlag("signal_survey_failed"),
  onStop: (country) => country.endEventChain(signalSurveyChain),
});

const finishSurvey = events.country(2, {
  title: "A Complete Transmission",
  desc: "The recovered fragments resolve into a complete scientific archive.",
  eventChain: signalSurveyChain,
  isTriggeredOnly: true,
  options: [
    {
      name: "Archive the result.",
      key: "archive_signal",
      effects: (country) => {
        country.addMissionCounter({
          mission: decodeSignals,
          counter: signalsDecoded.key,
          amount: 3,
        });
        country.stopMission({ mission: decodeSignals, status: "success" });
      },
    },
  ],
});

const startSurvey = events.country(1, {
  title: "A Repeating Signal",
  desc: "An ancient relay is broadcasting a structured transmission.",
  eventChain: signalSurveyChain,
  isTriggeredOnly: true,
  options: [
    {
      name: "Begin decoding.",
      key: "begin_decoding",
      effects: (country, ctx) => {
        country.beginEventChain({ eventChain: signalSurveyChain, target: ctx.self });
        country.enableMission({ name: decodeSignals });
        country.countryEvent({ id: finishSurvey });
      },
    },
  ],
});

const beginSurvey = mod.on(onActions.onGameStartCountry, [startSurvey]);

export const feature: CapabilityFeature<"signal_expeditions"> = mod.feature("signal_survey", [
  signalsDecoded,
  signalSurveyCategory,
  signalSurveyChain,
  decodeSignals,
  startSurvey,
  finishSurvey,
  beginSurvey,
]);

export default mod.compile([feature]);
