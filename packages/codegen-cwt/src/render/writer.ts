/** Shared textual renderers for generated interface members and metadata declarations. */

import { docComment, propertyName } from "../naming.ts";
import type { TsValue } from "./emitter.ts";

/** The author-facing shape of one generated TypeScript interface member. */
export interface MemberOptions {
  /** The member name before identifier-safe quoting. */
  readonly name: string;
  /** The TypeScript type text written after the member name. */
  readonly type: string;
  /** Whether the generated member carries an optional marker. */
  readonly optional: boolean;
  /** The prose lines rendered as the member's JSDoc. */
  readonly docs: readonly string[];
  /** The whitespace prefixed to both the JSDoc and declaration. */
  readonly indent?: string;
  /** Whether the generated declaration includes the `readonly` modifier. */
  readonly readonly?: boolean;
}

/**
 * Renders one interface member with optional JSDoc and identifier-safe naming.
 * The configured indent applies to both the documentation and declaration.
 */
export function member(options: MemberOptions): string {
  const indent = options.indent ?? "  ";
  const readonlyPrefix = options.readonly === true ? "readonly " : "";
  const optionalMark = options.optional ? "?" : "";
  return (
    docComment(options.docs, indent) +
    `${indent}${readonlyPrefix}${propertyName(options.name)}${optionalMark}: ${options.type};\n`
  );
}

/**
 * Wraps pre-rendered rows in a documented, exported readonly array declaration.
 * Callers retain control of each row's text and indentation. The doc lines are
 * required because every table this renders is part of the published surface.
 */
export function constArray(
  name: string,
  elementType: string,
  rows: string,
  docs: readonly string[]
): string {
  return docComment(docs) + `export const ${name}: readonly ${elementType}[] = [\n${rows}];\n\n`;
}

/**
 * Whether every form a value admits is a `<type>` reference, as unadorned
 * `refTypes: [...]` metadata text — undefined when it is not, since an
 * id-shaped value alongside a non-reference arm proves nothing about any
 * registry. The one fact {@link refTypesSuffix} and {@link refTypesEntries}
 * format into two different shapes below.
 */
function refTypesEntry(value: TsValue | undefined): string | undefined {
  if (value?.refTypes === undefined) {
    return undefined;
  }
  return `refTypes: ${JSON.stringify(value.refTypes)}`;
}

/**
 * Renders reference metadata for appending to a non-empty object literal.
 * Returns a comma-prefixed property, or an empty string when the value has no reference types.
 */
export function refTypesSuffix(value: TsValue | undefined): string {
  const entry = refTypesEntry(value);
  return entry === undefined ? "" : `, ${entry}`;
}

/**
 * Renders reference metadata as zero or one standalone object-member entries.
 * Use this when composing metadata members as an array rather than an object-literal suffix.
 */
export function refTypesEntries(value: TsValue | undefined): readonly string[] {
  const entry = refTypesEntry(value);
  return entry === undefined ? [] : [entry];
}
