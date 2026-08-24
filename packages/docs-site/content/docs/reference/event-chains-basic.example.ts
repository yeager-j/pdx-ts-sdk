import { createMod, type CapabilityFeature } from "@pdx-ts/sdk";
import { vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Crystal Mystery",
  prefix: "crystal_mystery",
  supportedVersion: "v4.4.*",
});

const crystalMystery = mod.eventChain("signal", {
  title: "The Crystal Signal",
  desc: "A repeating signal points toward an unexplained crystalline structure.",
  icon: "gfx/interface/icons/situation_log/situation_log_quest.dds",
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
});

export const feature: CapabilityFeature<"crystal_mystery"> = mod.feature("crystal_signal", [
  crystalMystery,
]);

export default mod.compile([feature]);
