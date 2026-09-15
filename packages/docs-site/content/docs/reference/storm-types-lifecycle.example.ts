import { createMod } from "@pdx-ts/sdk";
import {
  always,
  and,
  hasStormFlag,
  isStormType,
  starFlags,
  stormFlags,
  vanilla,
} from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Aurora Wake",
  prefix: "aurora_wake",
  supportedVersion: "v4.4.*",
});

const stormState = stormFlags("aurora_wake_tracked");
const systemState = starFlags("aurora_wake_present");

const auroraWake = mod.stormType("aurora_wake", {
  name: "Aurora Wake",
  desc: "A luminous front that disrupts ships and energizes exposed worlds.",
  colorTooltip: "Systems in the Aurora Wake shimmer with charged particles.",
  description: "A ribbon of charged light is crossing the galaxy.",
  customTooltip: "The wake slows fleets while increasing storm devastation.",
  stormMinRadius: { base: 20 },
  stormMaxRadius: { base: 35 },
  stormMinSteps: { base: 3 },
  stormMaxSteps: { base: 6 },
  stormSpeed: { base: 0.04 },
  stormActivationPeriodInMonths: { base: 6 },
  stormMonthlyAddedDevastation: { base: 0.01 },
  affectShieldRegen: true,
  occludeSystem: true,
  spawnWeight: { base: 0 },
  triggeredFleetModifier: [
    { when: always(), modifiers: (modifier) => modifier.unchecked("ship_speed_mult", -0.2) },
  ],
  triggeredPlanetModifier: [
    { when: always(), modifiers: (modifier) => modifier.planet.storm.devastation.mult(0.5) },
  ],
  triggeredSystemModifier: [
    { when: always(), modifiers: (modifier) => modifier.system.storm.influence.add(1) },
  ],
  onStart: (storm) => {
    storm.everySystemWithinStorm({}, (system) => {
      system.setStarFlag(systemState.aurora_wake_present);
    });
  },
  onMoved: (storm) => {
    storm.everySystemAddedToStorm({}, (system) => {
      system.setStarFlag(systemState.aurora_wake_present);
    });
    storm.everySystemRemovedFromStorm({}, (system) => {
      system.removeStarFlag(systemState.aurora_wake_present);
    });
  },
  onFinished: (storm) => {
    storm.everySystemWithinStorm({}, (system) => {
      system.removeStarFlag(systemState.aurora_wake_present);
    });
  },
  cosmicStormTexturePath: "gfx/map/storms/NebulaOpacity.dds",
  cosmicStormTextureColorPath: "gfx/map/storms/electric_storm_color.dds",
  cosmicStormTextureLightningPaths: [
    "gfx/map/storms/lightning/lightning_big_storm_01.dds",
    "gfx/map/storms/lightning/lightning_mid_storm_01.dds",
  ],
  cosmicStormGalaxyLightningTime: 6,
  cosmicStormGalaxyMaxOpacity: 0.45,
  cosmicStormEventSprite: vanilla.spriteType("GFX_electric_storm"),
  icon: vanilla.spriteType("GFX_planetview_storm_electric_modifier_frame"),
  showNotification: always(),
});

const events = mod.namespace("control");

const createAuroraWake = events.country(1, {
  hideWindow: true,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.createCosmicStorm({
      type: auroraWake,
      cosmicStormStartPosition: "random",
      immediate: true,
    });
    country.lastCreatedCosmicStorm.effects((storm) => {
      storm.setStormFlag(stormState.aurora_wake_tracked);
    });
  },
});

const removeAuroraWake = events.country(2, {
  hideWindow: true,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.everyCosmicStorm(
      {
        limit: and(isStormType(auroraWake), hasStormFlag(stormState.aurora_wake_tracked)),
      },
      (storm) => storm.destroyCosmicStorm()
    );
  },
});

export const feature = mod.feature("aurora_wake", [auroraWake, createAuroraWake, removeAuroraWake]);

export default mod.compile([feature]);
