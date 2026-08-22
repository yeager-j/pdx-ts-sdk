/**
 * The instants a materialization can be interrupted at, as the tests name them.
 *
 * The names themselves belong to the production seam and are re-exported from
 * it, so a test and the writer it drives cannot spell one differently. What is
 * this file's own is the vocabulary the crash matrix asserts over:
 * `materialization-crash.test.ts` compares these lists against the call sites
 * in `src/output/`, so a point added on one side and not the other fails a test
 * rather than quietly turning a crash row into a run that is never interrupted.
 */

import { MATERIALIZATION_PHASES } from "../../src/output/journal.ts";
import {
  PRESERVE_PREFIX,
  RENAME_CONTENT_ACTIVATE,
  RENAME_CONTENT_DEACTIVATE,
  RENAME_DESCRIPTOR_ACTIVATE,
  RENAME_DESCRIPTOR_DEACTIVATE,
  TRAVERSAL_DESCEND_PREFIX,
} from "../../src/output/test-hooks.ts";

export {
  PRESERVE_PREFIX,
  preserveEntry,
  RENAME_CONTENT_ACTIVATE,
  RENAME_CONTENT_DEACTIVATE,
  RENAME_DESCRIPTOR_ACTIVATE,
  RENAME_DESCRIPTOR_DEACTIVATE,
  TRAVERSAL_DESCEND_PREFIX,
  traversalDescend,
} from "../../src/output/test-hooks.ts";

/** One point per journal phase; the name is the phase itself. */
export const JOURNAL_POINTS: readonly string[] = [...MATERIALIZATION_PHASES];

/** The points announced when a rename has landed. */
export const RENAME_POINTS: readonly string[] = [
  RENAME_CONTENT_DEACTIVATE,
  RENAME_CONTENT_ACTIVATE,
  RENAME_DESCRIPTOR_DEACTIVATE,
  RENAME_DESCRIPTOR_ACTIVATE,
];

/** The two families whose points carry a target-relative path. */
export const POINT_PREFIXES: readonly string[] = [TRAVERSAL_DESCEND_PREFIX, PRESERVE_PREFIX];
