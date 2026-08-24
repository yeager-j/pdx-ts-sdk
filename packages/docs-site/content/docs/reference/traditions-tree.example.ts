import { createMod } from "@pdx-ts/sdk";
import { hasTradition } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Deep Space Traditions",
  prefix: "deep_space",
  supportedVersion: "v4.4.*",
});

const adopt = mod.tradition("adopt", {
  name: "Deep Space",
  flavor: "The dark between stars is not empty. It is a frontier.",
  effects: "Adopting Deep Space improves our research output.",
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
});

const surveyTeams = mod.tradition("survey_teams", {
  name: "Long-Range Survey Teams",
  flavor: "Every distant signal deserves a careful listener.",
  effects: "Improves Physics Research.",
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
  aiWeight: { base: 100 },
});

const orbitalCartography = mod.tradition("orbital_cartography", {
  name: "Orbital Cartography",
  flavor: "No orbit is truly empty once it has been measured.",
  effects: "Improves Engineering Research.",
  modifier: (modifier) => modifier.country.engineering.research.produces.mult(0.05),
  aiWeight: { base: 100 },
});

const distributedArchives = mod.tradition("distributed_archives", {
  name: "Distributed Archives",
  effects: "Improves Unity production.",
  possible: hasTradition(surveyTeams),
  modifier: (modifier) => modifier.country.unity.produces.mult(0.05),
  aiWeight: { base: 100 },
});

const relayDoctrine = mod.tradition("relay_doctrine", {
  name: "Relay Doctrine",
  effects: "Increases naval capacity.",
  possible: hasTradition(surveyTeams),
  modifier: (modifier) => modifier.country.naval.cap.add(10),
  aiWeight: { base: 100 },
});

const predictiveLogistics = mod.tradition("predictive_logistics", {
  name: "Predictive Logistics",
  effects: "Improves all research output.",
  possible: hasTradition(orbitalCartography),
  modifier: (modifier) => {
    modifier.country.physics.research.produces.mult(0.025);
    modifier.country.engineering.research.produces.mult(0.025);
  },
  aiWeight: { base: 100 },
});

const finish = mod.tradition("finish", {
  name: "Deep Space Complete",
  effects: "Completing Deep Space improves Unity production.",
  modifier: (modifier) => modifier.country.unity.produces.mult(0.1),
});

const deepSpace = mod.traditionCategory("deep_space", {
  name: "Deep Space",
  desc: "Master the long distances between settled systems.",
  treeTemplate: "tree_12_11",
  adoptionBonus: adopt,
  finishBonus: finish,
  traditions: [
    surveyTeams,
    orbitalCartography,
    distributedArchives,
    relayDoctrine,
    predictiveLogistics,
  ],
  aiWeight: { base: 20 },
});

export const feature = mod.feature("deep_space_traditions", [
  adopt,
  surveyTeams,
  orbitalCartography,
  distributedArchives,
  relayDoctrine,
  predictiveLogistics,
  finish,
  deepSpace,
]);

export default mod.compile([feature]);
