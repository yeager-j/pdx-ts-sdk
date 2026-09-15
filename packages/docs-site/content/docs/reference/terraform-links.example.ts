import { createMod } from "@pdx-ts/sdk";
import {
  and,
  anyOwnedMission,
  hasAscensionPerk,
  hasModifier,
  hasPlanetFlag,
  hasTechnology,
  isMissionType,
  not,
  vanilla,
} from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Biosphere Restoration",
  prefix: "biosphere_restoration",
  supportedVersion: "v4.4.*",
});

const dormantNetwork = mod.staticModifier("dormant_biosphere_network", {
  hostScope: "planet",
  name: "Dormant Biosphere Network",
  desc: "A dormant ecological network can restore this world.",
  customTooltip: "Only the marked labour target can use this route.",
});

const activeStables = mod.mission("active_stables", {
  name: "Active Stables",
  picture: vanilla.spriteType("GFX_evt_inf_planetary_crust_drilling"),
});

const ocean = vanilla.planetClass("pc_ocean");
const gaia = vanilla.planetClass("pc_gaia");
const terraforming = vanilla.economicCategory("terraforming");
const terrestrialSculpting = vanilla.technology("tech_terrestrial_sculpting");
const worldShaper = vanilla.ascensionPerk("ap_world_shaper");
const actorRequirements = and(
  hasTechnology(terrestrialSculpting),
  anyOwnedMission(isMissionType(activeStables))
);

const ordinaryRestoration = mod.terraformLink("ocean_restoration", {
  from: ocean,
  to: gaia,
  resources: [{ category: terraforming, cost: { amounts: { energy: 7_500 } } }],
  duration: 3_600,
  potential: (ctx) =>
    and(
      ctx.from.trigger(hasPlanetFlag("biosphere_restoration_labour_target")),
      ctx.from.trigger(hasModifier(dormantNetwork)),
      not(hasAscensionPerk(worldShaper))
    ),
  condition: actorRequirements,
  effect: (country, ctx) => {
    country.setCountryFlag("biosphere_restoration_complete");
    ctx.from.effects((planet) => planet.removeModifier(dormantNetwork));
  },
  aiWeight: { base: 1 },
  onQueued: (planet, ctx) => {
    planet.setPlanetFlag("biosphere_restoration_queued");
    ctx.from.effects((country) => country.setCountryFlag("biosphere_restoration_active"));
  },
  onUnqueued: (planet, ctx) => {
    planet.removePlanetFlag("biosphere_restoration_queued");
    ctx.from.effects((country) => country.removeCountryFlag("biosphere_restoration_active"));
  },
});

const worldShaperRestoration = mod.terraformLink("ocean_restoration_world_shaper", {
  from: ocean,
  to: gaia,
  resources: [{ category: terraforming, cost: { amounts: { energy: 7_500 } } }],
  duration: 1_800,
  potential: (ctx) =>
    and(
      ctx.from.trigger(hasPlanetFlag("biosphere_restoration_labour_target")),
      ctx.from.trigger(hasModifier(dormantNetwork)),
      hasAscensionPerk(worldShaper)
    ),
  condition: actorRequirements,
  effect: (country, ctx) => {
    country.setCountryFlag("biosphere_restoration_complete");
    ctx.from.effects((planet) => planet.removeModifier(dormantNetwork));
  },
  aiWeight: { base: 1 },
  onQueued: (planet) => planet.setPlanetFlag("biosphere_restoration_queued"),
  onUnqueued: (planet) => planet.removePlanetFlag("biosphere_restoration_queued"),
});

export const feature = mod.feature("biosphere_restoration", [
  dormantNetwork,
  activeStables,
  ordinaryRestoration,
  worldShaperRestoration,
]);

export default mod.compile([feature]);
