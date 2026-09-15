import { createMod } from "@pdx-ts/sdk";
import { vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Quiet Tide",
  prefix: "quiet_tide",
  supportedVersion: "v4.4.*",
});

const quietTide = mod.stormType("quiet_tide", {
  name: "Quiet Tide",
  desc: "A slow cosmic storm that drifts through the outer systems.",
  stormMinRadius: { base: 15 },
  stormMaxRadius: { base: 25 },
  stormMinSteps: { base: 2 },
  stormMaxSteps: { base: 4 },
  stormSpeed: { base: 0.02 },
  stormActivationPeriodInMonths: { base: 12 },
  stormMonthlyAddedDevastation: { base: 0.005 },
  spawnWeight: 0,
  cosmicStormTexturePath: "gfx/map/storms/NebulaOpacity.dds",
  cosmicStormTextureColorPath: "gfx/map/storms/celestial_storm_color.dds",
  cosmicStormEventSprite: vanilla.spriteType("GFX_celestial_storm"),
  icon: vanilla.spriteType("GFX_planetview_storm_celestial_modifier_frame"),
});

export const feature = mod.feature("quiet_tide", [quietTide]);

export default mod.compile([feature]);
