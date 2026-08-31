import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Lists files with a given extension under a registry directory in stable order.
 *
 * Set `recurse` from the registry's `path_strict` rule. A directory that does not exist returns an
 * empty list so callers can report an empty corpus without handling an `ENOENT` filesystem error;
 * all other filesystem errors propagate to the caller.
 *
 * Absence is whatever the platform calls `ENOENT`, and platforms disagree at the margin: a path
 * *beneath* a regular file is `ENOTDIR` on POSIX but absent on Windows. The faults worth telling
 * apart from an absent registry — a permission error, a file where the directory belongs — raise
 * a distinct code everywhere.
 */
export function walkRegistryFiles(
  dir: string,
  extension: string,
  recurse: boolean
): readonly string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
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

/**
 * Converts a registry file path to a portable slash-separated relative path.
 *
 * Use the returned path in reports and diagnostics that must be stable across platforms.
 */
export function relativeRegistryPath(dir: string, file: string): string {
  return path.relative(dir, file).split(path.sep).join("/");
}
