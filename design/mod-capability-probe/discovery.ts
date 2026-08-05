import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_CONTENT_PATTERN,
  type DiscoverOptions,
} from "../../packages/sdk/src/authoring/discover.ts";
import {
  createFeature,
  FILE_STEM_PATTERN,
  type Feature,
  type ModItem,
} from "../../packages/sdk/src/authoring/feature.ts";
import { compareLogicalPaths, normalizeLogicalPath } from "../../packages/sdk/src/ordering.ts";
import type { CapabilityFeature } from "./capability.ts";

const ITEM_KINDS = new Set<string>(["content", "event", "on-action", "patch", "contribution"]);
const DEFINER_LIST =
  "defineTechnology, namespace(...).defineCountryEvent, on, patchTechnology, addShipOfSizeLimits, ...";

function isFeature(value: unknown): value is Feature {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemKind" in value &&
    value.itemKind === "feature"
  );
}

function stateless(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, "");
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags);
}

/**
 * Historical every-export discovery, retained only to compare its output with
 * the capability feature contract in this probe. Production authoring no
 * longer exposes this registration mechanism.
 */
export async function discoverEveryExport(
  dir: string | URL,
  options: DiscoverOptions = {}
): Promise<Feature[]> {
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

  const stemmed = modules.map((module) => ({ ...module, stem: fileStemOf(module.absolute) }));
  assertModuleStems(stemmed);

  const features: Feature[] = [];
  for (const module of stemmed) {
    const exports = (await import(pathToFileURL(module.absolute).href)) as Record<string, unknown>;
    features.push(collectModule(module.relative, module.stem, exports));
  }
  return features;
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
    if (!isFeature(exports.feature)) {
      throw new Error(`${relative} must export one feature as "feature"`);
    }
    if (exports.feature.stem === undefined) {
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

function fileStemOf(absolute: string): string {
  const basename = path.basename(absolute);
  const dot = basename.indexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

function assertModuleStems(
  modules: readonly { readonly relative: string; readonly stem: string }[]
): void {
  const invalid = modules.filter((module) => !FILE_STEM_PATTERN.test(module.stem));
  if (invalid.length === 0) {
    return;
  }
  throw new Error(
    `${invalid.length} discovered module basename${invalid.length === 1 ? "" : "s"} ` +
      `${invalid.length === 1 ? "does" : "do"} not reduce to lowercase snake_case ` +
      `([a-z][a-z0-9_]*), the emitted file stem grammar — the basename up to its first "." ` +
      `names the file the module emits:\n` +
      invalid.map((module) => `  - ${module.relative} → "${module.stem}"`).join("\n") +
      "\nRename the file, or narrow `include` to exclude it, before any discovered module is imported."
  );
}

function collectModule(relPath: string, stem: string, exports: Record<string, unknown>): Feature {
  const items = new Set<ModItem>();
  for (const [name, value] of Object.entries(exports)) {
    collect(relPath, name, value, items);
  }
  if (items.size === 0) {
    throw new Error(
      `The discovered module ${relPath} exports nothing the SDK recognizes, so it would emit an ` +
        `empty file. Export what its definers (${DEFINER_LIST}) returned, or move the module out ` +
        "of the discovered directory."
    );
  }
  try {
    return createFeature(stem, [...items]);
  } catch (error) {
    throw new Error(
      `The discovered module ${relPath} names the file it emits, so its basename is the file ` +
        `stem: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function collect(relPath: string, name: string, value: unknown, items: Set<ModItem>): void {
  if (Array.isArray(value)) {
    value.forEach((element) => collect(relPath, name, element, items));
    return;
  }
  if (isItem(value)) {
    items.add(value);
    return;
  }
  if (isNamespaceHandle(value)) {
    throw new Error(
      `The discovered module ${relPath} exports "${name}", the namespace handle for events in ` +
        `"${value.namespace}". Export the events it defined, not the namespace handle: the handle ` +
        "records nothing, and the events its definers returned are what land in the file."
    );
  }
  throw new Error(
    `The discovered module ${relPath} exports "${name}", which is not something a definer ` +
      `returned. In a discovered module export is registration, so every export must be an item — ` +
      `or an array of items — from ${DEFINER_LIST}.`
  );
}

function isItem(value: unknown): value is ModItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemKind" in value &&
    typeof value.itemKind === "string" &&
    ITEM_KINDS.has(value.itemKind)
  );
}

function isNamespaceHandle(value: unknown): value is { readonly namespace: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "event-namespace"
  );
}
