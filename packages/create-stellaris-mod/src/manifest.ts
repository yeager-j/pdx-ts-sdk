/**
 * `stellaris-mod.json` — the Project Manifest, read.
 *
 * The manifest is the author-owned source of truth for mod identity, launcher
 * metadata, and where feature source goes. `init` writes it; later commands
 * read it and never repair or migrate it.
 *
 * The validation is hand-rolled rather than a schema validator at runtime, for
 * the reason `derive.ts` restates the SDK's prefix pattern: this package has no
 * runtime dependency on the SDK and wants none on a validator either. The
 * emitted `stellaris-mod.schema.json` is the editor's copy of the same rules,
 * and `manifest.test.ts` runs one corpus through both to keep them honest.
 *
 * Every message names the file and the exact fault, because a manifest is
 * something an author edits by hand and "invalid manifest" is not a repair
 * instruction.
 */

/** The SDK's rule, restated only so this module needs no runtime dependency. */
const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

const TOP_LEVEL_KEYS = ["$schema", "mod", "contentDirectory"] as const;

/**
 * The SDK's `ModConfig` minus `prefix`, restated structurally. `manifest.test.ts`
 * asserts assignability in both directions against the real type, so a change
 * to the SDK's config breaks a test here rather than a stranger's project.
 */
export interface ProjectModConfig {
  name: string;
  version?: string;
  supportedVersion: string;
  tags?: string[];
  acceptGameVersion?: string;
  uncheckedVanillaIds?: boolean;
}

const MOD_FIELDS = {
  name: "string",
  version: "string",
  supportedVersion: "string",
  tags: "string[]",
  acceptGameVersion: "string",
  uncheckedVanillaIds: "boolean",
} as const satisfies Record<keyof ProjectModConfig, string>;

const REQUIRED_MOD_FIELDS = ["name", "supportedVersion"] as const;

export interface ProjectManifest {
  /** The sole key under `mod`, which is the mod prefix. */
  readonly prefix: string;
  readonly config: ProjectModConfig;
  /** A project-relative logical path. Validated as a path when it is used. */
  readonly contentDirectory: string;
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
  for (const required of ["mod", "contentDirectory"] as const) {
    if (!Object.hasOwn(root, required)) {
      throw new ManifestError(`${sourcePath} has no "${required}" key, which is required.`);
    }
  }

  return {
    ...readMod(root["mod"], sourcePath),
    contentDirectory: readContentDirectory(root["contentDirectory"], sourcePath),
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

  const unknownKeys = Object.keys(value).filter((key) => !Object.hasOwn(MOD_FIELDS, key));
  if (unknownKeys.length > 0) {
    throw new ManifestError(
      `${at} has ${unknownKeys.length === 1 ? "an unknown field" : "unknown fields"} ` +
        `${quoteList(unknownKeys)}. It carries the mod configuration other than the prefix: ` +
        `${quoteList(Object.keys(MOD_FIELDS))}.`
    );
  }
  for (const required of REQUIRED_MOD_FIELDS) {
    if (!Object.hasOwn(value, required)) {
      throw new ManifestError(`${at} has no "${required}" field, which is required.`);
    }
  }

  for (const [field, kind] of Object.entries(MOD_FIELDS)) {
    if (!Object.hasOwn(value, field)) {
      continue;
    }
    const actual = value[field];
    if (kind === "string[]") {
      if (!Array.isArray(actual) || actual.some((item) => typeof item !== "string")) {
        throw new ManifestError(
          `${at}.${field} must be an array of strings, and is ${describe(actual)}.`
        );
      }
    } else if (typeof actual !== kind) {
      throw new ManifestError(`${at}.${field} must be a ${kind}, and is ${describe(actual)}.`);
    }
  }

  const config = value as ProjectModConfig & Record<string, unknown>;
  return {
    name: config.name,
    ...(config.version === undefined ? {} : { version: config.version }),
    supportedVersion: config.supportedVersion,
    ...(config.tags === undefined ? {} : { tags: [...config.tags] }),
    ...(config.acceptGameVersion === undefined
      ? {}
      : { acceptGameVersion: config.acceptGameVersion }),
    ...(config.uncheckedVanillaIds === undefined
      ? {}
      : { uncheckedVanillaIds: config.uncheckedVanillaIds }),
  };
}

function readContentDirectory(value: unknown, sourcePath: string): string {
  if (typeof value !== "string") {
    throw new ManifestError(
      `${sourcePath}: "contentDirectory" must be a string, and is ${describe(value)}.`
    );
  }
  if (value === "") {
    throw new ManifestError(
      `${sourcePath}: "contentDirectory" is empty. It is the project-relative directory ` +
        `generated feature source is written into, such as "src/content".`
    );
  }
  return value;
}
