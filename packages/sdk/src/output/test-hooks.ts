/**
 * The seam the negative-control tests drive materialization through.
 *
 * Crash safety is a claim about what a killed writer leaves behind, and the
 * only honest way to test it is to kill a real process at a named instant. The
 * instants that matter — the moment a journal record reached the disk, the
 * moment a rename landed, the moment before a directory is descended into —
 * are inside the writer, so nothing outside it can observe them. That is why
 * the announcement lives in the production path rather than in the tests.
 *
 * It is not part of the package's API and is not exported from `index.ts`. The
 * underscore names say so, and the cost when no hook is set is one optional
 * call: nothing is allocated, and nothing is awaited that a hook did not
 * create.
 */

export type MaterializationTestHook = (point: string) => void | Promise<void>;

let hook: MaterializationTestHook | undefined;

/** Install the hook for this process, or clear it by passing nothing. */
export function _setMaterializationTestHook(next?: MaterializationTestHook): void {
  hook = next;
}

/**
 * Announce that the writer has reached `point`. Every call site awaits the
 * result, so a hook may take as long as it likes — including forever, which is
 * what a test that kills the process at this instant needs so the writer can
 * never run past the point it was killed at.
 */
export function _materializationTestPoint(point: string): void | Promise<void> {
  return hook?.(point);
}

/**
 * The points that are not a journal phase, named here so that the writer and
 * the tests that drive it cannot spell them differently. A phase is announced
 * by `transaction.ts` under its own name; everything below is announced by the
 * step it belongs to. Each rename point means the rename has landed.
 */
export const RENAME_CONTENT_DEACTIVATE = "rename:content-deactivate";
export const RENAME_CONTENT_ACTIVATE = "rename:content-activate";
export const RENAME_DESCRIPTOR_DEACTIVATE = "rename:descriptor-deactivate";
export const RENAME_DESCRIPTOR_ACTIVATE = "rename:descriptor-activate";

/** Announced before a classification walk descends into a directory. */
export const TRAVERSAL_DESCEND_PREFIX = "traversal:descend:";

/** Announced before a foreign file is carried into the staged tree. */
export const PRESERVE_PREFIX = "preserve:";

/** The descent point for one target-relative directory path. */
export function traversalDescend(relPath: string): string {
  return `${TRAVERSAL_DESCEND_PREFIX}${relPath}`;
}

/** The carry point for one target-relative foreign file. */
export function preserveEntry(relPath: string): string {
  return `${PRESERVE_PREFIX}${relPath}`;
}
