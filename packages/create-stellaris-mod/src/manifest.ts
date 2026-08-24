/**
 * `stellaris-mod.json` — the Project Manifest, read.
 *
 * The manifest is the author-owned source of truth for mod identity, launcher
 * metadata, and where Feature and Asset source goes. `init` writes it; later
 * commands read it and never repair or migrate it.
 *
 * The validation is hand-rolled rather than delegated to a schema validator at
 * runtime because this package has no runtime SDK dependency and wants none on
 * a validator either. Project Layout is a release-local projection of the SDK
 * rule used by generated builds; `manifest.test.ts` gates the two descriptors
 * against each other. The emitted schema is the editor's copy of those rules.
 *
 * Every message names the file and the exact fault, because a manifest is
 * something an author edits by hand and "invalid manifest" is not a repair
 * instruction.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModConfig } from "@pdx-ts/sdk";

import { SUPPORTED_VERSION_PATTERN } from "./generated/verified-build.ts";
import { parseProjectLayout, PROJECT_LAYOUT_FIELDS, type ProjectLayout } from "./project-layout.ts";

/** The one filename a project's manifest can have. */
export const MANIFEST_BASENAME = "stellaris-mod.json";

/** The SDK's rule, restated only so this module needs no runtime dependency. */
export const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The launcher's `supported_version` grammar — one to three dot-separated parts,
 * each a number or `*`. Generated from the repository's verified-build
 * projection, and enforced here rather than left to the project's own build:
 * a manifest the SDK will refuse is one no later command should accept.
 *
 * `manifest.test.ts` runs a sample table through this and through the SDK's real
 * `resolveConfig`, so a change to the SDK's grammar breaks a test here rather
 * than a stranger's project.
 */
export { SUPPORTED_VERSION_PATTERN } from "./generated/verified-build.ts";

const TOP_LEVEL_KEYS = ["$schema", "mod", ...Object.keys(PROJECT_LAYOUT_FIELDS)] as const;

/**
 * The one declarative description of the configuration under a manifest's
 * prefix. It projects into the parsed TypeScript shape, the runtime validator,
 * and the schema an editor reads; none of those consumers gets to maintain an
 * independent field list.
 */
type ProjectModFieldKind = "string" | "string[]" | "boolean";

type ProjectModFieldDescriptor<Kind extends ProjectModFieldKind> = {
  readonly kind: Kind;
  readonly required: boolean;
  readonly description?: string;
} & (Kind extends "string"
  ? {
      readonly pattern?: RegExp;
      readonly patternError?: (at: string, value: string) => string;
    }
  : { readonly pattern?: never; readonly patternError?: never });

type AnyProjectModFieldDescriptor = {
  [Kind in ProjectModFieldKind]: ProjectModFieldDescriptor<Kind>;
}[ProjectModFieldKind];

export const PROJECT_MOD_FIELDS = {
  name: {
    kind: "string",
    required: true,
    description: "Display name shown in the launcher.",
  },
  version: { kind: "string", required: false },
  supportedVersion: {
    kind: "string",
    required: true,
    description:
      'Launcher version pattern, e.g. "v4.4.*": one to three dot-separated parts, ' +
      'each a number or "*".',
    pattern: SUPPORTED_VERSION_PATTERN,
    patternError: (at, value) =>
      `${at}.supportedVersion ${JSON.stringify(value)} is not a launcher version pattern ` +
      `(e.g. "v4.4.*", "v4.*", "v4.4.6"): one to three dot-separated parts, each a ` +
      `number or "*". It is written verbatim into descriptor.mod, and the launcher answers an ` +
      `unreadable one by silently refusing the mod.`,
  },
  tags: {
    kind: "string[]",
    required: false,
    description: "Launcher tags.",
  },
  acceptGameVersion: {
    kind: "string",
    required: false,
    description: "Acknowledges a game build the SDK's rule table is not verified against.",
  },
} as const satisfies Record<string, AnyProjectModFieldDescriptor>;

type ProjectModField = AnyProjectModFieldDescriptor;
type FieldValue<Field extends ProjectModField> = Field["kind"] extends "string[]"
  ? string[]
  : Field["kind"] extends "boolean"
    ? boolean
    : string;

export type ProjectModConfig = {
  [
    Key in keyof typeof PROJECT_MOD_FIELDS as (typeof PROJECT_MOD_FIELDS)[Key]["required"] extends true
      ? Key
      : never
  ]: FieldValue<(typeof PROJECT_MOD_FIELDS)[Key]>;
} & {
  [
    Key in keyof typeof PROJECT_MOD_FIELDS as (typeof PROJECT_MOD_FIELDS)[Key]["required"] extends true
      ? never
      : Key
  ]?: FieldValue<(typeof PROJECT_MOD_FIELDS)[Key]>;
};

/**
 * The adapter's one-way compatibility claim. `Pick` requires every Project
 * Manifest key to be an SDK key and preserves the SDK's value type for it;
 * adding a manifest-only field or widening a value therefore fails here.
 */
type SdkProjectModConfig = Pick<ModConfig, keyof ProjectModConfig>;

/** The JSON-schema view of one canonical Project Manifest field. */
export function projectModFieldSchema(field: ProjectModField): Record<string, unknown> {
  const description = field.description === undefined ? {} : { description: field.description };
  switch (field.kind) {
    case "string":
      return {
        ...description,
        type: "string",
        ...(field.pattern === undefined ? {} : { pattern: field.pattern.source }),
      };
    case "string[]":
      return { ...description, type: "array", items: { type: "string" } };
    case "boolean":
      return { ...description, type: "boolean" };
  }
}

export interface ProjectManifest {
  /** The sole key under `mod`, which is the mod prefix. */
  readonly prefix: string;
  readonly config: ProjectModConfig;
  /** A project-relative logical path. Validated as a path when it is used. */
  readonly contentDirectory: string;
  /** A project-relative directory mirrored into the mod root, when configured. */
  readonly assetsDirectory?: string;
  readonly layout: ProjectLayout;
  /** Where these bytes came from, for messages a later step needs to write. */
  readonly sourcePath: string;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a value *is*, phrased for someone reading an error about their JSON. */
function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return `a ${typeof value}`;
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

export function parseManifest(bytes: string, sourcePath: string): ProjectManifest {
  let root: unknown;
  try {
    root = JSON.parse(bytes);
  } catch (error) {
    throw new ManifestError(
      `${sourcePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isPlainObject(root)) {
    throw new ManifestError(`${sourcePath} must be a JSON object, and is ${describe(root)}.`);
  }

  const unknownKeys = Object.keys(root).filter(
    (key) => !(TOP_LEVEL_KEYS as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    throw new ManifestError(
      `${sourcePath} has ${unknownKeys.length === 1 ? "an unknown key" : "unknown keys"} ` +
        `${quoteList(unknownKeys)}. A Project Manifest carries only ${quoteList([
          ...TOP_LEVEL_KEYS,
        ])}.`
    );
  }
  const requiredKeys = [
    "mod",
    ...Object.entries(PROJECT_LAYOUT_FIELDS)
      .filter(([, field]) => field.required)
      .map(([name]) => name),
  ];
  for (const required of requiredKeys) {
    if (!Object.hasOwn(root, required)) {
      throw new ManifestError(`${sourcePath} has no "${required}" key, which is required.`);
    }
  }

  const layout = readProjectLayoutFields(root, sourcePath);
  return {
    ...readMod(root["mod"], sourcePath),
    contentDirectory: layout.contentDirectory,
    ...(layout.assetsDirectory === undefined ? {} : { assetsDirectory: layout.assetsDirectory }),
    layout,
    sourcePath,
  };
}

function readMod(mod: unknown, sourcePath: string): { prefix: string; config: ProjectModConfig } {
  if (!isPlainObject(mod)) {
    throw new ManifestError(`${sourcePath}: "mod" must be a JSON object, and is ${describe(mod)}.`);
  }

  const prefixes = Object.keys(mod);
  if (prefixes.length !== 1) {
    throw new ManifestError(
      `${sourcePath}: "mod" must hold exactly one entry, and holds ${prefixes.length}` +
        `${prefixes.length === 0 ? "" : ` (${quoteList(prefixes)})`}. Its key is the mod ` +
        `prefix, which is what lets \`keyof typeof manifest.mod\` recover it.`
    );
  }

  const prefix = prefixes[0]!;
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new ManifestError(
      `${sourcePath}: mod prefix ${JSON.stringify(prefix)} must be lowercase snake_case ` +
        `([a-z][a-z0-9_]*). Every id and filename the mod emits starts with it.`
    );
  }

  return { prefix, config: readModConfig(mod[prefix], prefix, sourcePath) };
}

function readModConfig(value: unknown, prefix: string, sourcePath: string): ProjectModConfig {
  const at = `${sourcePath}: mod.${prefix}`;
  if (!isPlainObject(value)) {
    throw new ManifestError(`${at} must be a JSON object, and is ${describe(value)}.`);
  }

  const unknownKeys = Object.keys(value).filter((key) => !Object.hasOwn(PROJECT_MOD_FIELDS, key));
  if (unknownKeys.length > 0) {
    throw new ManifestError(
      `${at} has ${unknownKeys.length === 1 ? "an unknown field" : "unknown fields"} ` +
        `${quoteList(unknownKeys)}. It carries the mod configuration other than the prefix: ` +
        `${quoteList(Object.keys(PROJECT_MOD_FIELDS))}.`
    );
  }

  const config: Record<string, unknown> = {};
  for (const [field, descriptor] of Object.entries(PROJECT_MOD_FIELDS) as [
    string,
    ProjectModField,
  ][]) {
    const present = Object.hasOwn(value, field);
    if (descriptor.required && !present) {
      throw new ManifestError(`${at} has no "${field}" field, which is required.`);
    }
    if (!present) {
      continue;
    }
    const actual = value[field];
    if (descriptor.kind === "string[]") {
      if (!Array.isArray(actual) || actual.some((item) => typeof item !== "string")) {
        throw new ManifestError(
          `${at}.${field} must be an array of strings, and is ${describe(actual)}.`
        );
      }
      config[field] = [...actual];
      continue;
    }
    if (descriptor.kind === "string") {
      if (typeof actual !== "string") {
        throw new ManifestError(`${at}.${field} must be a string, and is ${describe(actual)}.`);
      }
      if (descriptor.pattern !== undefined && !descriptor.pattern.test(actual)) {
        throw new ManifestError(
          descriptor.patternError?.(at, actual) ??
            `${at}.${field} ${JSON.stringify(actual)} does not match its required pattern.`
        );
      }
      config[field] = actual;
      continue;
    }
    if (typeof actual !== descriptor.kind) {
      throw new ManifestError(
        `${at}.${field} must be a ${descriptor.kind}, and is ${describe(actual)}.`
      );
    }
    config[field] = actual;
  }
  return config as ProjectModConfig;
}

/**
 * The one-way bridge from a parsed Project Manifest to the SDK's authoring
 * config. This is type-only: the scaffolder still has no runtime SDK dependency
 * and deliberately does not claim that every SDK config can be represented by
 * a Project Manifest.
 */
export function toSdkModConfig(manifest: Pick<ProjectManifest, "prefix" | "config">): ModConfig {
  const config: SdkProjectModConfig = manifest.config;
  return { ...config, prefix: manifest.prefix };
}

export interface FoundManifest {
  /** The directory the manifest sits in, which is the project root. */
  readonly rootDir: string;
  readonly manifest: ProjectManifest;
}

/**
 * The nearest Project Manifest at or above `startDir`, or `undefined` when
 * there is none anywhere up to the filesystem root.
 *
 * Searching upward is what lets `generate` be run from inside `src/content/`
 * rather than only from a project root, the way `git` and every package manager
 * behave.
 *
 * A manifest that exists but does not parse stops the search rather than
 * continuing past it. The alternative silently generates into a *different*
 * project than the one the author is standing in — and it would do that
 * precisely when their own manifest has a typo in it, which is the worst
 * possible moment to become quietly helpful.
 */
export async function findManifest(startDir: string): Promise<FoundManifest | undefined> {
  let dir = path.resolve(startDir);
  for (;;) {
    const sourcePath = path.join(dir, MANIFEST_BASENAME);
    let bytes: string | undefined;
    try {
      bytes = await readFile(sourcePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new ManifestError(
          `${sourcePath} exists but could not be read (${code ?? "unknown error"}).`
        );
      }
    }
    if (bytes !== undefined) {
      return { rootDir: dir, manifest: parseManifest(bytes, sourcePath) };
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function readProjectLayoutFields(root: Record<string, unknown>, sourcePath: string): ProjectLayout {
  const values: Partial<Record<keyof typeof PROJECT_LAYOUT_FIELDS, string>> = {};
  for (const field of Object.keys(PROJECT_LAYOUT_FIELDS) as Array<
    keyof typeof PROJECT_LAYOUT_FIELDS
  >) {
    if (!Object.hasOwn(root, field)) {
      continue;
    }
    const value = root[field];
    if (typeof value !== "string") {
      throw new ManifestError(
        `${sourcePath}: ${JSON.stringify(field)} must be a string, and is ${describe(value)}.`
      );
    }
    values[field] = value;
  }
  try {
    return parseProjectLayout(values as { contentDirectory: string; assetsDirectory?: string });
  } catch (error) {
    throw new ManifestError(
      `${sourcePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
