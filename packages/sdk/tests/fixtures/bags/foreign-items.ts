/** An Item minted by a different capability than the one placing it. */

import { otherMod } from "./mod.ts";

export const foreign = otherMod.technology("foreign", {
  name: "Foreign",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});
