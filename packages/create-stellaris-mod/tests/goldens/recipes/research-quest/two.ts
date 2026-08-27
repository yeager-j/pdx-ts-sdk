/**
 * A research quest: one event chain, the special projects that advance it, and
 * the country events that begin and end it — several coordinated items, one
 * feature file.
 *
 * Generated once by the `research-quest` recipe, and yours from here. Nothing
 * reads this file back: there is no marker in it, no version, and no upgrade —
 * so rename it, add to it, or delete it as the mod grows.
 *
 * Declaration order is load-bearing in two different ways, and this file shows
 * both. An event's closures run when the event is defined, so `started` must
 * come after the projects its option enables. A content callback such as a
 * project's `onSuccess` runs later, at build time, so it may name a completion
 * event that is declared below it.
 *
 * `#mod` is the project's own alias for `src/mod.ts` (see `package.json#imports`),
 * so moving this file deeper inside the content directory never rewrites the
 * import. The filename decides nothing either: the `mod.feature(...)` call at the
 * bottom is what names the emitted files.
 */

import { onActions, vanilla } from "@pdx-ts/sdk/stellaris";

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
// may name `firstCompleted`, declared further down, because content callbacks
// run at build time rather than here.
export const firstProject = mod.specialProject("resonance_theory_1", {
  name: "PLACEHOLDER: what the situation log calls this approach.",
  desc: "PLACEHOLDER: what researching it involves, in a sentence or two.",
  eventChain: chain,
  eventScope: "country_event",
  cost: 1000,
  onSuccess: (country) => {
    country.countryEvent({ id: firstCompleted });
  },

  // Days before an untouched project expires. 3600 is ten game years.
  // timelimit: 3600,
});

// The rival approach. Sharing an option group makes starting one project the
// choice against the other: completing either removes both from the log.
export const secondProject = mod.specialProject("resonance_theory_2", {
  name: "PLACEHOLDER: what the situation log calls the rival approach.",
  desc: "PLACEHOLDER: what researching it involves, in a sentence or two.",
  eventChain: chain,
  eventScope: "country_event",
  cost: 1000,
  sameOptionGroupAs: [firstProject],
  onSuccess: (country) => {
    country.countryEvent({ id: secondCompleted });
  },
});

// Opens the quest: begins the chain, and its option puts both projects in the
// situation log. `enableSpecialProject` records when this event is defined,
// which is why the projects are declared above it.
export const started = events.country(1, {
  title: "PLACEHOLDER: the sighting that starts the quest.",
  desc: "PLACEHOLDER: what happened, in a paragraph.",
  picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal,
  showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal,
  eventChain: chain,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.beginEventChain({ eventChain: chain });
  },
  options: [
    {
      name: {
        english: "PLACEHOLDER: the option that takes the quest on.",
        key: "accept_quest",
      },
      effects: (country) => {
        country.enableSpecialProject({ name: firstProject });
        country.enableSpecialProject({ name: secondProject });
      },
    },
  ],
});

// The first approach pays off; ending the chain closes the situation log entry.
export const firstCompleted = events.country(2, {
  title: "PLACEHOLDER: the discovery.",
  desc: "PLACEHOLDER: what was found, in a paragraph.",
  picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal,
  showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal,
  eventChain: chain,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.endEventChain(chain);
  },
  options: [{ name: { english: "PLACEHOLDER: acknowledge it.", key: "acknowledge" } }],
});

// The rival approach pays off instead.
export const secondCompleted = events.country(3, {
  title: "PLACEHOLDER: the rival discovery.",
  desc: "PLACEHOLDER: what was found, in a paragraph.",
  picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal,
  showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal,
  eventChain: chain,
  isTriggeredOnly: true,
  immediate: (country) => {
    country.endEventChain(chain);
  },
  options: [{ name: { english: "PLACEHOLDER: acknowledge it.", key: "acknowledge" } }],
});

// Without a hook nothing fires `started`; this fires it for every country when
// a new game begins.
export const onNewGame = mod.on(onActions.onGameStartCountry, [started]);

export const feature = mod.feature("resonance_theory", [
  chain,
  firstProject,
  secondProject,
  started,
  firstCompleted,
  secondCompleted,
  onNewGame,
]);
