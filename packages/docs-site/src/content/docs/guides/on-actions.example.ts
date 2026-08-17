import { createMod, onActions } from "@pdx-ts/sdk";

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
  options: [{ name: "Begin the search.", key: "begin_search" }],
});

const atGameStart = mod.on(onActions.onGameStartCountry, [firstSignal]);

export const feature = mod.feature("awakening", [firstSignal, atGameStart]);

export default mod.compile([feature]);
