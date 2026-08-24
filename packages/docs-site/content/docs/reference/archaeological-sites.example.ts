import {
  always,
  and,
  archaeologicalSite,
  createMod,
  exists,
  hasGlobalFlag,
  isAi,
  leader,
  leaderClass,
  not,
  onActions,
  vanilla,
} from "@pdx-ts/sdk";
import { defaultSiteVisibleTrigger } from "@pdx-ts/stellaris-ids/triggers";

const mod = createMod({
  name: "Silent Archive",
  prefix: "silent_archive",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("dig");

const sealedDoor = events.fleet(1, {
  scopes: { from: "archaeological_site" },
  title: "The Sealed Door",
  desc: "The excavation has reached a door with no visible controls.",
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
  location: (ctx) => ctx.from,
  archaeology: true,
  isTriggeredOnly: true,
  options: [
    {
      name: "Cut through the seal.",
      key: "cut_the_seal",
      effects: (fleet) => {
        fleet.owner.effects((country) => {
          country.addResource({ resource: "engineering_research", amount: 250 });
        });
      },
    },
  ],
});

const memoryVault = events.fleet(2, {
  scopes: { from: "archaeological_site" },
  title: "The Memory Vault",
  desc: "Rows of crystal lattices still hold fragments of their makers' memories.",
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
  location: (ctx) => ctx.from,
  archaeology: true,
  isTriggeredOnly: true,
  options: [
    {
      name: "Preserve every recoverable fragment.",
      key: "preserve_fragments",
      effects: (fleet) => {
        fleet.owner.effects((country) => {
          country.addResource({ resource: "society_research", amount: 500 });
        });
      },
    },
  ],
});

const lastCustodian = events.fleet(3, {
  scopes: { from: "archaeological_site" },
  title: "The Last Custodian",
  desc: "One machine remains awake beneath the archive and offers us its final catalogue.",
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
  location: (ctx) => ctx.from,
  archaeology: true,
  isTriggeredOnly: true,
  options: [
    {
      name: "Accept the catalogue.",
      key: "accept_catalogue",
      effects: (fleet) => {
        fleet.owner.effects((country) => {
          country.addResource({ resource: "minor_artifacts", amount: 100 });
        });
      },
    },
  ],
});

const silentArchive = mod.archaeologicalSiteType("silent_archive", {
  name: "The Silent Archive",
  desc: "An underground complex is transmitting a faint archival beacon.",
  picture: vanilla.spriteType("GFX_evt_habitable_dig_site"),
  maxInstances: 1,
  weight: 0,
  stages: 3,
  allow: (ctx) => and(exists(leader(ctx.self)), leader(leaderClass("scientist"))),
  visible: defaultSiteVisibleTrigger(),
  stage: [
    { difficulty: 2, icon: "GFX_archaeology_runes_A1", event: sealedDoor },
    {
      difficulty: { min: 3, max: 4 },
      icon: "GFX_archaeology_runes_A2",
      event: memoryVault,
    },
    { difficulty: 5, icon: "GFX_archaeology_runes_A3", event: lastCustodian },
  ],
  onRollFailed: (_fleet, ctx) => {
    ctx.from.effects((site) => {
      site.addStageClues(1);
    });
  },
});

const placeArchive = events.country(10, {
  hideWindow: true,
  isTriggeredOnly: true,
  trigger: and(isAi(false), not(hasGlobalFlag("silent_archive_placed"))),
  immediate: (country) => {
    country.randomOwnedPlanet({ limit: not(archaeologicalSite(always())) }, (planet) => {
      planet.preventAnomaly();
      planet.createArchaeologicalSite(silentArchive);
      planet.setGlobalFlag("silent_archive_placed");
    });
  },
});

const placeAtGameStart = mod.on(onActions.onGameStartCountry, [placeArchive]);

export const feature = mod.feature("silent_archive", [
  silentArchive,
  sealedDoor,
  memoryVault,
  lastCustodian,
  placeArchive,
  placeAtGameStart,
]);

export default mod.compile([feature]);
