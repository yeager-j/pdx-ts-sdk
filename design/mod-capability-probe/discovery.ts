import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_CONTENT_PATTERN, type DiscoverOptions } from "../../packages/sdk/src/discover.ts";
import { type Collection } from "../../packages/sdk/src/items.ts";
import {
  compareLogicalPaths,
  normalizeLogicalPath,
} from "../../packages/sdk/src/resolver/path-order.ts";
import type { CapabilityFeature } from "./capability.ts";

function isCollection(value: unknown): value is Collection {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemKind" in value &&
    value.itemKind === "collection"
  );
}

function stateless(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, "");
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags);
}

/**
 * The explicit-feature alternative to today's `discoverContent`.
 *
 * It accepts the same include contract, filters before imports, and preserves
 * the current walk's logical-path order. Every selected module must export one
 * placement value under the stable name `feature`; other exports are ordinary
 * module API.
 */
export async function discoverExplicitFeatures<P extends string>(
  dir: string | URL,
  options: DiscoverOptions = {}
): Promise<CapabilityFeature<P>[]> {
  const root = dir instanceof URL ? fileURLToPath(dir) : dir;
  const include = stateless(options.include ?? DEFAULT_CONTENT_PATTERN);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = normalizeLogicalPath(
        path.relative(root, absolute).split(path.sep).join("/")
      );
      return { absolute, relative };
    });
  const modules = candidates
    .filter((candidate) => include.test(candidate.relative))
    .sort((left, right) => compareLogicalPaths(left.relative, right.relative));

  if (modules.length === 0) {
    throw new Error(emptyWalkMessage(root, include, candidates));
  }

  const features: CapabilityFeature<P>[] = [];
  for (const { absolute, relative } of modules) {
    const exports = (await import(pathToFileURL(absolute).href)) as Record<string, unknown>;
    if (!isCollection(exports.feature)) {
      throw new Error(`${relative} must export one collection as "feature"`);
    }
    if (exports.feature.file === undefined) {
      throw new Error(`${relative} explicitly exports a feature without a stem`);
    }
    features.push(exports.feature as CapabilityFeature<P>);
  }
  return features;
}

function emptyWalkMessage(
  root: string,
  include: RegExp,
  candidates: readonly { readonly relative: string }[]
): string {
  const sourceFiles = candidates
    .filter((candidate) => candidate.relative.endsWith(".ts"))
    .map((candidate) => candidate.relative)
    .sort();
  if (sourceFiles.length === 0) {
    return `No explicit feature modules under ${root}: it holds no TypeScript at all.`;
  }
  return (
    `No explicit feature modules under ${root}: ${include} matched none of the ${sourceFiles.length} ` +
    `TypeScript files there. Excluded:\n` +
    sourceFiles.map((relative) => `  - ${relative}`).join("\n")
  );
}
