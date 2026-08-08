/**
 * One country event, and the feature that places it.
 *
 * Generated once by the `event` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * The definer is what makes this a `country_event`. There is no `type`
 * field to set: `events.country(...)` decides both the kind the game reads and the
 * scope every callback below is handed, so the event happens to a country and the
 * effects legal inside it are country-scope effects. Firing it from elsewhere goes
 * through `countryEvent`.
 *
 * It shows no window. `hideWindow` makes the event run its `immediate` effects
 * and finish without the player being shown anything, which is the ordinary
 * shape for the bookkeeping an on-action or another event sets off.
 *
 * `#mod` is the project's own alias for `src/mod.ts` (see `package.json#imports`),
 * so moving this file deeper inside the content directory never rewrites the
 * import. The filename decides nothing either: the `mod.feature(...)` call at the
 * bottom is what names the emitted files.
 */

import { mod } from "#mod";

// One event namespace per feature file; the event below is
// `<prefix>_resonance_theory.1` from birth. The handle stays local — a namespace
// belongs to exactly one file and must not be exported.
const events = mod.namespace("resonance_theory");

// Nothing fires this on its own: `isTriggeredOnly` tells the game never to
// schedule it. Give it a hook — `mod.on(onActions.<action>, [resonanceTheory])` —
// or fire it from another event's effects, where the fire operation is a
// method on the scope you are in: `<scope>.countryEvent({ id: resonanceTheory })`.
// The `research-quest` recipe generates one wired end to end.
export const resonanceTheory = events.country(1, {
  // No window at all: `immediate` runs the moment the event fires and the
  // player is shown nothing, so the fields a window would need have nothing
  // to say here.
  hideWindow: true,
  isTriggeredOnly: true,
  immediate: (country) => {
    // `country` is this event's root scope, and the kind is what fixed it.
    // `setCountryFlag` is in scope here; the other three scopes' flag
    // effects are not. Flags are how the rest of your script learns this ran.
    //
    // Flag names are shared with every other mod the player has loaded, so this
    // one carries the mod prefix the way the scaffolded example does. Reading it
    // back — `hasCountryFlag` and its siblings — takes the same string.
    country.setCountryFlag(`${mod.config.prefix}_resonance_theory_fired`);
  },

  // Fires at most once per game, no matter how often its hook runs.
  // fireOnlyOnce: true,
});

export const feature = mod.feature("resonance_theory", [resonanceTheory]);
