/** One normalized interpretation of where a project's authored Features live. */

export const PROJECT_CONTENT_DIRECTORY_PATTERN = /^src(?:\/(?!\.{1,2}(?:\/|$))[^\/#?%\\\u0000]+)+$/;

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
        `src. It cannot contain dot segments, empty segments, backslashes, NUL, "#", "?", or "%".`
    );
  }
  return Object.freeze({
    contentDirectory: raw,
    contentSegments: Object.freeze(raw.split("/")),
  });
}
