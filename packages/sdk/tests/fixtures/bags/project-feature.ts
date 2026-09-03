/** The bag project's first feature module, which imports a helper from the second. */

import { TIER } from "./project-helper.ts";
import { mod } from "./project.ts";

export const feature = mod.feature("declared", [
  mod.technology("declared", {
    name: "Declared",
    area: "physics",
    tier: TIER,
    category: "particles",
    cost: 100,
    weight: 100,
  }),
]);
