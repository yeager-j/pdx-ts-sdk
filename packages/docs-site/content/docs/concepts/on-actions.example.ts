import { createMod } from "@pdx-ts/sdk";
import { onActions, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("awakening");

const firstSignal = events.country(1, {
  title: "The First Signal",
  desc: "On the first day of our new era, the stars answer back.",
  isTriggeredOnly: true,
  immediate: (country) => {
    country.addResource({ resource: "influence", amount: 50 });
  },
  options: [{ name: { english: "Begin the search.", key: "begin_search" } }],
});

const atGameStart = mod.on(onActions.onGameStartCountry, [firstSignal]);
const atFiveYearPulse = mod.on(onActions.onFiveYearPulse, {
  randomEvents: [{ weight: 150 }, { weight: 50, event: vanilla.event.situation.$2000 }],
});

export const feature = mod.feature("awakening", [firstSignal, atGameStart, atFiveYearPulse]);

export default mod.compile([feature]);
