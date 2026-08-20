import { always, createMod, hasBuilding, isRobotPop, vanilla } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Harmonics",
  prefix: "crystal_harmonics",
  supportedVersion: "v4.4.*",
});

const researchLab = vanilla.building("building_research_lab_1");
const crystalPlant = vanilla.building("building_crystal_plant");

const crystalResonator = mod.job("crystal_resonator", {
  name: "Crystal Resonator",
  plural: "Crystal Resonators",
  desc: "Tunes synthetic crystals into stable computational lattices.",
  effect: "Crystal Resonators produce extra Physics Research and Rare Crystals.",
  category: "specialist",
  possible: always(false),
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: crystalPlant,
    },
  },
});

const harmonicResearcher = mod.job("harmonic_researcher", {
  name: "Harmonic Researcher",
  plural: "Harmonic Researchers",
  desc: "Studies matter through controlled harmonic resonance.",
  effect: "Harmonic Researchers produce Physics Research.",
  category: "specialist",
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
    },
    swapType: [
      {
        trigger: hasBuilding(crystalPlant),
        name: crystalResonator,
        desc: `job_${crystalResonator.id}_desc`,
        icon: crystalResonator,
        buildingIcon: crystalPlant,
        weight: 10,
      },
    ],
  },
  tags: ["research"],
  possiblePreTriggers: {
    hasOwner: true,
    isEnslaved: false,
    isBeingPurged: false,
    isBeingAssimilated: false,
    isSapient: true,
  },
  possiblePrecalc: "can_fill_specialist_job",
  possible: always(),
  resources: [
    {
      category: "planet_physicists",
      produces: { amounts: { physics_research: 3 } },
      upkeep: { amounts: { consumer_goods: 1 } },
    },
    {
      category: "planet_physicists",
      produces: {
        amounts: { physics_research: 2, rare_crystals: 0.1 },
        when: hasBuilding(crystalPlant),
      },
    },
  ],
  overlordResources: [
    {
      category: "planet_requisitioned_research",
      produces: { amounts: { physics_research: 0.5 } },
    },
  ],
  countryModifier: (modifier) => modifier.country.unity.produces.mult(0.01),
  planetModifier: (modifier) => modifier.planet.stability.add(1),
  triggeredPlanetModifier: [
    {
      when: hasBuilding(crystalPlant),
      modifiers: (modifier) => modifier.planet.amenities.add(2),
    },
  ],
  weight: {
    base: 1,
    modifiers: [{ factor: 1.5, when: isRobotPop() }],
  },
});

export const feature = mod.feature("harmonic_jobs", [crystalResonator, harmonicResearcher]);

export default mod.compile([feature]);
