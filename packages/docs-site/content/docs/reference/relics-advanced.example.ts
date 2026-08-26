import { createMod } from "@pdx-ts/sdk";
import { always, onActions, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Echo Archive",
  prefix: "echo_archive",
  supportedVersion: "v4.4.*",
});

const echoLens = mod.relic("echo_lens", {
  name: "Echo Lens",
  desc: "A crystalline lens that reveals impressions left by ancient observers.",
  portrait: vanilla.spriteType("GFX_relic_ancient_sword"),
  sound: "relic_activation",
  activationDuration: 3_600,
  canBeStolen: false,
  score: 1_000,
  possible: always(),
  resources: [
    {
      category: "relics",
      cost: { amounts: { unity: 1_500 } },
    },
  ],
  triggeredCountryModifier: [
    {
      when: always(),
      modifiers: (modifier) => modifier.country.physics.research.produces.mult(0.1),
    },
  ],
  activeEffect: (country) => {
    country.addResource({ resource: "physics_research", amount: 2_500 });
    country.addModifier({ modifier: "relic_activation_cooldown", days: 3_600 });
  },
  aiWeight: { base: 10 },
});

const events = mod.namespace("lens");
const discoverLens = events.country(1, {
  hideWindow: true,
  isTriggeredOnly: true,
  immediate: (country) => country.addRelic(echoLens),
});

const grantLens = mod.on(onActions.onGameStartCountry, [discoverLens]);

export const feature = mod.feature("echo_lens", [echoLens, discoverLens, grantLens]);

export default mod.compile([feature]);
