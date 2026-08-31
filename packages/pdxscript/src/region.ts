/**
 * Whether a `[[NAME] ... ]` region reads back as the region it was built
 * from, and the one spelling of its opener.
 *
 * `param-text` is the node whose body this package does not interpret: the
 * text is carried verbatim and re-emitted verbatim. That makes it the one
 * place where a field is not a checked value but arbitrary text spliced
 * between delimiters, and two things can go wrong with it. A body that
 * happens to balance comes back as a `param` node — a different kind of node
 * than the one that was written. A body holding a `]` the region scan does
 * not skip ends the region early, and the rest of the text lands in the
 * document as loose tokens, so the output is not even a valid file.
 *
 * The question is settled by emitting the region and reading it back, rather
 * than by restating where a region ends. Those rules are written once, in the
 * lexer's region scan, and a second copy of them here is exactly how two ends
 * of one question come to disagree. This module sits above the parser and
 * below the constructors and the serializer, so both of them can ask.
 */

import { parse } from "./parser.ts";
import { isParamName } from "./representable.ts";

/**
 * Refuses a negation flag that is not a boolean.
 *
 * The type is erased, so a JavaScript caller can pass `"false"` — truthy, and
 * therefore written as `[[!NAME]` for a node whose own field says otherwise.
 * A reparse then hands back a region negated the other way, which is the
 * round trip this package promises not to break. One character of output, and
 * the only thing deciding it is this flag.
 *
 * @throws Error when `negated` is not a boolean.
 */
export function assertNegation(negated: boolean): void {
  if (typeof negated !== "boolean") {
    throw new Error(
      `Cannot write a region negation from ${JSON.stringify(negated)}: it decides whether the ` +
        "opener carries `!`, and only a boolean says which"
    );
  }
}

/** The `[[NAME]` / `[[!NAME]` opener, spelled once. */
export function regionOpener(name: string, negated: boolean): string {
  assertNegation(negated);
  return `[[${negated ? "!" : ""}${name}]`;
}

/**
 * Why `[[NAME]<text>]` would not read back as the same `param-text` region,
 * or null when it would. A reason rather than a yes/no, because "this body
 * balances" and "this body ends the region early" are different mistakes
 * with different fixes.
 */
export function regionTextProblem(name: string, negated: boolean, text: string): string | null {
  // Before the parse below, not inside it: a bad flag is its own error, and
  // the catch there would otherwise report it as a body that fails to close.
  assertNegation(negated);
  if (!isParamName(name)) {
    return `${JSON.stringify(name)} cannot be written as a parameter name`;
  }
  let items;
  let diagnostics;
  try {
    ({ items, diagnostics } = parse(`${regionOpener(name, negated)}${text}]`, "<region>"));
  } catch (error) {
    // The body took the region's closing `]` with it, or opened something it
    // never closed, so there is no region here to read back.
    return `it does not close the region as written (${
      error instanceof Error ? error.message : String(error)
    })`;
  }
  const [item, ...rest] = items;
  if (item === undefined || rest.length > 0 || diagnostics.length > 0) {
    // An early `]` ends the region and leaves the remainder of the body loose
    // in the document, which is how one region becomes several items.
    return "it does not read back as one region";
  }
  if (item.kind === "param") {
    return "it is a balanced item sequence, so it reads back as a region with a tree (use a param node)";
  }
  if (
    item.kind !== "param-text" ||
    item.name !== name ||
    item.negated !== negated ||
    item.text !== text
  ) {
    return "it does not read back as the same region";
  }
  return null;
}

/** True when `[[NAME]<text>]` reads back as exactly that `param-text` region. */
export function isRegionText(name: string, negated: boolean, text: string): boolean {
  return regionTextProblem(name, negated, text) === null;
}
