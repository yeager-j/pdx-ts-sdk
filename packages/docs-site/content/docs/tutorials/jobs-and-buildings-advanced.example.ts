import { always, and, createMod, isCapital, owner, vanilla } from "@pdx-ts/sdk";
import {
  canThink,
  complexSpecialistJobCheckTrigger,
  isHiveEmpire,
  isMachineEmpire,
  isRegularEmpire,
} from "@pdx-ts/stellaris-ids/triggers";

const mod = createMod({
  name: "Subspace Archives",
  prefix: "subspace_archives",
  supportedVersion: "v4.4.*",
});

const researchLab = vanilla.building("building_research_lab_1");

const signalCuratorEconomy = mod.economicCategory("signal_curators", {
  parent: vanilla.economicCategory("planet_jobs_specialist"),
  modifierCategory: "colony",
  generateMultModifiers: ["produces", "upkeep"],
});

const signalCurator = mod.job("signal_curator", {
  name: "Signal Curator",
  plural: "Signal Curators",
  desc: "Interprets faint transmissions preserved in the subspace archives.",
  effect: "Signal Curators produce Physics Research and Unity.",
  category: "specialist",
  isCappedByModifier: true,
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
      icon: vanilla.job("physicist"),
    },
  },
  possiblePreTriggers: {
    hasOwner: true,
    isBeingPurged: false,
    isBeingAssimilated: false,
    isSapient: true,
  },
  possiblePrecalc: "can_fill_specialist_job",
  possible: complexSpecialistJobCheckTrigger(),
  resources: [
    {
      category: signalCuratorEconomy,
      produces: { amounts: { physics_research: 4, unity: 1 } },
      upkeep: { amounts: { consumer_goods: 1.5 } },
    },
  ],
  weight: { base: 1 },
});

const resonanceWeaver = mod.job("resonance_weaver", {
  name: "Resonance Weaver Drone",
  plural: "Resonance Weaver Drones",
  desc: "Threads recovered transmissions into the collective's living memory.",
  effect: "Resonance Weaver Drones produce Physics Research and Unity.",
  category: "complex_drone",
  possible: always(false),
  swappableData: {
    default: {
      conditionString: "DRONE_JOB_TRIGGER",
      buildingIcon: researchLab,
      icon: vanilla.job("brain_drone_physicist"),
    },
  },
});

const signalProcessor = mod.job("signal_processor", {
  name: "Signal Processor Unit",
  plural: "Signal Processor Units",
  desc: "Allocates processing cycles to recover structured data from subspace noise.",
  effect: "Signal Processor Units produce Physics Research and Unity.",
  category: "complex_drone",
  isCappedByModifier: true,
  swappableData: {
    default: {
      conditionString: "DRONE_JOB_TRIGGER",
      buildingIcon: researchLab,
      icon: vanilla.job("calculator_physicist"),
    },
    swapType: [
      {
        trigger: owner(isHiveEmpire()),
        name: resonanceWeaver,
        desc: `job_${resonanceWeaver.id}_desc`,
        icon: vanilla.job("brain_drone_physicist"),
        buildingIcon: researchLab,
        conditionString: "DRONE_JOB_TRIGGER",
        weight: 10,
      },
    ],
  },
  possiblePreTriggers: {
    hasOwner: true,
    isEnslaved: false,
    isBeingPurged: false,
    isBeingAssimilated: false,
    isSapient: true,
  },
  possiblePrecalc: "can_fill_drone_job",
  possible: canThink(),
  resources: [
    {
      category: signalCuratorEconomy,
      produces: { amounts: { physics_research: 4, unity: 1 } },
    },
    {
      category: signalCuratorEconomy,
      upkeep: {
        amounts: { minerals: 4 },
        when: owner(isHiveEmpire()),
      },
    },
    {
      category: signalCuratorEconomy,
      upkeep: {
        amounts: { energy: 3 },
        when: owner(isMachineEmpire()),
      },
    },
  ],
  weight: { base: 1 },
});

const subspaceArchive = mod.building("subspace_archive", {
  name: "Subspace Archive",
  desc: "A shielded repository where specialists recover signals from subspace noise.",
  icon: "building_research_lab_1",
  category: "research",
  buildingSets: ["research", "physics"],
  canBuild: true,
  baseBuildtime: 360,
  planetLimit: 1,
  resources: [
    {
      category: "planet_buildings",
      cost: { amounts: { minerals: 500, rare_crystals: 25 } },
      upkeep: { amounts: { energy: 4, rare_crystals: 1 } },
    },
  ],
  planetModifier: (modifier) => {
    modifier.economic(signalCuratorEconomy).resource("physics_research").produces.mult(0.15);
    modifier.economic(signalCuratorEconomy).upkeep.mult(-0.1);
  },
  triggeredPlanetModifier: [
    {
      when: owner(isRegularEmpire()),
      modifiers: (modifier) => modifier.job(signalCurator).add(200),
    },
    {
      when: owner(isHiveEmpire()),
      modifiers: (modifier) => modifier.job(signalProcessor).add(200),
    },
    {
      when: owner(isMachineEmpire()),
      modifiers: (modifier) => modifier.job(signalProcessor).add(200),
    },
    {
      when: and(isCapital(), owner(isRegularEmpire())),
      modifiers: (modifier) => modifier.job(signalCurator).add(100),
    },
    {
      when: and(isCapital(), owner(isHiveEmpire())),
      modifiers: (modifier) => modifier.job(signalProcessor).add(100),
    },
    {
      when: and(isCapital(), owner(isMachineEmpire())),
      modifiers: (modifier) => modifier.job(signalProcessor).add(100),
    },
  ],
});

export const feature = mod.feature("subspace_archives", [
  signalCuratorEconomy,
  signalCurator,
  resonanceWeaver,
  signalProcessor,
  subspaceArchive,
]);

export default mod.compile([feature]);
