/**
 * The amplifier ladder: a second feature, a second stem.
 *
 * It emits `common/technology/hello_galaxy_amplifiers.txt` — the same registry
 * as `resonance.ts`, a different file, because the file stem is the module's
 * basename. Two features, two files, no folder in the output that Stellaris did
 * not ask for.
 *
 * It imports the resonance feature's first technology and requires it, without
 * re-exporting it — importing a value is not registering it, so the theory tech
 * is still placed by the module that defined it. (Re-exporting it here would
 * place the same definition twice, which `buildMod` reports as a duplicate id.)
 */

import { defineTechnology, type TechnologyItem } from "../../../packages/sdk/src/index.ts";
import { resonanceTheory } from "./resonance.ts";

// Build-time loop: one definition, five tiers of amplifier techs, each
// requiring the previous — the "generate fifty variants" superpower. Discovery
// flattens the exported array, so a loop needs no special ceremony.
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
  previous = defineTechnology({
    id: `hello_galaxy_tech_amplifier_${tier}`,
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
