/**
 * Which files of an install belong to one registry.
 *
 * The two readers that ask this want different things out of the files —
 * `corpus/` counts the *fields* definitions write, `@pdx-ts/codegen-vanilla`'s
 * `read-ids.ts` collects their *ids* — but "which files" is one question with
 * one answer, and the two used to answer it differently. The corpus reader read
 * a single directory flat, so every registry whose files nest measured as a
 * subset of itself or as nothing at all: sprites nest under `interface/`, meshes
 * under `gfx/models/`.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Every file under `dir` carrying `extension`, in a stable sorted walk order.
 *
 * Sorted because filesystem order is not: both readers cap a sample and keep
 * whichever values arrive first, and both commit their result, so an unstable
 * order would diff on every re-read of an unchanged install.
 *
 * `recurse` is what the rules' `path_strict` decides: subdirectories of a strict
 * path hold *other* CWT types (`common/technology/tier`,
 * `common/technology/category`), and descending into them would attribute their
 * definitions to this registry.
 *
 * A missing directory yields nothing rather than throwing — it is how a path
 * that went stale across a game version announces itself to the reports.
 */
export function walkRegistryFiles(
  dir: string,
  extension: string,
  recurse: boolean
): readonly string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (recurse) {
        found.push(...walkRegistryFiles(full, extension, recurse));
      }
      continue;
    }
    if (name.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}

/** Always `/`-separated, so a path does not depend on the platform. */
export function relativeRegistryPath(dir: string, file: string): string {
  return path.relative(dir, file).split(path.sep).join("/");
}
