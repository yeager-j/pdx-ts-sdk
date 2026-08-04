/**
 * Explicit capability feature discovery.
 *
 * This impure shell selects modules before importing them, reads each selected
 * module's named `feature` export, and returns those capability-owned values.
 * Sibling exports, including a default export, are ordinary module API.
 *
 * Selected modules import in logical-path order. A feature owns its output
 * stem through `mod.feature(...)`, so its source basename and path are not
 * part of output identity.
 *
 * The default excludes companion suffixes before import. A custom `include`
 * may deliberately select companions, but every selected module must still
 * export a named capability feature. `compile()` owns canonical output order
 * and validation; the order inside definitions and one `mod.on(hook, [...])`
 * list remains author data.
 *
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CapabilityFeature } from "./mod-capability.ts";
import { compareLogicalPaths, normalizeLogicalPath } from "./ordering.ts";

/**
 * The default set of explicit feature modules: `.ts`, minus companion files.
 * Filtering happens before import; a custom include can deliberately select a
 * companion, which must then meet the same named-feature contract.
 */
export const DEFAULT_CONTENT_PATTERN = /(?<!\.(?:test|test-d|spec|bench|d))\.ts$/;

export interface DiscoverOptions {
  /**
   * Which files under `dir` are explicit feature modules, matched against each file's
   * `/`-separated path relative to `dir`. Supplying one *replaces*
   * `DEFAULT_CONTENT_PATTERN` rather than narrowing it: pass `/\.mod\.ts$/` to
   * discover only those, or `/\.ts$/` to deliberately take test files too.
   */
  readonly include?: RegExp;
}

interface DiscoveredModule {
  readonly absolute: string;
  readonly relative: string;
}

interface DiscoveredModules {
  readonly root: string;
  readonly include: RegExp;
  readonly candidates: readonly DiscoveredModule[];
  readonly modules: readonly DiscoveredModule[];
}

/**
 * `RegExp.test` advances `lastIndex` on a `/g` or `/y` pattern, so the same
 * regex would answer differently for the same path depending on how many files
 * preceded it. Dropping those two flags is what keeps the walk a pure function
 * of the tree; every other flag is the author's business.
 */
function stateless(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, "");
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags);
}

async function discoverModules(
  dir: string | URL,
  options: DiscoverOptions
): Promise<DiscoveredModules> {
  const include = stateless(options.include ?? DEFAULT_CONTENT_PATTERN);
  const root = dir instanceof URL ? fileURLToPath(dir) : dir;
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      return { absolute, relative: normalizeLogicalPath(relative) };
    });
  const modules = candidates
    .filter((module) => include.test(module.relative))
    .sort((a, b) => compareLogicalPaths(a.relative, b.relative));
  return { root, include, candidates, modules };
}

/**
 * Discovers capability-owned features from `dir`.
 *
 * Each selected module must export its already-placed feature as the named
 * `feature` export. Its siblings, including a default export, are ordinary
 * module API and are ignored. A feature authors its own file stem through
 * `mod.feature(...)`, so moving or renaming its source module does not change
 * output identity. The default skips colocated companion files.
 * Compile the returned features with the capability that created them, which
 * enforces their ownership.
 */
export async function discoverFeatures<P extends string>(
  dir: string | URL,
  options: DiscoverOptions = {}
): Promise<CapabilityFeature<P>[]> {
  const { root, include, candidates, modules } = await discoverModules(dir, options);
  if (modules.length === 0) {
    throw new Error(emptyFeatureWalkMessage(root, include, candidates));
  }

  const features: CapabilityFeature<P>[] = [];
  for (const module of modules) {
    const exports = (await import(pathToFileURL(module.absolute).href)) as Record<string, unknown>;
    if (!isCapabilityFeature(exports.feature)) {
      throw new Error(`${module.relative} must export one capability feature as "feature"`);
    }
    if (exports.feature.file === undefined) {
      throw new Error(`${module.relative} exports "feature" without an authored file stem`);
    }
    features.push(exports.feature as CapabilityFeature<P>);
  }
  return features;
}

/**
 * A pattern that matches nothing would otherwise build a mod with no content
 * at all, which is a typo rendering as a successful build. The two ways to get
 * here read differently and are reported differently: a directory holding
 * TypeScript the pattern rejected is a pattern problem, and one holding none is
 * a path problem.
 */
function emptyFeatureWalkMessage(
  root: string,
  include: RegExp,
  candidates: readonly { readonly relative: string }[]
): string {
  const excluded = candidates
    .filter((entry) => entry.relative.endsWith(".ts"))
    .map((entry) => entry.relative)
    .sort();
  if (excluded.length === 0) {
    return `No explicit feature modules under ${root}: it holds no TypeScript at all.`;
  }
  return (
    `No explicit feature modules under ${root}: ${include} matched none of the ${excluded.length} ` +
    `TypeScript files there. Excluded:\n` +
    excluded.map((relPath) => `  - ${relPath}`).join("\n") +
    `\nThe default (${DEFAULT_CONTENT_PATTERN}) takes .ts and leaves out colocated tests.`
  );
}

function isCapabilityFeature(value: unknown): value is CapabilityFeature<string> {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemKind" in value &&
    value.itemKind === "collection"
  );
}
