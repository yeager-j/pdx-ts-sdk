/**
 * The other half of the same-basename pair. Discovery names the emitted file
 * after this module's basename, so `ceremony/technology.ts` and
 * `ritual/technology.ts` share the stem `technology` and merge into one
 * `common/technology/pp_disco_technology.txt` — two folders, one registry file.
 */

import { defineTechnology } from "../../../../src/index.ts";

export const vigilCadence = defineTechnology({
  id: "pp_disco_tech_vigil_cadence",
  name: "Vigil Cadence",
  cost: 4000,
  area: "society",
  tier: 3,
  category: "statecraft",
  weight: 40,
});
