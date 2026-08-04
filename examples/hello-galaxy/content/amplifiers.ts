/**
 * The amplifier ladder: a second feature, a second stem.
 *
 * It emits `common/technology/hello_galaxy_amplifiers.txt` — the same registry
 * as `resonance.ts`, a different file, because this feature authors the
 * `amplifiers` stem. Two features, two files, no folder in the output that
 * Stellaris did not ask for.
 *
 * It imports the resonance feature's first technology and requires it. Named
 * exports are ordinary module API; only this module's `feature` export places
 * content, so reusing the theory never registers it twice.
 */

import type { TechnologyItem } from "@pdx-ts/sdk";

import { mod } from "../mod.ts";
import { resonanceTheory } from "./resonance.ts";

// Build-time loop: one definition, five tiers of amplifier techs, each
// requiring the previous — the "generate fifty variants" superpower.
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

export { amplifiers };

export const feature = mod.feature("amplifiers", amplifiers);
