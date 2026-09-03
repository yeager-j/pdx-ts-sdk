/** The one feature module of the bag project. */

import { mod } from "./project.ts";

export const feature = mod.feature("declared", [
  mod.technology("declared", {
    name: "Declared",
    area: "physics",
    tier: 1,
    category: "particles",
    cost: 100,
    weight: 100,
  }),
]);
