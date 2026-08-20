import {
  createMod,
  hasCompletedEventChainCounter,
  isAi,
  onActions,
  vanilla,
  type CapabilityFeature,
} from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Mystery",
  prefix: "crystal_mystery",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("signal");
const signalsDecoded = mod.localization("signals_decoded", "Signals decoded");

const crystalMystery = mod.eventChain("signal", {
  title: "The Crystal Signal",
  desc: "Decode two transmissions hidden in the repeating signal.",
  icon: "gfx/interface/icons/situation_log/situation_log_quest.dds",
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
  counter: { [signalsDecoded.key]: { max: 2 } },
});

const signalCompleted = events.country(3, {
  title: "The Crystal Pattern",
  desc: "Together, the transmissions form a complete map of the crystal's internal structure.",
  eventChain: crystalMystery,
  isTriggeredOnly: true,
  options: [
    {
      name: "Archive the completed pattern.",
      key: "archive_pattern",
      effects: (country) => {
        country.addResource({ resource: "physics_research", amount: 500 });
        country.endEventChain(crystalMystery);
      },
    },
  ],
});

const secondSignal = events.country(2, {
  title: "The Second Pattern",
  desc: "A second transmission may complete the pattern hidden in the signal.",
  eventChain: crystalMystery,
  isTriggeredOnly: true,
  options: [
    {
      name: "Add it to the record.",
      key: "record_second_signal",
      effects: (country) => {
        country.addEventChainCounter({
          eventChain: crystalMystery,
          counter: signalsDecoded.key,
          amount: 1,
        });
        country.if(
          hasCompletedEventChainCounter({
            eventChain: crystalMystery,
            counter: signalsDecoded.key,
          }),
          (owner) => owner.countryEvent({ id: signalCompleted })
        );
      },
    },
  ],
});

const firstSignal = events.country(1, {
  title: "A Signal in the Noise",
  desc: "Sensors have isolated the first repeating crystalline transmission.",
  eventChain: crystalMystery,
  isTriggeredOnly: true,
  trigger: isAi(false),
  options: [
    {
      name: "Record it and keep listening.",
      key: "record_first_signal",
      effects: (country, ctx) => {
        country.beginEventChain({ eventChain: crystalMystery, target: ctx.self });
        country.addEventChainCounter({
          eventChain: crystalMystery,
          counter: signalsDecoded.key,
          amount: 1,
        });
        country.countryEvent({ id: secondSignal });
      },
    },
  ],
});

const startSignal = mod.on(onActions.onGameStartCountry, [firstSignal]);

export const feature: CapabilityFeature<"crystal_mystery"> = mod.feature("crystal_signal", [
  signalsDecoded,
  crystalMystery,
  firstSignal,
  secondSignal,
  signalCompleted,
  startSignal,
]);

export default mod.compile([feature]);
