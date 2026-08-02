/**
 * A reusable content pack — the shape SDK-22 says the builder API cannot
 * express. Today a pack must export `(mod: Mod) => void`; here it exports a
 * collection whose type says everything. Creation is registration: the
 * factory's definers record what they make, so there is nothing to forget.
 * The consuming build passes the collection (or an array of collections)
 * straight to `buildMod`.
 *
 * Ids hardcode the consuming mod's prefix; a prefix-generic pack is just a
 * function of the prefix returning the same collection.
 */

import { createTechnologies } from "./factories.ts";

const techs = createTechnologies();

const resonanceTheory = techs.defineTechnology({
  id: "pp_probe_tech_resonance_theory",
  name: "Crystal Resonance Theory",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

techs.defineTechnology({
  id: "pp_probe_tech_resonance_weapons",
  name: "Resonance Weaponry",
  cost: 3500,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [resonanceTheory, "tech_lasers_2"],
  weight: 80,
});

export const resonancePack = techs;
