import { createMod } from "@pdx-ts/sdk";
import { vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Aegis Carrier",
  prefix: "aegis_carrier",
  supportedVersion: "v4.4.*",
});

const armor = vanilla.utilityComponentTemplate("MEDIUM_ARMOR_1");
const shield = vanilla.utilityComponentTemplate("MEDIUM_SHIELD_1");
const afterburner = vanilla.utilityComponentTemplate("AFTERBURNER_1");
const reactorBooster = vanilla.utilityComponentTemplate("REACTOR_BOOSTER_1");

const reactorSet = mod.componentSet("reactor", {
  name: "Aegis Reactor",
  desc: "The mandatory power core for Aegis-class ships.",
  requiredComponentSet: true,
  isCoreComponentSet: true,
  icon: vanilla.spriteType("GFX_ship_part_reactor_1"),
  iconFrame: 1,
});

const beamSet = mod.componentSet("beam", {
  name: "Aegis Beam",
  desc: "Focused energy weapons fitted to the Aegis class.",
  icon: vanilla.spriteType("GFX_ship_part_laser_1"),
  iconFrame: 1,
});

const wingSet = mod.componentSet("interceptor_wing", {
  name: "Aegis Interceptor Wing",
  desc: "Fast interceptors launched by the Aegis carrier section.",
  icon: vanilla.spriteType("GFX_ship_part_strike_craft_fighter_1"),
  iconFrame: 1,
});

const reactor = mod.utilityComponentTemplate("reactor", {
  name: "Aegis Zero-Point Reactor",
  icon: vanilla.spriteType("GFX_ship_part_reactor_5"),
  iconFrame: 1,
  componentSet: reactorSet,
  isDefaultComponent: true,
  size: "medium",
  power: 500,
  resources: [{ category: "ship_components", cost: { amounts: { alloys: 20 } } }],
});

const beam = mod.weaponComponentTemplate("beam", {
  name: "Aegis Lance",
  icon: vanilla.spriteType("GFX_ship_part_laser_1"),
  iconFrame: 1,
  componentSet: beamSet,
  size: "medium",
  type: "instant",
  projectileGfx: "infrared_laser_m",
  power: -20,
  damage: { min: 10, max: 24 },
  range: 60,
  accuracy: 0.9,
  tracking: 0.3,
  tags: ["weapon_type_energy", "m_slot"],
  aiTags: ["weapon_role_anti_armor", "carrier"],
  resources: [{ category: "ship_components", cost: { amounts: { alloys: 12 } } }],
});

const interceptors = mod.strikeCraftComponentTemplate("interceptors", {
  name: "Aegis Interceptors",
  icon: vanilla.spriteType("GFX_ship_part_strike_craft_fighter_1"),
  iconFrame: 1,
  componentSet: wingSet,
  entity: "bomber_entity",
  size: "large",
  weaponType: "point_defence",
  shipBehavior: "fighters_behavior",
  projectileGfx: "strike_craft_laser_1",
  power: -34,
  count: 8,
  regenerationPerDay: 0.5,
  launchTime: 2,
  damage: { min: 4, max: 10 },
  range: 10,
  engagementRange: 125,
  accuracy: 1,
  tracking: 0.8,
  cooldown: 2.3,
  health: 7,
  shield: 15,
  evasion: 0.65,
  speed: 600,
  rotationSpeed: 0.8,
  acceleration: 1,
  attackRange: 10,
  shieldPenetration: 1,
  armorDamage: 1.5,
  tags: ["weapon_type_strike_craft"],
  aiTags: ["weapon_role_point_defense", "carrier"],
  pointDefenceTargets: ["strike_craft"],
  resources: [{ category: "ship_components", cost: { amounts: { alloys: 30 } } }],
});

const hull = mod.shipSize("aegis", {
  name: "Aegis Carrier",
  plural: "Aegis Carriers",
  entity: "cruiser_entity",
  class: "shipclass_military",
  isDesignable: false,
  isSpaceObject: false,
  isListed: false,
  formationPriority: 30,
  maxSpeed: 120,
  acceleration: 0.2,
  rotationSpeed: 0.075,
  collisionRadius: 4,
  maxHitpoints: 1_800,
  sizeMultiplier: 8,
  fleetSlotSize: 4,
  sectionSlots: {
    bow: { locator: ["part1"] },
    mid: { locator: ["part2"] },
    stern: { locator: ["part3"] },
  },
  requiredComponentSet: [reactorSet],
});

const bow = mod.sectionTemplate("aegis_bow", {
  name: "Aegis Beam Bow",
  shipSize: [hull],
  fitsOnSlot: ["bow"],
  entity: "cruiser_bow_M2_entity",
  shouldDrawComponents: true,
  componentSlot: [
    { name: "MEDIUM_GUN_01", template: "medium_turret", locatorname: "medium_gun_01" },
    { name: "MEDIUM_GUN_02", template: "medium_turret", locatorname: "medium_gun_02" },
  ],
  mediumUtilitySlots: 4,
});

const mid = mod.sectionTemplate("aegis_mid", {
  name: "Aegis Carrier Core",
  shipSize: [hull],
  fitsOnSlot: ["mid"],
  entity: "cruiser_mid_S2HB_entity",
  shouldDrawComponents: true,
  componentSlot: [
    {
      name: "STRIKE_CRAFT_01",
      template: "large_strike_craft",
      locatorname: "strike_craft_locator_01",
      rotation: 90,
    },
  ],
  mediumUtilitySlots: 4,
});

const stern = mod.sectionTemplate("aegis_stern", {
  name: "Aegis Beam Stern",
  shipSize: [hull],
  fitsOnSlot: ["stern"],
  entity: "cruiser_stern_M1_entity",
  shouldDrawComponents: true,
  componentSlot: [
    { name: "MEDIUM_GUN_01", template: "medium_turret", locatorname: "medium_gun_01" },
  ],
  auxUtilitySlots: 2,
});

const design = mod.globalShipDesign("aegis", {
  name: "Aegis",
  shipSize: hull,
  useDesignName: true,
  isEventDesign: true,
  section: [
    {
      template: bow,
      slot: "bow",
      component: [
        { slot: "MEDIUM_GUN_01", template: beam },
        { slot: "MEDIUM_GUN_02", template: beam },
        { slot: "MEDIUM_UTILITY_1", template: armor },
        { slot: "MEDIUM_UTILITY_2", template: shield },
        { slot: "MEDIUM_UTILITY_3", template: armor },
        { slot: "MEDIUM_UTILITY_4", template: shield },
      ],
    },
    {
      template: mid,
      slot: "mid",
      component: [
        { slot: "STRIKE_CRAFT_01", template: interceptors },
        { slot: "MEDIUM_UTILITY_1", template: armor },
        { slot: "MEDIUM_UTILITY_2", template: shield },
        { slot: "MEDIUM_UTILITY_3", template: armor },
        { slot: "MEDIUM_UTILITY_4", template: shield },
      ],
    },
    {
      template: stern,
      slot: "stern",
      component: [
        { slot: "MEDIUM_GUN_01", template: beam },
        { slot: "AUX_UTILITY_1", template: afterburner },
        { slot: "AUX_UTILITY_2", template: reactorBooster },
      ],
    },
  ],
  requiredComponent: [reactor],
});

export const feature = mod.feature("aegis", [
  reactorSet,
  beamSet,
  wingSet,
  reactor,
  beam,
  interceptors,
  hull,
  bow,
  mid,
  stern,
  design,
]);

export default mod.compile([feature]);
