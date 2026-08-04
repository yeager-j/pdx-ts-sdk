/**
 * A reusable content pack — the shape the class builder cannot express.
 * A capability-bound pack is a function of its owner. It remains pure: the
 * returned feature registers nothing until the caller compiles it.
 */

import type { IdProfile, ModCapability } from "../../src/index.ts";

export function resonancePack<P extends string, I extends IdProfile>(mod: ModCapability<P, I>) {
  const resonanceTheory = mod.technology("resonance_theory", {
    name: "Crystal Resonance Theory",
    cost: 2000,
    area: "physics",
    tier: 2,
    category: "particles",
    weight: 100,
  });

  const resonanceWeapons = mod.technology("resonance_weapons", {
    name: "Resonance Weaponry",
    cost: 3500,
    area: "physics",
    tier: 3,
    category: "particles",
    prerequisites: [resonanceTheory, "tech_lasers_2"],
    weight: 80,
  });

  return mod.feature(undefined, [resonanceTheory, resonanceWeapons]);
}
