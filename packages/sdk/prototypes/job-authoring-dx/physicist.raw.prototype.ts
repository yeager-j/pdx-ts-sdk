/** PROTOTYPE ONLY: the source-complete mod.job version. */
import { createMod } from "@pdx-ts/sdk";
import { always, and, hasBuilding, hasModifier, isRobotPop, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Physicist DX Prototype",
  prefix: "physicist_dx",
  supportedVersion: "v4.4.*",
});

const researchLab = vanilla.building("building_research_lab_1");
const observationCenter = vanilla.building("building_astrometeorology_observation_center");
const astralSiphon = vanilla.building("building_astral_siphon_1");

const astrometeorologist = mod.job("astrometeorologist", {
  name: "Astrometeorologist",
  plural: "Astrometeorologists",
  desc: "Studies the physical laws of stellar weather.",
  effect: "Astrometeorologists produce additional Physics Research.",
  category: "specialist",
  possible: always(false),
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: observationCenter,
    },
  },
});

const astralResearcher = mod.job("astral_researcher", {
  name: "Astral Researcher",
  plural: "Astral Researchers",
  desc: "Maps the physical structure of astral space.",
  effect: "Astral Researchers produce additional Physics Research.",
  category: "specialist",
  possible: always(false),
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: astralSiphon,
    },
  },
});

const spaceTimeResearcher = mod.job("space_time_researcher", {
  name: "Space-Time Researcher",
  plural: "Space-Time Researchers",
  desc: "Measures controlled distortions in local space-time.",
  effect: "Space-Time Researchers produce Physics Research and Dark Matter.",
  category: "specialist",
  possible: always(false),
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
    },
  },
});

const portalResearcher = mod.job("portal_researcher", {
  name: "Dimensional Portal Researcher",
  plural: "Dimensional Portal Researchers",
  desc: "Observes matter crossing a stabilized dimensional aperture.",
  effect: "Portal Researchers produce additional Physics Research.",
  category: "specialist",
  possible: always(false),
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
    },
  },
});

const astralMeteorologist = mod.job("astral_meteorologist", {
  name: "Astral Meteorologist",
  plural: "Astral Meteorologists",
  desc: "Connects astral currents with stellar weather systems.",
  effect: "Astral Meteorologists produce substantial Physics Research.",
  category: "specialist",
  possible: always(false),
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: astralSiphon,
    },
  },
});

const physicist = mod.job("physicist", {
  name: "Physicist",
  plural: "Physicists",
  desc: "Investigates the fundamental behavior of matter and energy.",
  effect: "Physicists produce Physics Research.",
  category: "specialist",
  swappableData: {
    default: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
    },
    swapType: [
      {
        trigger: hasBuilding(observationCenter),
        name: astrometeorologist,
        desc: `job_${astrometeorologist.id}_desc`,
        icon: astrometeorologist,
        buildingIcon: observationCenter,
        weight: 5,
      },
      {
        trigger: hasBuilding(astralSiphon),
        name: astralResearcher,
        desc: `job_${astralResearcher.id}_desc`,
        icon: astralResearcher,
        buildingIcon: astralSiphon,
        weight: 5,
      },
      {
        trigger: hasModifier("prototype_space_time_laboratory"),
        name: spaceTimeResearcher,
        desc: `job_${spaceTimeResearcher.id}_desc`,
        icon: spaceTimeResearcher,
        buildingIcon: researchLab,
        weight: 10,
      },
      {
        trigger: hasModifier("prototype_dimensional_portal"),
        name: portalResearcher,
        desc: `job_${portalResearcher.id}_desc`,
        icon: portalResearcher,
        buildingIcon: researchLab,
        weight: 15,
      },
      {
        trigger: and(hasBuilding(observationCenter), hasBuilding(astralSiphon)),
        name: astralMeteorologist,
        desc: `job_${astralMeteorologist.id}_desc`,
        icon: astrometeorologist,
        buildingIcon: astralSiphon,
        weight: 20,
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
      upkeep: { amounts: { consumer_goods: 1.5 } },
    },
    {
      category: "planet_physicists",
      produces: {
        amounts: { physics_research: 2 },
        when: hasBuilding(observationCenter),
      },
    },
    {
      category: "planet_physicists",
      produces: {
        amounts: { physics_research: 1, sr_dark_matter: 0.2 },
        when: hasModifier("prototype_space_time_laboratory"),
      },
      upkeep: {
        amounts: { consumer_goods: 1.5 },
        when: hasModifier("prototype_space_time_laboratory"),
      },
    },
  ],
  overlordResources: [
    {
      category: "planet_requisitioned_research",
      produces: {
        amounts: { physics_research: 0.75 },
        when: hasModifier("prototype_science_ministry"),
      },
    },
    {
      category: "planet_requisitioned_research",
      produces: {
        amounts: { physics_research: 0.5 },
        when: hasModifier("prototype_astral_ministry"),
      },
    },
  ],
  planetModifier: (modifier) => modifier.planet.stability.add(1),
  triggeredPlanetModifier: [
    {
      when: hasBuilding(observationCenter),
      modifiers: (modifier) => modifier.planet.amenities.add(2),
    },
    {
      when: hasBuilding(astralSiphon),
      modifiers: (modifier) => modifier.planet.amenities.add(4),
    },
  ],
  weight: {
    base: 1,
    modifiers: [
      { factor: 2, when: isRobotPop() },
      { factor: 1.5, when: hasModifier("prototype_research_affinity") },
    ],
  },
});

const researchComplex = mod.building("research_complex", {
  name: "Advanced Research Complex",
  desc: "A collection of laboratories for unusual physical phenomena.",
  planetModifier: (modifier) => {
    modifier.unchecked(`job_${physicist.id}_add`, 4);
  },
});

export const feature = mod.feature("physicist_like", [
  astrometeorologist,
  astralResearcher,
  spaceTimeResearcher,
  portalResearcher,
  astralMeteorologist,
  physicist,
  researchComplex,
]);

export default mod.compile([feature]);
