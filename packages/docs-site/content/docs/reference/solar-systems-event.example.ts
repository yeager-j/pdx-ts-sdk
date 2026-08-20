import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Cartography",
  prefix: "frontier_cartography",
  supportedVersion: "v4.4.*",
});

const reachName = mod.localization("LOST_REACH_SYSTEM", "The Lost Reach");
const archiveName = mod.localization("LOST_REACH_ARCHIVE", "Archive");
const sentinelName = mod.localization("LOST_REACH_SENTINEL", "Sentinel");

const sentinel = mod.solarSystemInitializer("lost_reach_sentinel", {
  name: sentinelName.key,
  class: "sc_m",
  planet: [
    { class: "star", orbitDistance: 0, size: 20 },
    { class: "pc_barren", orbitDistance: 45, size: 10 },
  ],
});

const lostReach = mod.solarSystemInitializer("lost_reach", {
  name: reachName.key,
  class: "sc_neutron_star",
  flags: ["frontier_cartography_lost_reach"],
  preventAnomalies: true,
  asteroidBelt: [
    { type: "rocky_asteroid_belt", radius: 75 },
    { type: "icy_asteroid_belt", radius: 135 },
  ],
  planet: [
    { class: "star", orbitDistance: 0, size: 25 },
    {
      name: archiveName.key,
      class: "pc_relic",
      orbitDistance: 70,
      orbitAngle: 40,
      size: 16,
      moon: [
        { class: "pc_asteroid", orbitDistance: 8, size: 3 },
        { class: "none", orbitDistance: 10 },
        { class: "pc_ice_asteroid", orbitDistance: 6, size: 4 },
      ],
      initEffect: (planet) => {
        planet.setPlanetFlag("frontier_cartography_lost_archive");
      },
    },
    { class: "pc_gas_giant", orbitDistance: 55, size: 24, hasRing: true },
  ],
  mandatoryNeighbors: true,
  neighborSystem: [
    {
      initializer: sentinel,
      distance: { min: 20, max: 35 },
      minOrientationAngle: 25,
      maxOrientationAngle: 65,
    },
  ],
});

const events = mod.namespace("lost_reach");

const spawnLostReach = events.system(1, {
  isTriggeredOnly: true,
  immediate: (system) => {
    system.spawnSystem({
      initializer: lostReach,
      minDistance: 30,
      maxDistance: 50,
      hyperlane: true,
      isDiscovered: false,
      effect: (newSystem) => {
        newSystem.setStarFlag("frontier_cartography_spawned_lost_reach");
      },
    });
  },
});

export const feature = mod.feature("lost_reach", [
  reachName,
  archiveName,
  sentinelName,
  sentinel,
  lostReach,
  spawnLostReach,
]);

export default mod.compile([feature]);
