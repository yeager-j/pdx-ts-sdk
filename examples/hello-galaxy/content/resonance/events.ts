/**
 * The resonance feature's event chain.
 *
 * A country event whose immediate runs in-game control flow, saves an event
 * target on a planet, and fires a follow-up that reads the firing country back
 * through FROM. Every scope transition is compile-checked; recording happens
 * right here, at define time.
 *
 * Event identity is authored, never inferred from layout: `namespace(...)`
 * declares it, so every id below is `hello_galaxy.<n>` from birth. A namespace
 * belongs to exactly one file, which is why a namespace's events are written in
 * one module — the handle itself is local and must not be exported.
 */

import {
  eventTarget,
  hasCountryFlag,
  hasOwner,
  isAtWar,
  namespace,
} from "../../../../src/index.ts";
import { flags } from "../../flags.ts";

const events = namespace("hello_galaxy");

const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

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
