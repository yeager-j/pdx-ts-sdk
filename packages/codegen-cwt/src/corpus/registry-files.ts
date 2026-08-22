import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Lists files with a given extension under a registry directory in stable order.
 *
 * Set `recurse` from the registry's `path_strict` rule. A missing directory returns an empty
 * list so callers can report an empty corpus without handling a filesystem error.
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

/**
 * Converts a registry file path to a portable slash-separated relative path.
 *
 * Use the returned path in reports and diagnostics that must be stable across platforms.
 */
export function relativeRegistryPath(dir: string, file: string): string {
  return path.relative(dir, file).split(path.sep).join("/");
}
