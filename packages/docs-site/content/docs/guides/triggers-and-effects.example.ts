import { and, countryFlags, createMod, hasCountryFlag, not } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.4.*",
});

const flags = countryFlags("crystal_resonance_heard_the_hum", "crystal_resonance_rejected_the_hum");

const resonanceReady = and(
  hasCountryFlag(flags.crystal_resonance_heard_the_hum),
  not(hasCountryFlag(flags.crystal_resonance_rejected_the_hum))
);

const resonanceWeapons = mod.technology("resonance_weapons", {
  name: "Resonance Disruptors",
  desc: "Weaponized harmonics that shatter hulls from within.",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  weight: 70,
  potential: resonanceReady,
});

const events = mod.namespace("resonance");

const humReturns = events.country(1, {
  title: "The Hum Returns",
  desc: "Deep in the lattice, something answers back.",
  isTriggeredOnly: true,
  immediate: (country) => {
    country
      .if(resonanceReady, () => {
        country.addResource({ resource: "influence", amount: 50 });
      })
      .else(() => country.log("the hum went unheard"));
  },
  options: [{ name: "Fascinating.", key: "fascinating" }],
});

export default mod.compile([mod.feature("resonance", [resonanceWeapons, humReturns])]);
