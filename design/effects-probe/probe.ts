/**
 * The probe: the handoff doc's nastiest realistic case, written exactly as a
 * mod author would write it. This file is the artifact the spike judges — it
 * must read close to the PDXScript it emits, with zero casts, zero `any`, and
 * scope names appearing only as sanctioned type-level declarations
 * (`eventTarget<"planet">`, `from: "country"`).
 *
 * The scenario: a country event whose `immediate` runs a `random_list`; one
 * arm iterates owned planets, saves an event target, and fires a follow-up
 * planet event; the follow-up reads the firing country back through FROM and
 * pays it influence.
 */

import { countryFlags } from "../../src/generated/value-sets.ts";
import { hasCountryFlag, hasOwner, isAtWar } from "../../src/triggers.ts";
import { eventTarget } from "./effect-core.ts";
import { defineCountryEvent, definePlanetEvent } from "./events-sample.ts";

const NS = "hello_probe";

const flags = countryFlags("hg_heard_the_hum");
const stormWorld = eventTarget<"planet">("hg_storm_world");

export const aftershock = definePlanetEvent(NS, {
  id: 2,
  from: "country",
  title: "hello_probe.2.name",
  desc: "hello_probe.2.desc",
  isTriggeredOnly: true,
  immediate: (planet, ctx) => {
    planet.within(ctx.from, (country) => {
      country.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: "hello_probe.2.a" }],
});

export const humReturns = defineCountryEvent(NS, {
  id: 1,
  title: "hello_probe.1.name",
  desc: "hello_probe.1.desc",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.randomList([
      {
        weight: 60,
        do: (c) => c.setCountryFlag(flags.hg_heard_the_hum),
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
      .if(hasCountryFlag(flags.hg_heard_the_hum), (c) => {
        c.within(stormWorld, (planet) => planet.addDeposit("d_minerals_1"));
      })
      .else((c) => c.log("the hum went unheard"));
  },
  options: [{ name: "hello_probe.1.a" }],
});
