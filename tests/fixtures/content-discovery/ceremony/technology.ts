/**
 * A second feature emitting into the same registry file. It imports the
 * expansion feature's technology to require it, without re-exporting it:
 * importing a value is not registering it.
 */

import { defineTechnology } from "../../../../src/index.ts";
import { beaconNetwork } from "../expansion/technology.ts";

export const chorusRites = defineTechnology({
  id: "pp_disco_tech_chorus_rites",
  name: "Chorus Rites",
  cost: 3000,
  area: "society",
  tier: 2,
  category: "statecraft",
  prerequisites: [beaconNetwork],
  weight: 50,
});
