import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Voices",
  prefix: "frontier_voices",
  supportedVersion: "v4.4.*",
});

const formalGreeting = mod.localization("formal_greeting", "We greet you in peace.");
const curiousGreeting = mod.localization("curious_greeting", "Your signal has our attention.");

const greeting = mod.scriptedLoc("frontier_greeting", {
  random: true,
  text: [
    { weight: 3, localizationKey: formalGreeting.key },
    { weight: 1, localizationKey: curiousGreeting.key },
  ],
});

const transmission = mod.localization(
  "transmission",
  `Incoming transmission: [Root.${greeting.id}]`
);

export const feature = mod.feature("greetings", [
  formalGreeting,
  curiousGreeting,
  greeting,
  transmission,
]);

export default mod.compile([feature]);
