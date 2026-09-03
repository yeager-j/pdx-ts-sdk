/** A features module whose Feature belongs to a different capability. */

import { otherMod } from "./mod.ts";

export const feature = otherMod.feature("foreign", [
  otherMod.technology("theirs", {
    name: "Theirs",
    area: "physics",
    tier: 1,
    category: "particles",
    cost: 100,
    weight: 100,
  }),
]);
