/**
 * The resonance feature: its technologies *and* its event chain, in one module.
 *
 * This is the whole pitch in one file. Stellaris wants technologies in
 * `common/technology/` and events in `events/`; the feature wants them next to
 * each other. Both are true, because the module is the feature and the build
 * fans it out across registries: this one file emits
 * `common/technology/hello_galaxy_resonance.txt` and
 * `events/hello_galaxy_resonance.txt` — one stem, two registry directories.
 *
 * The technologies gate on flags the events set, which is exactly the coupling
 * that a content-type-shaped source tree would have split across two folders.
 *
 * Event identity is authored, never inferred from layout: `namespace(...)`
 * declares it, so every event id below is `hello_galaxy.<n>` from birth. A
 * namespace belongs to exactly one file, which is why a namespace's events are
 * written in one module — the handle itself is local and must not be exported.
 */

import {
  and,
  defineTechnology,
  eventTarget,
  hasCountryFlag,
  hasOwner,
  isAtWar,
  namespace,
  not,
} from "@pdx-ts/sdk";

import { flags } from "../flags.ts";

export const resonanceTheory = defineTechnology({
  id: "hello_galaxy_tech_resonance_theory",
  name: "Crystal Resonance Theory",
  desc: "The lattice hums at frequencies we are only beginning to hear.",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

export const resonanceWeapons = defineTechnology({
  id: "hello_galaxy_tech_resonance_weapons",
  name: "Resonance Disruptors",
  desc: "Weaponized harmonics that shatter hulls from within.",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [resonanceTheory, "tech_lasers_2"],
  isRare: true,
  weight: 70,
  potential: and(
    hasCountryFlag(flags.hello_galaxy_heard_the_hum),
    not(hasCountryFlag(flags.hello_galaxy_pacifist_path))
  ),
});

const events = namespace("hello_galaxy");

const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

/**
 * A country event whose immediate runs in-game control flow, saves an event
 * target on a planet, and fires a follow-up that reads the firing country back
 * through FROM. Every scope transition is compile-checked; recording happens
 * right here, at define time.
 */
export const aftershock = events.definePlanetEvent({
  id: 2,
  from: "country",
  title: "Aftershock",
  desc: "The crystal hum lingers over this world.",
  isTriggeredOnly: true,
  immediate: (planet, ctx) => {
    planet.within(ctx.from, (country) => {
      country.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: "Noted." }],
});

export const humReturns = events.defineCountryEvent({
  id: 1,
  title: "The Hum Returns",
  desc: "Deep in the lattice, something answers back.",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.randomList([
      {
        weight: 60,
        do: (c) => c.setCountryFlag(flags.hello_galaxy_heard_the_hum),
      },
      {
        weight: 40,
        modifiers: [{ factor: 2, when: isAtWar() }],
        do: (c) => {
          c.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
            planet.saveEventTargetAs(stormWorld);
            planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
          });
        },
      },
    ]);
    country
      .if(hasCountryFlag(flags.hello_galaxy_heard_the_hum), (c) => {
        c.within(stormWorld, (planet) => planet.addDeposit("d_minerals_1"));
      })
      .else((c) => c.log("the hum went unheard"));
  },
  options: [{ name: "Fascinating." }],
});
