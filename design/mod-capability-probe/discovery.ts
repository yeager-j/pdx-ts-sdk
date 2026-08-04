import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Collection } from "../../packages/sdk/src/items.ts";

function isCollection(value: unknown): value is Collection {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemKind" in value &&
    value.itemKind === "collection"
  );
}

/**
 * The explicit-feature alternative to today's `discoverContent`.
 *
 * Every module must export exactly one placement value under the stable name
 * `feature`. Other exports are ordinary module API: definitions may be
 * imported by sibling features without also becoming implicit placements.
 * The feature carries its own stem, so a source-file rename changes no output.
 */
export async function discoverExplicitFeatures(dir: string | URL): Promise<Collection[]> {
  const root = dir instanceof URL ? fileURLToPath(dir) : dir;
  const entries = await readdir(root, {
    recursive: true,
    withFileTypes: true,
  });
  const modules = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  const features: Collection[] = [];

  for (const absolute of modules) {
    const exports = (await import(pathToFileURL(absolute).href)) as Record<string, unknown>;
    if (!isCollection(exports.feature)) {
      throw new Error(`${path.relative(root, absolute)} must export one collection as "feature"`);
    }
    if (exports.feature.file === undefined) {
      throw new Error(
        `${path.relative(root, absolute)} explicitly exports a feature without a stem`
      );
    }
    features.push(exports.feature);
  }
  return features;
}
