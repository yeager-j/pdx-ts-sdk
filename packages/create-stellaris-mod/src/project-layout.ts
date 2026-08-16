/** One normalized interpretation of the directories a Project Manifest names. */

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

/** The authority projected into manifest parsing, JSON Schema, and generated wiring. */
export const PROJECT_LAYOUT_FIELDS = {
  contentDirectory: {
    required: true,
    description: "Normalized directory below src where generated feature source is written.",
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

export type ProjectLayoutFieldName = keyof typeof PROJECT_LAYOUT_FIELDS;

export function projectLayoutFieldSchema(
  field: ProjectLayoutFieldDescriptor
): Record<string, unknown> {
  return {
    description: field.description,
    type: "string",
    pattern: field.pattern.source,
  };
}

export interface ProjectLayout {
  readonly contentDirectory: string;
  readonly contentSegments: readonly string[];
  readonly assetsDirectory?: string;
  readonly assetsSegments?: readonly string[];
}

export class ProjectLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectLayoutError";
  }
}

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

export function parseProjectLayout(input: {
  readonly contentDirectory: string;
  readonly assetsDirectory?: string;
}): ProjectLayout {
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
