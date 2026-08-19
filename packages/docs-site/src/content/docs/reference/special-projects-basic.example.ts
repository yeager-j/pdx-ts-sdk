import { createMod, vanilla } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Deep Core Operation",
  prefix: "deep_core",
  supportedVersion: "v4.4.*",
});

const drillCrust = mod.specialProject("drill_crust", {
  name: "Drill the Planetary Crust",
  desc: "Assign a construction ship to open a path into the deep crust.",
  cost: 0,
  daysToResearch: 180,
  picture: vanilla.spriteType("GFX_evt_inf_planetary_crust_drilling"),
  icon: "gfx/interface/icons/situation_log/situation_log_main_quest.dds",
  eventScope: "ship_event",
  requirements: { shipclassConstructor: 1 },
});

export const feature = mod.feature("deep_core_operation", [drillCrust]);

export default mod.compile([feature]);
