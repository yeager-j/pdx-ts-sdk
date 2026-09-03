/**
 * The Project Layout rules projected into the standalone scaffolder release.
 *
 * The SDK owns the runtime rule used by generated projects. This package keeps
 * a dependency-free projection because the CLI and SDK have independent
 * release ranges; `manifest.test.ts` gates every descriptor against the SDK
 * authority so this copy cannot drift silently.
 */

const WINDOWS_DEVICE_NAME = String.raw`(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])`;
const PORTABLE_COMPONENT =
  String.raw`(?!\.{1,2}(?:/|$))(?!${WINDOWS_DEVICE_NAME}(?:\.|/|$))(?! )` +
  String.raw`(?=[^/]{1,255}(?:/|$))[^<>:"#?%/\\|*\u0000-\u001f\u007f]*` +
  String.raw`[^ .<>:"#?%/\\|*\u0000-\u001f\u007f]`;

const PROJECT_DIRECTORY_PATTERN = new RegExp(
  String.raw`^${PORTABLE_COMPONENT}(?:/${PORTABLE_COMPONENT})*$`
);

type ProjectLayoutFieldDescriptor = {
  readonly required: boolean;
  readonly description: string;
  readonly pattern: RegExp;
  readonly patternError: (value: string) => string;
};

/** The SDK Project Layout descriptors projected into manifest parsing and schema generation. */
export const PROJECT_LAYOUT_FIELDS = {
  contentDirectory: {
    required: false,
    description: "Normalized directory below src where Feature source is written.",
    pattern: new RegExp(String.raw`^src(?:/${PORTABLE_COMPONENT})+$`),
    patternError: (value) =>
      `contentDirectory ${JSON.stringify(value)} must be a normalized project-relative path below ` +
      `src whose components are portable across filesystems.`,
  },
  assetsDirectory: {
    required: false,
    description: "Normalized project-relative directory mirrored into the mod root on each build.",
    pattern: PROJECT_DIRECTORY_PATTERN,
    patternError: (value) =>
      `assetsDirectory ${JSON.stringify(value)} must be a normalized project-relative path whose ` +
      `components are portable across filesystems.`,
  },
} as const satisfies Record<string, ProjectLayoutFieldDescriptor>;

/** A field governed by the projected Project Layout rules. */
export type ProjectLayoutFieldName = keyof typeof PROJECT_LAYOUT_FIELDS;

/** Returns the JSON Schema fragment for one projected Project Layout field. */
export function projectLayoutFieldSchema(
  field: ProjectLayoutFieldDescriptor
): Record<string, unknown> {
  return {
    description: field.description,
    type: "string",
    pattern: field.pattern.source,
  };
}

/** Validated Project Manifest directories and their portable path segments. */
export interface ProjectLayout {
  /** Normalized project-relative directory below `src` containing Feature modules, when present. */
  readonly contentDirectory?: string;
  /** Portable path segments parsed from `contentDirectory`, when present. */
  readonly contentSegments?: readonly string[];
  /** Normalized project-relative directory mirrored into the built mod. */
  readonly assetsDirectory?: string;
  /** Portable path segments parsed from `assetsDirectory`, when present. */
  readonly assetsSegments?: readonly string[];
}

/** Reports a Project Manifest directory that violates the projected SDK rule. */
export class ProjectLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectLayoutError";
  }
}

/** Parses one projected Project Layout field into portable path segments. */
export function parseProjectLayoutField(
  fieldName: ProjectLayoutFieldName,
  raw: string
): readonly string[] {
  const field = PROJECT_LAYOUT_FIELDS[fieldName];
  if (!field.pattern.test(raw)) {
    throw new ProjectLayoutError(
      `${field.patternError(raw)} It cannot contain dot segments, empty segments, reserved Windows ` +
        `names or characters, leading or trailing spaces, trailing periods, controls, "#", "?", ` +
        `or "%".`
    );
  }
  return Object.freeze(raw.split("/"));
}

/** Validates and parses all source directories in one Project Manifest. */
export function parseProjectLayout(input: {
  readonly contentDirectory?: string;
  readonly assetsDirectory?: string;
}): ProjectLayout {
  const content =
    input.contentDirectory === undefined
      ? {}
      : {
          contentDirectory: input.contentDirectory,
          contentSegments: parseProjectLayoutField("contentDirectory", input.contentDirectory),
        };
  const assets =
    input.assetsDirectory === undefined
      ? {}
      : {
          assetsDirectory: input.assetsDirectory,
          assetsSegments: parseProjectLayoutField("assetsDirectory", input.assetsDirectory),
        };
  return Object.freeze({ ...content, ...assets });
}
