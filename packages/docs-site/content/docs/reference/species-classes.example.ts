import { always, createMod, vanilla } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Kin",
  prefix: "frontier_kin",
  supportedVersion: "v4.4.*",
});

const wanderer = mod.speciesClass("wanderer", {
  name: "Wanderer",
  desc: "A hardy lineage shaped by generations beyond settled space.",
  plural: "Wanderers",
  archetype: "BIOLOGICAL",
  trait: "trait_organic",
  graphicalCulture: vanilla.graphicalCulture("mammalian_01"),
  movePopSoundEffect: "moving_pop_confirmation",
  playable: always(),
  randomized: true,
  gender: true,
  useClimatePreference: true,
  portraitModding: true,
  resources: [],
});

export const feature = mod.feature("wanderer", [wanderer]);

export default mod.compile([feature]);
