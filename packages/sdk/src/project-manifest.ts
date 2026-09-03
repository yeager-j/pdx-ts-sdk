/**
 * The Project Manifest, parsed at the boundary it crosses into the SDK.
 *
 * `createModProject` is handed a `stellaris-mod.json` that a build script
 * imported. TypeScript describes that file — `ModProjectManifest` says `name`
 * is a string — but nothing checked it: a JSON import is typed by assertion,
 * and the annotation is erased before the value arrives. A manifest with
 * `name: 42` produced a project whose resolved `config.name` was still a
 * number, and a non-array `tags` failed later with an incidental `TypeError`
 * rather than with a fault an author could act on (SDK-328).
 *
 * The scaffolder parses the same file when it reads one off disk, and states
 * why the checking is hand-rolled rather than delegated to a validator. This
 * is the other door into the same shape, so the field table lives here and
 * `create-stellaris-mod` gates its release-local copy against it, exactly as
 * the two Project Layout tables are already gated against each other.
 *
 * Every message names the field and what was found, because a manifest is
 * something an author edits by hand and "invalid manifest" is not a repair
 * instruction.
 */

import { describeValue as describe } from "./describe-value.ts";
import { ProjectManifestError } from "./errors.ts";
import { PROJECT_LAYOUT_FIELDS, type ProjectLayoutFieldName } from "./project-layout.ts";

/** The runtime shapes a Project Manifest field can hold. */
export type ProjectModFieldKind = "string" | "string[]";

/** One launcher-configuration field and the shape a manifest must give it. */
export interface ProjectModFieldDescriptor {
  /** The JSON shape the field holds. */
  readonly kind: ProjectModFieldKind;
  /** Whether a manifest must carry this field. */
  readonly required: boolean;
}

/**
 * The launcher configuration stored below a manifest's sole prefix key.
 *
 * This is the parsing authority for that half of the manifest, and the
 * counterpart of {@link PROJECT_LAYOUT_FIELDS} for the other half. Value
 * grammar is deliberately not restated: `resolveConfig` owns the prefix
 * pattern, the `supportedVersion` pattern and the descriptor-safety rules,
 * and runs immediately after this. What is missing before it runs is the
 * primitive type, which is what this table supplies.
 */
export const PROJECT_MOD_FIELDS = {
  name: { kind: "string", required: true },
  version: { kind: "string", required: false },
  supportedVersion: { kind: "string", required: true },
  tags: { kind: "string[]", required: false },
  acceptGameVersion: { kind: "string", required: false },
} as const satisfies Record<string, ProjectModFieldDescriptor>;

/**
 * The refusal for the one key the manifest used to carry and the SDK no
 * longer reads (docs/adr/0008). Unknown keys pass through, so a retired one
 * would be silent: a project that still says where its Features live would
 * build as if it had never said so.
 */
const CONTENT_DIRECTORY_RETIRED =
  '"contentDirectory" is no longer read: features are declared in src/features.ts. ' +
  "Remove the key.";

/** A launcher-configuration field named by {@link PROJECT_MOD_FIELDS}. */
export type ProjectModFieldName = keyof typeof PROJECT_MOD_FIELDS;

/** A Project Manifest that has been read rather than assumed. */
export interface ParsedProjectManifest {
  /** The sole key under `mod`, which is the mod prefix. */
  readonly prefix: string;
  /** The launcher configuration below that key, with every field type checked. */
  readonly config: Readonly<Record<string, string | readonly string[]>>;
  /** The project-layout fields, checked as strings before they are parsed as paths. */
  readonly layout: Readonly<Partial<Record<ProjectLayoutFieldName, string>>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

/**
 * Reads one Project Manifest into a value whose fields are the types the rest
 * of the pipeline assumes.
 *
 * Unknown keys are left alone. This is the SDK's door rather than the
 * scaffolder's, and a project may carry manifest keys a future release reads;
 * a mistyped field is a fault, an unrecognised one is not this function's
 * business. A key a past release read is the exception: it is refused with
 * the fix, so a stale manifest cannot look current.
 *
 * @throws ProjectManifestError naming the field and what was found.
 */
export function parseProjectManifest(manifest: unknown): ParsedProjectManifest {
  if (!isPlainObject(manifest)) {
    throw new ProjectManifestError(
      `A Project Manifest must be a JSON object, and is ${describe(manifest)}.`
    );
  }

  const mod = manifest["mod"];
  if (!isPlainObject(mod)) {
    throw new ProjectManifestError(
      `A Project Manifest's "mod" must be a JSON object, and is ${describe(mod)}.`
    );
  }

  if (Object.hasOwn(manifest, "contentDirectory")) {
    throw new ProjectManifestError(CONTENT_DIRECTORY_RETIRED);
  }

  const prefixes = Object.keys(mod);
  if (prefixes.length !== 1) {
    throw new ProjectManifestError(
      `A Project Manifest must declare exactly one mod, and declares ${prefixes.length}` +
        `${prefixes.length === 0 ? "" : ` (${quoteList(prefixes)})`}. The single key under ` +
        `"mod" is this mod's prefix.`
    );
  }

  const prefix = prefixes[0]!;
  return {
    prefix,
    config: readModConfig(mod[prefix], prefix),
    layout: readLayoutFields(manifest),
  };
}

function readModConfig(
  value: unknown,
  prefix: string
): Readonly<Record<string, string | readonly string[]>> {
  const at = `mod.${prefix}`;
  if (!isPlainObject(value)) {
    throw new ProjectManifestError(`${at} must be a JSON object, and is ${describe(value)}.`);
  }

  const config: Record<string, string | readonly string[]> = {};
  for (const [field, descriptor] of Object.entries(PROJECT_MOD_FIELDS) as readonly (readonly [
    string,
    ProjectModFieldDescriptor,
  ])[]) {
    const present = Object.hasOwn(value, field) && value[field] !== undefined;
    if (!present) {
      if (descriptor.required) {
        throw new ProjectManifestError(`${at} has no "${field}" field, which is required.`);
      }
      continue;
    }
    const actual = value[field];
    if (descriptor.kind === "string[]") {
      if (!Array.isArray(actual) || actual.some((item) => typeof item !== "string")) {
        throw new ProjectManifestError(
          `${at}.${field} must be an array of strings, and is ${describe(actual)}.`
        );
      }
      config[field] = [...(actual as readonly string[])];
      continue;
    }
    if (typeof actual !== "string") {
      throw new ProjectManifestError(
        `${at}.${field} must be a string, and is ${describe(actual)}.`
      );
    }
    config[field] = actual;
  }
  return config;
}

/**
 * Checks each project-layout field is a string before the path rules read it.
 *
 * `parseProjectLayout` matches a pattern, and a pattern coerces: a numeric
 * `assetsDirectory` would be tested as its own digits and refused as a path
 * fault rather than as the type fault it is.
 */
function readLayoutFields(
  manifest: Record<string, unknown>
): Readonly<Partial<Record<ProjectLayoutFieldName, string>>> {
  const values: Partial<Record<ProjectLayoutFieldName, string>> = {};
  for (const field of Object.keys(PROJECT_LAYOUT_FIELDS) as readonly ProjectLayoutFieldName[]) {
    const present = Object.hasOwn(manifest, field) && manifest[field] !== undefined;
    if (!present) {
      if (PROJECT_LAYOUT_FIELDS[field].required) {
        throw new ProjectManifestError(
          `A Project Manifest has no "${field}" key, which is required.`
        );
      }
      continue;
    }
    const value = manifest[field];
    if (typeof value !== "string") {
      throw new ProjectManifestError(
        `${JSON.stringify(field)} must be a string, and is ${describe(value)}.`
      );
    }
    values[field] = value;
  }
  return values;
}
