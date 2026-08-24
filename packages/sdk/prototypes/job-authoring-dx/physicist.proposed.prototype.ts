/** PROTOTYPE ONLY: the proposed semantic Jobs interface. */
import { createMod } from "@pdx-ts/sdk";
import { always, and, hasBuilding, hasModifier, isRobotPop, vanilla } from "@pdx-ts/sdk/stellaris";

import { jobs } from "./jobs.stub.prototype.ts";

const mod = createMod({
  name: "Physicist DX Prototype",
  prefix: "physicist_dx",
  supportedVersion: "v4.4.*",
});

const researchLab = vanilla.building("building_research_lab_1");
const observationCenter = vanilla.building("building_astrometeorology_observation_center");
const astralSiphon = vanilla.building("building_astral_siphon_1");

const astrometeorologist = mod.job(
  "astrometeorologist",
  jobs.swapTarget({
    name: "Astrometeorologist",
    plural: "Astrometeorologists",
    desc: "Studies the physical laws of stellar weather.",
    effect: "Astrometeorologists produce additional Physics Research.",
    category: "specialist",
    display: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: observationCenter,
    },
  })
);

const astralResearcher = mod.job(
  "astral_researcher",
  jobs.swapTarget({
    name: "Astral Researcher",
    plural: "Astral Researchers",
    desc: "Maps the physical structure of astral space.",
    effect: "Astral Researchers produce additional Physics Research.",
    category: "specialist",
    display: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: astralSiphon,
    },
  })
);

const spaceTimeResearcher = mod.job(
  "space_time_researcher",
  jobs.swapTarget({
    name: "Space-Time Researcher",
    plural: "Space-Time Researchers",
    desc: "Measures controlled distortions in local space-time.",
    effect: "Space-Time Researchers produce Physics Research and Dark Matter.",
    category: "specialist",
    display: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
    },
  })
);

const portalResearcher = mod.job(
  "portal_researcher",
  jobs.swapTarget({
    name: "Dimensional Portal Researcher",
    plural: "Dimensional Portal Researchers",
    desc: "Observes matter crossing a stabilized dimensional aperture.",
    effect: "Portal Researchers produce additional Physics Research.",
    category: "specialist",
    display: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
    },
  })
);

const astralMeteorologist = mod.job(
  "astral_meteorologist",
  jobs.swapTarget({
    name: "Astral Meteorologist",
    plural: "Astral Meteorologists",
    desc: "Connects astral currents with stellar weather systems.",
    effect: "Astral Meteorologists produce substantial Physics Research.",
    category: "specialist",
    display: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: astralSiphon,
    },
  })
);

const physicist = mod.job(
  "physicist",
  jobs.specialist({
    name: "Physicist",
    plural: "Physicists",
    desc: "Investigates the fundamental behavior of matter and energy.",
    effect: "Physicists produce Physics Research.",
    eligibility: { pops: "free", possible: always() },
    display: {
      conditionString: "SPECIALIST_JOB_TRIGGER",
      buildingIcon: researchLab,
    },
    swaps: [
      jobs.swapTo(astrometeorologist, {
        when: hasBuilding(observationCenter),
        buildingIcon: observationCenter,
        weight: 5,
      }),
      jobs.swapTo(astralResearcher, {
        when: hasBuilding(astralSiphon),
        buildingIcon: astralSiphon,
        weight: 5,
      }),
      jobs.swapTo(spaceTimeResearcher, {
        when: hasModifier("prototype_space_time_laboratory"),
        buildingIcon: researchLab,
        weight: 10,
      }),
      jobs.swapTo(portalResearcher, {
        when: hasModifier("prototype_dimensional_portal"),
        buildingIcon: researchLab,
        weight: 15,
      }),
      jobs.swapTo(astralMeteorologist, {
        when: and(hasBuilding(observationCenter), hasBuilding(astralSiphon)),
        icon: astrometeorologist,
        buildingIcon: astralSiphon,
        weight: 20,
      }),
    ],
    tags: ["research"],
    economy: {
      local: {
        category: "planet_physicists",
        entries: [
          {
            produces: { physics_research: 3 },
            upkeep: { consumer_goods: 1.5 },
          },
          {
            when: hasBuilding(observationCenter),
            produces: { physics_research: 2 },
          },
          {
            when: hasModifier("prototype_space_time_laboratory"),
            produces: { physics_research: 1, sr_dark_matter: 0.2 },
            upkeep: { consumer_goods: 1.5 },
          },
        ],
      },
      overlord: {
        category: "planet_requisitioned_research",
        entries: [
          {
            when: hasModifier("prototype_science_ministry"),
            produces: { physics_research: 0.75 },
          },
          {
            when: hasModifier("prototype_astral_ministry"),
            produces: { physics_research: 0.5 },
          },
        ],
      },
    },
    modifiers: {
      planet: (modifier) => modifier.planet.stability.add(1),
      triggeredPlanet: [
        {
          when: hasBuilding(observationCenter),
          modifiers: (modifier) => modifier.planet.amenities.add(2),
        },
        {
          when: hasBuilding(astralSiphon),
          modifiers: (modifier) => modifier.planet.amenities.add(4),
        },
      ],
    },
    weight: {
      base: 1,
      modifiers: [
        { factor: 2, when: isRobotPop() },
        { factor: 1.5, when: hasModifier("prototype_research_affinity") },
      ],
    },
  })
);

const researchComplex = mod.building("research_complex", {
  name: "Advanced Research Complex",
  desc: "A collection of laboratories for unusual physical phenomena.",
  planetModifier: jobs.modifiers((modifier) => {
    modifier.job(physicist).positions.add(4);
  }),
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
