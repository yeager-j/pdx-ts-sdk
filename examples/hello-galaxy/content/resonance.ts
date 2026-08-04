/**
 * The resonance feature: its technologies *and* its event chain, in one module.
 *
 * This is the whole pitch in one file. Stellaris wants technologies in
 * `common/technology/` and events in `events/`; the feature wants them next to
 * each other. Both are true, because this module exports a feature with the
 * authored stem `resonance`, which the build fans out across registries:
 * `common/technology/hello_galaxy_resonance.txt` and
 * `events/hello_galaxy_resonance.txt` — one stem, two registry directories.
 *
 * The technologies gate on flags the events set, which is exactly the coupling
 * that a content-type-shaped source tree would have split across two folders.
 *
 * It also reaches into vanilla's own script. `isRegularEmpire`,
 * `hasActualDeficit` and `giveTechOptionOrProgressEffect` are not rules the SDK
 * generates from — they are scripted triggers and effects the game ships, bound
 * by `@pdx-ts/stellaris-ids` with their names, `$PARAM$` lists, and scopes all
 * checked. Nothing here asserts a scope; each was derived from what the rules
 * already say about the keys those bodies evaluate.
 *
 * Event identity is authored, never inferred from layout: `mod.namespace("resonance")`
 * declares it, so every event id below is `hello_galaxy_resonance.<n>` from birth. A
 * namespace belongs to exactly one file, which is why a namespace's events are
 * written in one module — the handle itself is local and must not be exported.
 */

import { and, eventTarget, hasCountryFlag, hasOwner, isAtWar, not, vanilla } from "@pdx-ts/sdk";
import { giveTechOptionOrProgressEffect } from "@pdx-ts/stellaris-ids/effects";
import { hasActualDeficit, isRegularEmpire } from "@pdx-ts/stellaris-ids/triggers";

import { flags } from "../flags.ts";
import { mod } from "../mod.ts";

export const resonanceTheory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  desc: "The lattice hums at frequencies we are only beginning to hear.",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

export const resonanceWeapons = mod.technology("resonance_weapons", {
  name: "Resonance Disruptors",
  desc: "Weaponized harmonics that shatter hulls from within.",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [resonanceTheory, "tech_lasers_2"],
  isRare: true,
  weight: 70,
  // `isRegularEmpire` is vanilla *script*, not a rule the SDK generates from —
  // it lives in `common/scripted_triggers/` and is bound by the identifier
  // package. Its scope was inferred rather than asserted: the body is an `OR`
  // of `is_country_type` and a `NOT has_ethic`, both country-scoped, so this is
  // a `Trigger<"country">` and using it on a planet would not compile.
  potential: and(
    hasCountryFlag(flags.hello_galaxy_heard_the_hum),
    not(hasCountryFlag(flags.hello_galaxy_pacifist_path)),
    isRegularEmpire()
  ),
});

const events = mod.namespace("resonance");

const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

/**
 * A country event whose immediate runs in-game control flow, saves an event
 * target on a planet, and fires a follow-up that reads the firing country back
 * through FROM. Every scope transition is compile-checked; recording happens
 * right here, at define time.
 */
export const aftershock = events.planet(2, {
  from: "country",
  title: "Aftershock",
  desc: "The crystal hum lingers over this world.",
  isTriggeredOnly: true,
  immediate: (planet, ctx) => {
    ctx.from.effects((country) => {
      country.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: "Noted." }],
});

export const humReturns = events.country(1, {
  title: "The Hum Returns",
  desc: "Deep in the lattice, something answers back.",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.randomList([
      {
        weight: 60,
        do: (c) => {
          c.setCountryFlag(flags.hello_galaxy_heard_the_hum);
          // A vanilla scripted *effect*, invoked through `run` — effects record
          // into a sink the scope object closes over, so a binding hands back a
          // call rather than recording itself. Its `TECH` parameter takes this
          // mod's own technology: the package types parameters as bare scalars,
          // and the SDK widens that to the references it already models.
          c.run(giveTechOptionOrProgressEffect({ TECH: resonanceTheory }));
        },
      },
      {
        weight: 40,
        modifiers: [
          { factor: 2, when: isAtWar() },
          // A parameterized scripted trigger. The `$PARAM$` list is typed, so
          // a misspelled `RESOURCE` is a compile error rather than a condition
          // that is silently never true.
          { factor: 3, when: hasActualDeficit({ RESOURCE: vanilla.resource("minerals") }) },
        ],
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
        stormWorld.effects((planet) => planet.addDeposit("d_minerals_1"));
      })
      .else((c) => c.log("the hum went unheard"));
  },
  options: [{ name: "Fascinating." }],
});

export const feature = mod.feature("resonance", [
  resonanceTheory,
  resonanceWeapons,
  aftershock,
  humReturns,
]);
