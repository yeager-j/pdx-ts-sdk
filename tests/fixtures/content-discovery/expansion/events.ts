/**
 * The expansion feature's events. The namespace handle is local: a namespace
 * belongs to exactly one file, so exporting the handle is an error and only
 * the events it defined are exported.
 */

import { namespace } from "../../../../src/index.ts";

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
