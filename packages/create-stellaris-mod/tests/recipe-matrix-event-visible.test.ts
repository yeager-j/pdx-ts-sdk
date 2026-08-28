/**
 * The event recipe's visible slice of the matrix — see `recipe-matrix.test.ts`
 * for what the matrix as a whole proves and how it is split, and
 * `helpers/event-matrix.ts` for the shared shape of both event files.
 */

import { describeEventMatrix } from "./helpers/event-matrix.ts";

describeEventMatrix("visible");
