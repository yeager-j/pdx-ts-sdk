/**
 * The feature's hook bindings. The events are imported and bound, not
 * re-exported — they are already placed by the module that defined them, and
 * `on()` proves ownership by identity rather than by placement.
 *
 * The list inside one `on(...)` call is the firing order the game sees; it is
 * author data, so it is written here and never inferred from file or export
 * order.
 */

import { on, onActions } from "../../../../src/index.ts";
import { firstLight, secondLight } from "./events.ts";

export const gameStart = on(onActions.onGameStartCountry, [firstLight, secondLight]);
