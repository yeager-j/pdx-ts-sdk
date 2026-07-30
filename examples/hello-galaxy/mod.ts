import {
  and,
  countryFlags,
  eventTarget,
  hasCountryFlag,
  hasOwner,
  isAtWar,
  Mod,
  not,
} from "../../src/index.ts";

/**
 * Flags this mod sets and reads.
 *
 * Declaring them buys autocomplete and, because each value set is branded, a
 * planet flag passed to `hasCountryFlag` is a compile error.
 */
const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");

export function defineHelloGalaxy(): Mod<"hello_galaxy"> {
  const mod = new Mod({
    name: "Hello Galaxy",
    prefix: "hello_galaxy",
    version: "0.1.0",
    supportedVersion: "4.0.*",
    tags: ["Technologies"],
  });

  const resonanceTheory = mod.defineTechnology({
    id: "hello_galaxy_tech_resonance_theory",
    name: "Crystal Resonance Theory",
    desc: "The lattice hums at frequencies we are only beginning to hear.",
    cost: 2000,
    area: "physics",
    tier: 2,
    category: "particles",
    weight: 100,
  });

  mod.defineTechnology({
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

  // Build-time loop: one definition, five tiers of amplifier techs, each
  // requiring the previous — the "generate fifty variants" superpower.
  let previous = resonanceTheory;
  for (const [index, adjective] of [
    "Attuned",
    "Harmonic",
    "Coherent",
    "Superradiant",
    "Transcendent",
  ].entries()) {
    const tier = index + 1;
    previous = mod.defineTechnology({
      id: `hello_galaxy_tech_amplifier_${tier}`,
      name: `${adjective} Resonance Amplifiers`,
      cost: 1000 * 2 ** tier,
      area: "physics",
      tier: Math.min(tier + 1, 5),
      category: "particles",
      prerequisites: [previous],
      weight: 100 - 10 * tier,
    });
  }

  // The event chain: a country event whose immediate runs in-game control
  // flow, saves an event target on a planet, and fires a follow-up that reads
  // the firing country back through FROM. Every scope transition is
  // compile-checked; recording happens right here, at define time.
  const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

  const aftershock = mod.definePlanetEvent({
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

  mod.defineCountryEvent({
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

  return mod;
}
