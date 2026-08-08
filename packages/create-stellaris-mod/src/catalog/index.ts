/**
 * The catalog this release carries.
 *
 * One module-level value, because the catalog is a constant: recipes are baked
 * into the package, nothing is loaded from disk or a registry, and `list`,
 * `view` and `generate` all read the same instance. Construction is where the
 * protocol is checked, so an ill-formed recipe fails when this module is
 * imported — in the package's own tests — rather than when somebody runs it.
 */

import { createCatalog } from "./catalog.ts";
import { researchQuestRecipe } from "./recipes/research-quest.ts";
import { technologyRecipe } from "./recipes/technology.ts";

export const CATALOG = createCatalog([technologyRecipe, researchQuestRecipe]);
