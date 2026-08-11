/** One normalized interpretation of where a project's authored Features live. */

const WINDOWS_DEVICE_NAME = String.raw`(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])`;
const PORTABLE_COMPONENT =
  String.raw`(?!\.{1,2}(?:/|$))(?!${WINDOWS_DEVICE_NAME}(?:\.|/|$))(?! )` +
  String.raw`(?=[^/]{1,255}(?:/|$))[^<>:"#?%/\\|*\u0000-\u001f\u007f]*` +
  String.raw`[^ .<>:"#?%/\\|*\u0000-\u001f\u007f]`;

export const PROJECT_CONTENT_DIRECTORY_PATTERN = new RegExp(
  String.raw`^src(?:/${PORTABLE_COMPONENT})+$`
);

export interface ProjectLayout {
  readonly contentDirectory: string;
  readonly contentSegments: readonly string[];
}

export class ContentDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentDirectoryError";
  }
}

export function parseProjectLayout(raw: string): ProjectLayout {
  if (!PROJECT_CONTENT_DIRECTORY_PATTERN.test(raw)) {
    throw new ContentDirectoryError(
      `contentDirectory ${JSON.stringify(raw)} must be a normalized project-relative path below ` +
        `src whose components are portable across filesystems. It cannot contain dot segments, ` +
        `empty segments, reserved Windows names or characters, leading or trailing spaces, ` +
        `trailing periods, controls, "#", "?", or "%".`
    );
  }
  return Object.freeze({
    contentDirectory: raw,
    contentSegments: Object.freeze(raw.split("/")),
  });
}
