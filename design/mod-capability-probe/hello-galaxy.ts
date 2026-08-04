import type { PureMod } from "../../packages/sdk/src/build.ts";
import {
  and,
  countryFlags,
  eventTarget,
  hasCountryFlag,
  hasOwner,
  isAtWar,
  not,
  scriptedEffect,
  scriptedTrigger,
  vanilla,
  type TechnologyItem,
} from "../../packages/sdk/src/index.ts";
import { createMod, stellarisIds } from "./capability.ts";

const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");

const isRegularEmpire = scriptedTrigger.unchecked("is_regular_empire", "country");
const hasActualDeficit = scriptedTrigger.unchecked("has_actual_deficit", "country");
const giveTechOptionOrProgressEffect = scriptedEffect.unchecked(
  "give_tech_option_or_progress_effect",
  "country"
);

export function defineCapabilityHelloGalaxy(): PureMod {
  const mod = createMod(
    {
      name: "Hello Galaxy",
      prefix: "hello_galaxy",
      version: "0.1.0",
      supportedVersion: "v4.0.*",
      tags: ["Technologies"],
    },
    { ids: stellarisIds }
  );
  const events = mod.namespace("resonance");
  const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

  const resonanceTheory = mod.technology("resonance_theory", {
    name: "Crystal Resonance Theory",
    desc: "The lattice hums at frequencies we are only beginning to hear.",
    cost: 2000,
    area: "physics",
    tier: 2,
    category: "particles",
    weight: 100,
  });

  const resonanceWeapons = mod.technology("resonance_weapons", {
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
      not(hasCountryFlag(flags.hello_galaxy_pacifist_path)),
      isRegularEmpire()
    ),
  });

  const aftershock = events.planet(2, {
    from: "country",
    title: "Aftershock",
    desc: "The crystal hum lingers over this world.",
    isTriggeredOnly: true,
    immediate: (_planet, ctx) => {
      ctx.from.effects((country) => {
        country.addResource({ resource: "influence", amount: 50 });
      });
    },
    options: [{ name: "Noted." }],
  });

  const humReturns = events.country(1, {
    title: "The Hum Returns",
    desc: "Deep in the lattice, something answers back.",
    isTriggeredOnly: true,
    immediate: (country, ctx) => {
      country.randomList([
        {
          weight: 60,
          do: (scopedCountry) => {
            scopedCountry.setCountryFlag(flags.hello_galaxy_heard_the_hum);
            scopedCountry.run(giveTechOptionOrProgressEffect({ TECH: resonanceTheory }));
          },
        },
        {
          weight: 40,
          modifiers: [
            { factor: 2, when: isAtWar() },
            {
              factor: 3,
              when: hasActualDeficit({
                RESOURCE: vanilla.resource("minerals"),
              }),
            },
          ],
          do: (scopedCountry) => {
            scopedCountry.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
              planet.saveEventTargetAs(stormWorld);
              planet.planetEvent({
                id: aftershock,
                from: ctx.self,
                days: 30,
              });
            });
          },
        },
      ]);
      country
        .if(hasCountryFlag(flags.hello_galaxy_heard_the_hum), (_scopedCountry) => {
          stormWorld.effects((planet) => planet.addDeposit("d_minerals_1"));
        })
        .else((scopedCountry) => scopedCountry.log("the hum went unheard"));
    },
    options: [{ name: "Fascinating." }],
  });

  const amplifiers: TechnologyItem[] = [];
  let previous: TechnologyItem = resonanceTheory;
  for (const [index, adjective] of [
    "Attuned",
    "Harmonic",
    "Coherent",
    "Superradiant",
    "Transcendent",
  ].entries()) {
    const tier = index + 1;
    previous = mod.technology(`amplifier_${tier}`, {
      name: `${adjective} Resonance Amplifiers`,
      cost: 1000 * 2 ** tier,
      area: "physics",
      tier: Math.min(tier + 1, 5),
      category: "particles",
      prerequisites: [previous],
      weight: 100 - 10 * tier,
    });
    amplifiers.push(previous);
  }

  return mod.compile([
    mod.feature("resonance", [resonanceTheory, resonanceWeapons, aftershock, humReturns]),
    mod.feature("amplifiers", amplifiers),
  ]);
}
