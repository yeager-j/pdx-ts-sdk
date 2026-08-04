/**
 * `discoverContent(dir)`: the filesystem half of the authoring API (SDK-23).
 *
 * The SDK is a compiler, so source layout and output layout are decoupled: the
 * game demands one file per registry, but nothing demands that an author
 * organize *source* that way. `discoverContent` walks a directory of ordinary
 * modules, imports each one, and turns its exports into a `collection` named
 * after the file. Export is registration — a definer's return value that is
 * exported lands in the mod, and one that is not, does not.
 *
 * Like `write`, this is impure shell around the pure core: it reads a
 * directory and executes modules, then hands `buildMod` the same `Collection[]`
 * a hand-written pack would. Everything the fold does with them — canonical
 * emission order, duplicate ids, the one-namespace-per-file bijection — is
 * unchanged, which is why discovery needs no cooperation from `buildMod`.
 *
 * What the walk does:
 * - Recurses the directory; files matching the content pattern are modules,
 *   everything else (assets, `.md` notes, `.json` data the modules read, and
 *   by default a module's colocated tests) is ignored before it is imported.
 * - Imports in logical-path order, so a build is a pure function of the tree
 *   and not of `readdir`'s arbitrary directory order.
 * - Names each collection with the module's basename up to its first `.`, so
 *   `content/economy/technology.ts` and `content/military/technology.ts` both
 *   emit into `<prefix>_technology.txt` — grouping by feature in source,
 *   grouping by registry in output.
 *
 * Which files count is the author's to decide (`options.include`). The default
 * takes `.ts` and leaves out a module's companions — its tests, its benchmarks,
 * its ambient declarations. That default is safe by construction: every
 * companion suffix puts a `.` inside the basename, and a stem containing `.`
 * is already illegal, so nothing the default skips could ever have named an
 * emitted file. A custom pattern has no such guarantee, which is why a pattern
 * matching nothing is an error rather than an empty mod.
 *
 * Order caveat: emission order is a pure function of content (SDK-23), so
 * neither export order nor file order can change the emitted bytes — and
 * neither can the pattern, which is a predicate applied before the sort, and a
 * subsequence of an ordered sequence keeps its order. The invariant is: same
 * directory plus same pattern, same bytes. The one order that is author data is
 * a hook's event list, and that order is written inside a single
 * `on(hook, [first, second, third])` call — never by which module or which
 * export a binding happens to come from.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collection, FILE_STEM_PATTERN, type Collection, type ModItem } from "./items.ts";
import type { CapabilityFeature } from "./mod-capability.ts";
import { compareLogicalPaths, normalizeLogicalPath } from "./resolver/path-order.ts";

const ITEM_KINDS = new Set<string>(["content", "event", "on-action", "patch", "contribution"]);

const DEFINER_LIST =
  "defineTechnology, namespace(...).defineCountryEvent, on, patchTechnology, addShipOfSizeLimits, ...";

/**
 * The default set of content modules: `.ts`, minus the companion files a
 * module keeps beside itself. Every excluded suffix carries a `.` inside the
 * basename, which `FILE_STEM_PATTERN` already forbids — so this can only ever
 * skip a file that would have thrown, never one that was working.
 */
export const DEFAULT_CONTENT_PATTERN = /(?<!\.(?:test|test-d|spec|bench|d))\.ts$/;

export interface DiscoverOptions {
  /**
   * Which files under `dir` are content modules, matched against each file's
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

/**
 * The emitted file's stem: the basename up to its first `.`, so a module
 * discovered as `resonance.mod.ts` still emits `<prefix>_resonance.txt`. Any
 * name this truncates was previously rejected outright, since a stem may not
 * contain `.`.
 */
function fileStemOf(absolute: string): string {
  const basename = path.basename(absolute);
  const dot = basename.indexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
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

export async function discoverContent(
  dir: string | URL,
  options: DiscoverOptions = {}
): Promise<Collection[]> {
  const { root, include, candidates, modules } = await discoverModules(dir, options);

  if (modules.length === 0) {
    throw new Error(emptyWalkMessage(root, include, candidates));
  }

  // Stems are the same grammar `collection` enforces, but checking every one
  // here — before any module is imported — fails a bad basename immediately
  // and names every offender at once, rather than one at a time interleaved
  // with each module's (possibly side-effecting) import.
  const stemmed = modules.map((module) => ({ ...module, stem: fileStemOf(module.absolute) }));
  assertModuleStems(stemmed);

  const collections: Collection[] = [];
  for (const module of stemmed) {
    const exports = (await import(pathToFileURL(module.absolute).href)) as Record<string, unknown>;
    collections.push(collectModule(module.relative, module.stem, exports));
  }
  return collections;
}

/**
 * Discovers capability-owned features from `dir`.
 *
 * Each selected module must export its already-placed feature as the named
 * `feature` export. Its siblings, including a default export, are ordinary
 * module API and are ignored. A feature authors its own file stem through
 * `mod.feature(...)`, so moving or renaming its source module does not change
 * output identity. `include` has the same relative-path, pre-import semantics
 * as {@link discoverContent}; the default skips colocated companion files.
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
    if (!isCollection(exports.feature)) {
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
 * A module's stem comes from its filename on disk, discovered at build time —
 * there is no static type a compiler could check it against, so this is
 * necessarily a runtime gate. What it can control is when and how loudly it
 * fails: every offending file, named up front, before the walk imports
 * anything.
 */
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
      `\nRename the file, or narrow \`include\` to exclude it, before any discovered module is imported.`
  );
}

/**
 * A pattern that matches nothing would otherwise build a mod with no content
 * at all, which is a typo rendering as a successful build. The two ways to get
 * here read differently and are reported differently: a directory holding
 * TypeScript the pattern rejected is a pattern problem, and one holding none is
 * a path problem.
 */
function emptyWalkMessage(
  root: string,
  include: RegExp,
  candidates: readonly { readonly relative: string }[]
): string {
  const excluded = candidates
    .filter((entry) => entry.relative.endsWith(".ts"))
    .map((entry) => entry.relative)
    .sort();
  if (excluded.length === 0) {
    return (
      `No content modules under ${root}: it holds no TypeScript at all. Check the directory ` +
      `path — discovery imports modules, so an empty tree can only produce an empty mod.`
    );
  }
  return (
    `No content modules under ${root}: ${include} matched none of the ${excluded.length} ` +
    `TypeScript files there. Excluded:\n` +
    excluded.map((relPath) => `  - ${relPath}`).join("\n") +
    `\nThe default (${DEFAULT_CONTENT_PATTERN}) takes .ts and leaves out colocated tests.`
  );
}

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

/**
 * One module's exports as a collection. Arrays flatten (a loop that builds
 * fifty variants exports one array), and the same item exported twice — as
 * itself and inside a list — is collected once. Deduplication is by identity
 * and stops at the module, because the same item reachable from two *modules*
 * is a re-export, which is two placements of one definition and stays the
 * duplicate-id error `buildMod` already raises.
 */
function collectModule(
  relPath: string,
  stem: string,
  exports: Record<string, unknown>
): Collection {
  const items = new Set<ModItem>();
  for (const [name, value] of Object.entries(exports)) {
    collect(relPath, name, value, items);
  }
  if (items.size === 0) {
    throw new Error(
      `The discovered module ${relPath} exports nothing the SDK recognizes, so it would emit an ` +
        `empty file. Export what its definers (${DEFINER_LIST}) returned, or move the module out ` +
        `of the discovered directory.`
    );
  }
  try {
    return collection(stem, [...items]);
  } catch (error) {
    throw new Error(
      `The discovered module ${relPath} names the file it emits, so its basename is the file ` +
        `stem: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function isCollection(value: unknown): value is Collection {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemKind" in value &&
    value.itemKind === "collection"
  );
}

function collect(relPath: string, name: string, value: unknown, items: Set<ModItem>): void {
  if (Array.isArray(value)) {
    for (const element of value) {
      collect(relPath, name, element, items);
    }
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
        `records nothing, and the events its definers returned are what land in the file.`
    );
  }
  throw new Error(
    `The discovered module ${relPath} exports "${name}", which is not something a definer ` +
      `returned. In a discovered module export is registration, so every export must be an item — ` +
      `or an array of items — from ${DEFINER_LIST}. Values a module only uses (flags, shared ` +
      `triggers, constants) belong in a module outside the discovered directory: importing a ` +
      `value is not exporting it.`
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
