/** A feature module placing its Items from a namespace. */

import * as items from "./items.ts";
import { mod } from "./mod.ts";

export const feature = mod.feature("main", items);
