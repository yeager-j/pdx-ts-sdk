import { and, hasCountryFlag, Mod, not } from "../../src/index.ts";

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
    description: "The lattice hums at frequencies we are only beginning to hear.",
    cost: 2000,
    area: "physics",
    tier: 2,
    category: "particles",
    weight: 100,
  });

  mod.defineTechnology({
    id: "hello_galaxy_tech_resonance_weapons",
    name: "Resonance Disruptors",
    description: "Weaponized harmonics that shatter hulls from within.",
    cost: 6000,
    area: "physics",
    tier: 3,
    category: "particles",
    prerequisites: [resonanceTheory, "tech_lasers_2"],
    isRare: true,
    weight: 70,
    potential: and(
      hasCountryFlag("hello_galaxy_heard_the_hum"),
      not(hasCountryFlag("hello_galaxy_pacifist_path"))
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

  return mod;
}
