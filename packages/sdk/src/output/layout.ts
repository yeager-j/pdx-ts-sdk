/**
 * Where a materialization's own paths are, relative to the target it replaces.
 *
 * A materialization never writes inside the target until the last rename: it
 * mints siblings beside it, journals their names, and swaps. Three operations
 * depend on those names agreeing — the writer mints them, recovery decides
 * from the journal which paths it may delete, and the preflight check measures
 * the longest one against the filesystem's name limit — so the shapes are
 * stated once here rather than spelled again at each use.
 */

import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The four siblings a materialization mints, each `<prefix><uuid>`. */
export type SiblingRole = "staging" | "previous" | "descriptorStaging" | "descriptorPrevious";

export const SIBLING_PREFIXES: Readonly<Record<SiblingRole, string>> = Object.freeze({
  staging: ".pdx-staging-",
  previous: ".pdx-previous-",
  descriptorStaging: ".pdx-descriptor-staging-",
  descriptorPrevious: ".pdx-descriptor-previous-",
});

/**
 * The lock file's basename prefix. It is a sibling like the four above, and
 * unlike them it carries the target's own basename rather than a UUID: two
 * spellings of one target must converge on one lock name.
 */
export const LOCK_BASENAME_PREFIX = ".pdx-lock-";

/** The UUID a minted sibling ends in, so a name cannot be anything at all. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The length of a `randomUUID()`, which every minted sibling ends with. */
export const UUID_LENGTH = 36;

/** The longest basename the four roles can produce, before the UUID. */
export const LONGEST_SIBLING_PREFIX = Object.values(SIBLING_PREFIXES).reduce((longest, prefix) =>
  prefix.length > longest.length ? prefix : longest
);

/** The lock and journal file protecting one target. */
export function lockPathFor(target: string): string {
  return path.join(path.dirname(target), LOCK_BASENAME_PREFIX + path.basename(target));
}

/**
 * The siblings one materialization moves through. A build uses the first two;
 * an install adds the descriptor half.
 */
export interface MaterializationPaths {
  readonly staging: string;
  readonly previous: string;
  readonly descriptorStaging?: string;
  readonly descriptorPrevious?: string;
}

/** All four siblings, which only an install mints. */
export type InstallPaths = Required<MaterializationPaths>;

function mintSibling(parent: string, role: SiblingRole): string {
  return path.join(parent, `${SIBLING_PREFIXES[role]}${randomUUID()}`);
}

/**
 * Name a build's siblings before anything creates them, so the caller can
 * journal the names first. Recovery may only delete a path the journal named,
 * and a name written down after the directory exists proves nothing about a
 * transaction that died in between.
 */
export function stagingPaths(target: string): MaterializationPaths {
  const parent = path.dirname(target);
  return { staging: mintSibling(parent, "staging"), previous: mintSibling(parent, "previous") };
}

/**
 * The same for an install, whose descriptor half moves through two more
 * siblings. All four go beside the content target, which is also where the
 * descriptor lives; `isMintedSibling` is the rule recovery checks them against.
 */
export function installPaths(target: string): InstallPaths {
  const parent = path.dirname(target);
  return {
    ...stagingPaths(target),
    descriptorStaging: mintSibling(parent, "descriptorStaging"),
    descriptorPrevious: mintSibling(parent, "descriptorPrevious"),
  };
}

/** The sibling paths a set of them actually names, in role order. */
export function journaledSiblings(paths: MaterializationPaths): string[] {
  return [paths.staging, paths.previous, paths.descriptorStaging, paths.descriptorPrevious].filter(
    (candidate): candidate is string => candidate !== undefined
  );
}

/**
 * Whether `candidate` is a name a materialization of a target in `parent`
 * could have minted for `role`. This is what keeps a journal from being a
 * delete-anything primitive: it may only name its own siblings.
 */
export function isMintedSibling(candidate: string, parent: string, role: SiblingRole): boolean {
  const prefix = SIBLING_PREFIXES[role];
  const basename = path.basename(candidate);
  return (
    path.dirname(candidate) === parent &&
    basename.startsWith(prefix) &&
    UUID_PATTERN.test(basename.slice(prefix.length))
  );
}

/**
 * Whether `candidate` is a lock file beside a target in `parent`. The basename
 * is the target's own, so there is no UUID to check — only the prefix and the
 * directory.
 */
export function isLockSibling(candidate: string, parent: string): boolean {
  return (
    path.dirname(candidate) === parent && path.basename(candidate).startsWith(LOCK_BASENAME_PREFIX)
  );
}

/**
 * The physical target, resolved once at the entry point: the parent through
 * every symlink, joined to the basename exactly as the caller spelled it. The
 * basename stays verbatim on purpose — the lock name derives from it, so two
 * aliases of one directory must produce one lock name and not a sanitized
 * form that collapses unrelated names together.
 *
 * The parent is created, because everything else this returns a path for is
 * about to be written into it.
 */
export async function canonicalTarget(target: string | URL): Promise<string> {
  const resolved = resolveTarget(target);
  const parent = path.dirname(resolved);
  await mkdir(parent, { recursive: true });
  return path.join(await realpath(parent), path.basename(resolved));
}

/**
 * The same physical form, without creating a parent the caller may not need.
 * Recovery reads a target rather than writing one: a recovery of a path that
 * is not there must not leave the directory chain behind that its absence
 * proves nobody asked for.
 */
export async function physicalTarget(target: string | URL): Promise<string> {
  const resolved = resolveTarget(target);
  try {
    return path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return resolved;
    }
    throw error;
  }
}

/**
 * The physical form as far as it can be known without creating anything: the
 * nearest ancestor that exists, resolved, with the components that do not
 * exist yet joined back on lexically.
 *
 * The representability check has to run before the parent directories are
 * made, or a refused materialization leaves a directory chain behind that the
 * caller never asked for and nothing will clean up. Resolving what exists is
 * enough for that check, because the components still to be created cannot be
 * symlinks — nothing has created them.
 */
export async function nearestPhysicalForm(target: string | URL): Promise<string> {
  const resolved = resolveTarget(target);
  const pending: string[] = [];
  let ancestor = resolved;
  for (;;) {
    const parent = path.dirname(ancestor);
    pending.unshift(path.basename(ancestor));
    if (parent === ancestor) {
      return resolved;
    }
    try {
      return path.join(await realpath(parent), ...pending);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      ancestor = parent;
    }
  }
}

function resolveTarget(target: string | URL): string {
  return path.resolve(target instanceof URL ? fileURLToPath(target) : target);
}
