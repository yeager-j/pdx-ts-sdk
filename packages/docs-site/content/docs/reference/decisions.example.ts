import { createMod, hasModifier, not } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Surveys",
  prefix: "frontier_surveys",
  supportedVersion: "v4.4.*",
});

const surveyUnderway = mod.staticModifier("survey_underway", {
  name: "Frontier Survey Underway",
  modifiers: (modifier) => modifier.planet.jobs.engineering.research.produces.mult(0.1),
});

const surveyTheFrontier = mod.decision("survey_the_frontier", {
  name: "Survey the Frontier",
  desc: "Fund a detailed survey of this colony's outer reaches.",
  ownedPlanetsOnly: true,
  important: true,
  icon: "decision_resources",
  resources: [
    {
      category: "decisions",
      cost: { amounts: { energy: 500 } },
    },
  ],
  allow: not(hasModifier(surveyUnderway)),
  effect: (planet) => planet.addModifier({ modifier: surveyUnderway, days: 3_600 }),
  aiWeight: { base: 5 },
});

export const feature = mod.feature("frontier_decision", [surveyUnderway, surveyTheFrontier]);

export default mod.compile([feature]);
