/**
 * The resonance feature's technologies.
 *
 * Discovery names the emitted file after this module's basename, so these land
 * in `common/technology/hello_galaxy_technology.txt` — the same file
 * `../amplifiers/technology.ts` emits into. Two folders, one registry file:
 * that is the whole point. Source groups by feature, output groups by registry.
 */

import { and, defineTechnology, hasCountryFlag, not } from "../../../../src/index.ts";
import { flags } from "../../flags.ts";

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
