import { always, createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Orbital Analysis",
  prefix: "orbital_analysis",
  supportedVersion: "v4.4.*",
});

const orbitalAnalyst = mod.job("orbital_analyst", {
  name: "Orbital Analyst",
  plural: "Orbital Analysts",
  desc: "Studies traffic and sensor data from the colony's orbital space.",
  effect: "Orbital Analysts produce Physics Research.",
  category: "specialist",
  possiblePreTriggers: {
    hasOwner: true,
    isBeingPurged: false,
    isBeingAssimilated: false,
    isSapient: true,
  },
  possiblePrecalc: "can_fill_specialist_job",
  possible: always(),
  resources: [
    {
      category: "planet_physicists",
      produces: { amounts: { physics_research: 4 } },
      upkeep: { amounts: { consumer_goods: 1 } },
    },
  ],
  weight: { base: 1 },
});

const orbitalAnalysisCenter = mod.building("orbital_analysis_center", {
  name: "Orbital Analysis Center",
  desc: "A sensor complex that employs specialists to study orbital traffic.",
  planetModifier: (modifier) => {
    modifier.unchecked(`job_${orbitalAnalyst.id}_add`, 2);
  },
});

export const feature = mod.feature("orbital_analysis", [orbitalAnalyst, orbitalAnalysisCenter]);

export default mod.compile([feature]);
