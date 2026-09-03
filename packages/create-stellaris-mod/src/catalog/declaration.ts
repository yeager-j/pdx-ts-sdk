/**
 * The feature list, as rules.
 *
 * A project declares its Features in `src/features.ts`, one line per feature
 * module, and `generate` appends one line there for every module it writes.
 * This module owns everything about that line that can be decided without a
 * filesystem: where the list and the modules live, what the line says, when an
 * existing list already says it, and which bytes appending it takes. The
 * impure half is `../feature-list.ts`.
 */

import type { DerivedNames } from "./types.ts";

/** The project-relative path of the feature list. */
export const FEATURE_LIST_PATH = "src/features.ts";

/** Where every generated feature module goes, as path segments. */
export const FEATURE_MODULE_SEGMENTS: readonly string[] = Object.freeze(["src", "features"]);

/** The names a declaration line is built from. */
export type DeclarationNames = Pick<DerivedNames, "identifier" | "basename">;

/**
 * The line that puts one feature module in the mod:
 * `export { feature as <identifier> } from "./features/<basename>";`.
 */
export function featureDeclaration(names: DeclarationNames): string {
  return `export { feature as ${names.identifier} } from "./features/${names.basename}";`;
}

/** An existing line in the feature list that the new declaration would repeat. */
export interface DeclarationConflict {
  /** Whether the line already names the module's path or already exports its binding. */
  readonly kind: "path" | "binding";
  /** One-based, as an editor counts. */
  readonly line: number;
}

/**
 * The first line of the feature list that already declares the module, or
 * already exports the binding, or `undefined` when the declaration is new.
 *
 * Line-based on purpose. The file is the author's, so this reads it the way an
 * author would scan it rather than parsing it: a line whose module specifier is
 * the module's path, or whose `as` clause binds the identifier, is the line
 * that would be duplicated. Comment lines are skipped, since a declaration
 * an author commented out is one they removed.
 */
export function findDeclarationConflict(
  contents: string,
  names: DeclarationNames
): DeclarationConflict | undefined {
  const modulePath = new RegExp(`from\\s*["']\\./features/${escapeRegExp(names.basename)}["']`);
  const binding = new RegExp(`\\bas\\s+${escapeRegExp(names.identifier)}\\b`);

  const lines = contents.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (isCommentLine(line)) {
      continue;
    }
    if (modulePath.test(line)) {
      return { kind: "path", line: index + 1 };
    }
    if (binding.test(line)) {
      return { kind: "binding", line: index + 1 };
    }
  }
  return undefined;
}

/**
 * The bytes that append `line` to a file holding `contents`.
 *
 * The file's own line ending is followed, and a file whose last line has no
 * terminator gets one first, so the new line never lands on the end of an
 * existing one. An empty file takes the line alone.
 */
export function appendedBytes(contents: string, line: string): string {
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  const separator = contents === "" || contents.endsWith("\n") ? "" : eol;
  return `${separator}${line}${eol}`;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
