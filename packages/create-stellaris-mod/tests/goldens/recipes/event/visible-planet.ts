/**
 * One planet event, and the feature that places it.
 *
 * Generated once by the `event` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * The definer is what makes this a `planet_event`. There is no `type`
 * field to set: `events.planet(...)` decides both the kind the game reads and the
 * scope every callback below is handed, so the event happens to a planet and the
 * effects legal inside it are planet-scope effects. Firing it from elsewhere goes
 * through `planetEvent`.
 *
 * It shows a window. `title`, `desc` and the option's `name` are English text
 * here and localization keys in the emitted mod. `picture` and `showSound`
 * select checked vanilla media. The option's `effects` run when the player
 * picks it.
 *
 * `#mod` is the project's own alias for `src/mod.ts` (see `package.json#imports`),
 * so this import never changes when the file moves. The filename decides
 * nothing either: the `mod.feature(...)` call at the bottom is what names the
 * emitted files, and what puts it in the mod is its line in `src/features.ts`.
 */

import { vanilla } from "@pdx-ts/sdk/stellaris";

import { mod } from "#mod";

// A namespace belongs to exactly one Feature; the event below is
// `<prefix>_resonance_theory.1` from birth. Keep the handle inside this Feature's
// own files, and never export it.
const events = mod.namespace("resonance_theory");

// Nothing fires this on its own: `isTriggeredOnly` tells the game never to
// schedule it. Give it a hook — `mod.on(onActions.<action>, [resonanceTheory])` —
// or fire it from another event's effects, where the fire operation is a
// method on the scope you are in: `<scope>.planetEvent({ id: resonanceTheory })`.
// The `research-quest` recipe generates one wired end to end.
export const resonanceTheory = events.planet(1, {
  title: "PLACEHOLDER: the headline the event window shows.",
  desc: "PLACEHOLDER: what happened, in a paragraph.",
  isTriggeredOnly: true,
  options: [
    {
      name: { english: "PLACEHOLDER: acknowledge it.", key: "acknowledge" },
      effects: (planet) => {
        // `planet` is this event's root scope, and the kind is what fixed it.
        // `setPlanetFlag` is in scope here; the other three scopes' flag
        // effects are not. Flags are how the rest of your script learns this ran.
        //
        // Flag names are shared with every other mod the player has loaded, so this
        // one carries the mod prefix the way the scaffolded example does. Reading it
        // back — `hasCountryFlag` and its siblings — takes the same string.
        planet.setPlanetFlag(`${mod.config.prefix}_resonance_theory_fired`);
      },
    },
  ],

  picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal,
  showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal,
  // Fires at most once per game, no matter how often its hook runs.
  // fireOnlyOnce: true,
});

export const feature = mod.feature("resonance_theory", [resonanceTheory]);
