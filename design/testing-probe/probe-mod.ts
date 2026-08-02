/**
 * Mainline artifact 1 of the testing probe: the mod under test, written with
 * the REAL SDK exactly as a modder would — zero casts, no probe-local
 * recording machinery. (Migrated from the `Mod` builder to the free definers
 * when the pure API landed; same content, same intent.) It replicates the example mod's event chain
 * (examples/hello-galaxy/mod.ts) and extends the follow-up with a tech grant,
 * because the probe's end-to-end case asserts `player.has(tech)` after the
 * chain runs.
 *
 * Judgment criteria (from docs/handoff-mod-testing.md): this file must stay
 * clean under the testing API — if defining the mod for a test needs anything
 * the SDK does not already give, that is a probe finding.
 */

import {
  and,
  collection,
  countryFlags,
  defineTechnology,
  eventTarget,
  globalFlags,
  hasCountryFlag,
  hasGlobalFlag,
  hasOwner,
  isAtWar,
  namespace,
  not,
} from "../../packages/sdk/src/index.ts";

export const flags = countryFlags("tp_heard_the_hum", "tp_pacifist_path");
export const globals = globalFlags("tp_lattice_awake");

export const config = {
  name: "Testing Probe",
  prefix: "testing_probe",
  version: "0.1.0",
  supportedVersion: "4.0.*",
} as const;

const eventNamespace = namespace("testing_probe");

export const resonanceTheory = defineTechnology({
  id: "testing_probe_tech_resonance_theory",
  name: "Crystal Resonance Theory",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

/**
 * The evaluate/explain target. Exported on its own so the test can pass it
 * around as a value; it is also the tech's `potential`. In the probe fixture
 * the country holds BOTH flags, so exactly one subcondition — the NOT —
 * fails, and `explain` must name it.
 */
export const resonancePotential = and(
  hasGlobalFlag(globals.tp_lattice_awake),
  hasCountryFlag(flags.tp_heard_the_hum),
  not(hasCountryFlag(flags.tp_pacifist_path))
);

export const resonanceWeapons = defineTechnology({
  id: "testing_probe_tech_resonance_weapons",
  name: "Resonance Disruptors",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [resonanceTheory],
  isRare: true,
  weight: 70,
  potential: resonancePotential,
});

export const stormWorld = eventTarget<"planet">("tp_storm_world");

export const aftershock = eventNamespace.definePlanetEvent({
  id: 2,
  from: "country",
  title: "Aftershock",
  desc: "The crystal hum lingers over this world.",
  isTriggeredOnly: true,
  immediate: (planet, ctx) => {
    planet.within(ctx.from, (country) => {
      country.addResource({ resource: "influence", amount: 50 });
      country.giveTechnology({ tech: resonanceTheory });
    });
  },
  options: [{ name: "Noted." }],
});

export const humReturns = eventNamespace.defineCountryEvent({
  id: 1,
  title: "The Hum Returns",
  desc: "Deep in the lattice, something answers back.",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.randomList([
      {
        weight: 60,
        do: (c) => c.setCountryFlag(flags.tp_heard_the_hum),
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
      .if(hasCountryFlag(flags.tp_heard_the_hum), (c) => {
        c.within(stormWorld, (planet) => planet.addDeposit("d_minerals_1"));
      })
      .else((c) => c.log("the hum went unheard"));
  },
  options: [{ name: "Fascinating." }],
});

export const technologies = collection(undefined, [resonanceTheory, resonanceWeapons]);
export const events = collection("events", [aftershock, humReturns]);
