/** One normalized interpretation of the source directories a mod project names. */

import { WINDOWS_DEVICE_NAME_SOURCE } from "./windows-names.ts";

// Spliced in rather than compiled, because it sits inside a lookahead in a
// larger pattern that is also emitted as a JSON Schema. `windows-names.ts`
// owns which names these are.
const WINDOWS_DEVICE_NAME = WINDOWS_DEVICE_NAME_SOURCE;
const PORTABLE_COMPONENT =
  String.raw`(?!\.{1,2}(?:/|$))(?!${WINDOWS_DEVICE_NAME}(?:\.|/|$))(?! )` +
  String.raw`(?=[^/]{1,255}(?:/|$))[^<>:"#?%/\\|*\u0000-\u001f\u007f]*` +
  String.raw`[^ .<>:"#?%/\\|*\u0000-\u001f\u007f]`;

const PROJECT_DIRECTORY_PATTERN = new RegExp(
  String.raw`^${PORTABLE_COMPONENT}(?:/${PORTABLE_COMPONENT})*$`
);

/** One project-layout field and the rule used to parse it. */
export interface ProjectLayoutFieldDescriptor {
  /** Whether the Project Manifest requires this field. */
  readonly required: boolean;
  /** Human-readable field description used by generated schemas. */
  readonly description: string;
  /** ECMA-262 pattern accepted by runtime parsing and generated schemas. */
  readonly pattern: RegExp;
  /** Describes a value that does not match the field pattern. */
  readonly patternError: (value: string) => string;
}

/** The project-layout authority used by parsing and JSON Schema generation. */
export const PROJECT_LAYOUT_FIELDS = {
  contentDirectory: {
    required: true,
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

/** A field governed by the project-layout rules. */
export type ProjectLayoutFieldName = keyof typeof PROJECT_LAYOUT_FIELDS;

/** Returns the JSON Schema fragment for one project-layout field. */
export function projectLayoutFieldSchema(
  field: ProjectLayoutFieldDescriptor
): Record<string, unknown> {
  return {
    description: field.description,
    type: "string",
    pattern: field.pattern.source,
  };
}

/** The source directories accepted by {@link parseProjectLayout}. */
export interface ProjectLayoutInput {
  /** Normalized project-relative directory below `src` containing Feature modules. */
  readonly contentDirectory: string;
  /** Normalized project-relative directory mirrored into the built mod. */
  readonly assetsDirectory?: string;
}

/** Validated project-relative directories and their portable path segments. */
export interface ProjectLayout extends ProjectLayoutInput {
  /** Portable path segments parsed from `contentDirectory`. */
  readonly contentSegments: readonly string[];
  /** Portable path segments parsed from `assetsDirectory`, when present. */
  readonly assetsSegments?: readonly string[];
}

/** Reports a project directory that is unsafe or outside its required location. */
export class ProjectLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectLayoutError";
  }
}

/** Parses one project-layout field into portable path segments. */
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

/** Validates and parses all source directories for one mod project. */
export function parseProjectLayout(input: ProjectLayoutInput): ProjectLayout {
  const contentSegments = parseProjectLayoutField("contentDirectory", input.contentDirectory);
  if (input.assetsDirectory === undefined) {
    return Object.freeze({
      contentDirectory: input.contentDirectory,
      contentSegments,
    });
  }
  const assetsSegments = parseProjectLayoutField("assetsDirectory", input.assetsDirectory);
  return Object.freeze({
    contentDirectory: input.contentDirectory,
    contentSegments,
    assetsDirectory: input.assetsDirectory,
    assetsSegments,
  });
}
