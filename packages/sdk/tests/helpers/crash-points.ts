/**
 * The instants a materialization can be interrupted at, as the tests name them.
 *
 * This table is the matrix's half of the fault-injection seam, and the
 * production call sites in `src/output/` are the other half.
 * `materialization-crash.test.ts` compares the two, so a point renamed or added
 * on one side and not the other fails a test rather than quietly turning a
 * crash row into a run that is never interrupted.
 *
 * The vocabulary is the phase names (announced when a journal record is on the
 * disk and the action it announces has not happened yet), four rename points
 * (announced when a rename has landed), and two prefixed families that carry a
 * target-relative path.
 */

import { MATERIALIZATION_PHASES } from "../../src/output/transaction.ts";

/** One point per journal phase; the name is the phase itself. */
export const JOURNAL_POINTS: readonly string[] = [...MATERIALIZATION_PHASES];

export const RENAME_CONTENT_DEACTIVATE = "rename:content-deactivate";
export const RENAME_CONTENT_ACTIVATE = "rename:content-activate";
export const RENAME_DESCRIPTOR_DEACTIVATE = "rename:descriptor-deactivate";
export const RENAME_DESCRIPTOR_ACTIVATE = "rename:descriptor-activate";

export const RENAME_POINTS: readonly string[] = [
  RENAME_CONTENT_DEACTIVATE,
  RENAME_CONTENT_ACTIVATE,
  RENAME_DESCRIPTOR_DEACTIVATE,
  RENAME_DESCRIPTOR_ACTIVATE,
];

/** Announced before a classification walk descends into a directory. */
export const TRAVERSAL_DESCEND_PREFIX = "traversal:descend:";

/** Announced before a foreign file is carried into the staged tree. */
export const PRESERVE_PREFIX = "preserve:";

export const POINT_PREFIXES: readonly string[] = [TRAVERSAL_DESCEND_PREFIX, PRESERVE_PREFIX];

export function traversalDescend(relPath: string): string {
  return `${TRAVERSAL_DESCEND_PREFIX}${relPath}`;
}

export function preserveEntry(relPath: string): string {
  return `${PRESERVE_PREFIX}${relPath}`;
}
