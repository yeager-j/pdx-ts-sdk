/**
 * One feature module, three registries. The expansion feature's technologies,
 * its event chain, and its hook binding live together because they are one
 * idea; the build fans the single stem `expansion` out to
 * `common/technology/pp_disco_expansion.txt`, `events/pp_disco_expansion.txt`,
 * and the on-action file. Nothing here is shaped like the output tree.
 *
 * The namespace handle is local: a namespace belongs to exactly one file, so
 * exporting the handle is an error and only the events it defined are exported.
 *
 * The list inside one `on(...)` call is the firing order the game sees; it is
 * author data, so it is written here and never inferred from export order.
 */

import { defineTechnology, namespace, on, onActions } from "../../../src/index.ts";

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

const events = namespace("pp_disco");

export const firstLight = events.defineCountryEvent({
  id: 1,
  title: "First Light",
  desc: "The beacons come online.",
  isTriggeredOnly: true,
  immediate: (country) => country.log("PP_DISCO_FIRST_LIGHT"),
  options: [{ name: "Onward." }],
});

export const secondLight = events.defineCountryEvent({
  id: 2,
  title: "Second Light",
  desc: "And again, further out.",
  isTriggeredOnly: true,
  immediate: (country) => country.log("PP_DISCO_SECOND_LIGHT"),
  options: [{ name: "Onward." }],
});

export const gameStart = on(onActions.onGameStartCountry, [firstLight, secondLight]);
