/** Shared textual renderers for generated interface members and metadata declarations. */

import { docComment, propertyName } from "../naming.ts";

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
