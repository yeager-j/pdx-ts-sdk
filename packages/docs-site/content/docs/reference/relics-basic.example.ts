import { createMod } from "@pdx-ts/sdk";
import { always, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Echo Archive",
  prefix: "echo_archive",
  supportedVersion: "v4.4.*",
});

const echoLens = mod.relic("echo_lens", {
  name: "Echo Lens",
  desc: "A crystalline lens that reveals impressions left by ancient observers.",
  portrait: vanilla.spriteType("GFX_relic_ancient_sword"),
  possible: always(),
  activeEffect: (country) => {
    country.addResource({ resource: "physics_research", amount: 1_000 });
  },
});

export const feature = mod.feature("echo_lens", [echoLens]);

export default mod.compile([feature]);
