/**
 * The expansion feature's technologies. Discovery names the emitted file after
 * this module's basename, so these land in the same registry file as
 * `../ceremony/technology.ts`.
 */

import { defineTechnology } from "../../../../src/index.ts";

export const surveyDoctrine = defineTechnology({
  id: "pp_disco_tech_survey_doctrine",
  name: "Survey Doctrine",
  cost: 1000,
  area: "society",
  tier: 1,
  category: "statecraft",
  weight: 90,
});

export const beaconNetwork = defineTechnology({
  id: "pp_disco_tech_beacon_network",
  name: "Beacon Network",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "computing",
  prerequisites: [surveyDoctrine],
  weight: 70,
});
