/**
 * A research quest: one event chain, the special project that advances it, and
 * the country events that begin and end it — several coordinated items, one
 * feature file.
 *
 * Generated once by the `research-quest` recipe, and yours from here. Nothing
 * reads this file back: there is no marker in it, no version, and no upgrade —
 * so rename it, add to it, or delete it as the mod grows.
 *
 * Declaration order is load-bearing in two different ways, and this file shows
 * both. An event's closures run when the event is defined, so `started` must
 * come after the project its option enables. A content callback such as a
 * project's `onSuccess` runs later, at build time, so it may name a completion
 * event that is declared below it.
 *
 * `#mod` is the project's own alias for `src/mod.ts` (see `package.json#imports`),
 * so moving this file deeper inside the content directory never rewrites the
 * import. The filename decides nothing either: the `mod.feature(...)` call at the
 * bottom is what names the emitted files.
 */

import { onActions } from "@pdx-ts/sdk";

import { mod } from "#mod";

// The situation-log entry the whole quest hangs off.
export const chain = mod.eventChain("resonance_theory", {
  title: "Resonance Theory",
  desc: "PLACEHOLDER: what the situation log says this quest is about.",
});

// One event namespace per feature file; every event below is
// `<prefix>_resonance_theory.<n>` from birth. The handle stays local — a
// namespace belongs to exactly one file and must not be exported.
const events = mod.namespace("resonance_theory");

// `onSuccess` runs in the owner's country scope when the research finishes. It
// may name `completed`, declared further down, because content callbacks run
// at build time rather than here.
export const project = mod.specialProject("resonance_theory", {
  name: "PLACEHOLDER: what the situation log calls this project.",
  desc: "PLACEHOLDER: what researching it involves, in a sentence or two.",
  eventChain: chain,
  eventScope: "country_event",
  cost: 1000,
  onSuccess: (country) => {
    country.countryEvent({ id: completed });
  },

  // Days before an untouched project expires. 3600 is ten game years.
  // timelimit: 3600,
});

// Opens the quest: begins the chain, and its option puts the project in the
// situation log. `enableSpecialProject` records when this event is defined,
// which is why the project is declared above it.
export const started = events.country(1, {
  title: "PLACEHOLDER: the sighting that starts the quest.",
  desc: "PLACEHOLDER: what happened, in a paragraph.",
  eventChain: chain,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.beginEventChain({ eventChain: chain });
  },
  options: [
    {
      name: "PLACEHOLDER: the option that takes the quest on.",
      key: "accept_quest",
      effects: (country) => {
        country.enableSpecialProject({ name: project });
      },
    },
  ],
});

// The payoff; ending the chain closes the situation log entry.
export const completed = events.country(2, {
  title: "PLACEHOLDER: the discovery.",
  desc: "PLACEHOLDER: what was found, in a paragraph.",
  eventChain: chain,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.endEventChain(chain);
  },
  options: [{ name: "PLACEHOLDER: acknowledge it.", key: "acknowledge" }],
});

// Without a hook nothing fires `started`; this fires it for every country when
// a new game begins.
export const onNewGame = mod.on(onActions.onGameStartCountry, [started]);

export const feature = mod.feature("resonance_theory", [
  chain,
  project,
  started,
  completed,
  onNewGame,
]);
