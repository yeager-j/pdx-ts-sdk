/**
 * A reusable content pack — the shape the class builder cannot express.
 * With `Mod` a pack must export `(mod: Mod) => void`; here it exports a
 * collection whose type says everything: free definers make the items and
 * `collection(...)` places them, so a pack is data. The consuming build
 * passes the collection (or an array of collections) straight to `buildMod`.
 *
 * Ids hardcode the consuming mod's prefix; a prefix-generic pack is just a
 * function of the prefix returning the same collection.
 */

import { collection, defineTechnology } from "../../src/index.ts";

const resonanceTheory = defineTechnology({
  id: "pp_probe_tech_resonance_theory",
  name: "Crystal Resonance Theory",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

const resonanceWeapons = defineTechnology({
  id: "pp_probe_tech_resonance_weapons",
  name: "Resonance Weaponry",
  cost: 3500,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [resonanceTheory, "tech_lasers_2"],
  weight: 80,
});

export const resonancePack = collection(undefined, [resonanceTheory, resonanceWeapons]);
