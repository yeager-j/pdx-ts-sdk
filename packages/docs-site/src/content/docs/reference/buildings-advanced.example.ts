import { createMod, hasCivic, hasModifier, isCapital, not, vanilla } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Atmospheric Studies",
  prefix: "atmospheric_studies",
  supportedVersion: "v4.4.*",
});

const stormAnalyst = mod.job("storm_analyst", {
  name: "Storm Analyst",
  plural: "Storm Analysts",
  desc: "Models how extreme weather moves through planetary atmospheres.",
  effect: "Storm Analysts produce Physics Research.",
  category: "specialist",
  possiblePreTriggers: {
    hasOwner: true,
    isBeingPurged: false,
    isBeingAssimilated: false,
    isSapient: true,
  },
  possiblePrecalc: "can_fill_specialist_job",
  resources: [
    {
      category: "planet_physicists",
      produces: { amounts: { physics_research: 5 } },
      upkeep: { amounts: { consumer_goods: 1 } },
    },
  ],
  weight: { base: 1 },
});

const atmosphericModeling = mod.technology("atmospheric_modeling", {
  name: "Atmospheric Modeling",
  desc: "Predictive models expose the structure inside planetary storms.",
  area: "physics",
  tier: 2,
  category: "computing",
  cost: 3_000,
  prerequisites: [vanilla.technology("tech_space_science_1")],
  weight: 70,
  aiWeight: { base: 1 },
});

const queuedStatus = mod.staticModifier("storm_center_queued", {
  name: "Storm Analysis Center Queued",
  desc: "A Storm Analysis Center is waiting in this colony's construction queue.",
});

const onlineStatus = mod.staticModifier("storm_center_online", {
  name: "Storm Analysis Center Online",
  desc: "This colony's Storm Analysis Center is operational.",
});

const stormAnalysisCenter = mod.building("storm_analysis_center", {
  name: "Storm Analysis Center",
  desc: "A hardened laboratory that studies violent planetary weather.",
  baseBuildtime: 360,
  category: "research",
  icon: "building_research_lab_1",
  buildingSets: ["research", "physics"],
  canBuild: true,
  planetLimit: 1,
  isCappedByModifier: true,
  baseCapAmount: 1,
  positionPriority: 20,
  potential: not(hasModifier("resort_colony")),
  allow: isCapital(),
  resources: [
    {
      category: "planet_buildings",
      cost: { amounts: { minerals: 500, rare_crystals: 25 } },
      upkeep: {
        amounts: { energy: 4, rare_crystals: 1 },
        when: isCapital(),
      },
    },
  ],
  prerequisites: [atmosphericModeling],
  showInTech: [atmosphericModeling],
  showTechUnlockIf: hasCivic("civic_technocracy"),
  planetModifier: (modifier) => {
    modifier.unchecked(`job_${stormAnalyst.id}_add`, 2);
    modifier.planet.jobs.physics.research.produces.mult(0.1);
  },
  onQueued: (colony) => {
    colony.addModifier({ modifier: queuedStatus, days: -1 });
  },
  onUnqueued: (colony) => {
    colony.removeModifier(queuedStatus);
  },
  onBuilt: (colony) => {
    colony.removeModifier(queuedStatus);
    colony.addModifier({ modifier: onlineStatus, days: -1 });
  },
  onEnabled: (colony) => {
    colony.addModifier({ modifier: onlineStatus, days: -1 });
  },
  onDestroy: (colony) => {
    colony.removeModifier(onlineStatus);
  },
  onRepaired: (colony) => {
    colony.addModifier({ modifier: onlineStatus, days: -1 });
  },
});

export const feature = mod.feature("storm_analysis", [
  stormAnalyst,
  atmosphericModeling,
  queuedStatus,
  onlineStatus,
  stormAnalysisCenter,
]);

export default mod.compile([feature]);
