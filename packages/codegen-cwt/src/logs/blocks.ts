/**
 * Shared block-reading helpers for the game's documentation dumps.
 *
 * The dumps are one format read by three parsers — triggers/effects, scope
 * links, and modifiers. They agree on how a block ends, which of its lines
 * carry meaning, and how an unreadable block is written down for the drift
 * gate. Keeping those three answers here is what stops one parser's idea of a
 * separator or a malformed entry from drifting away from its siblings'.
 */

/** A run of `=` the dumps use to frame sections rather than to carry content. */
const SEPARATOR_PATTERN = /^=+$/;

/**
 * Reports whether a dump line carries content, as opposed to blank padding or
 * a `====` section rule.
 *
 * Use it to find a block's heading, since the dumps place separators above
 * headings and a naive first-line read would take the separator for one.
 */
export function isMeaningful(line: string): boolean {
  const trimmedLine = line.trim();
  return trimmedLine !== "" && !SEPARATOR_PATTERN.test(trimmedLine);
}

/**
 * Renders one unreadable block as a single drift-gate line.
 *
 * The text is truncated because the entry only has to identify the block for a
 * reviewer; `location` is what makes it findable, and the baseline compares
 * these lines verbatim.
 */
export function formatMalformedBlock(location: string, lines: readonly string[]): string {
  return `${location} ${lines.join(" ").trim().slice(0, 80)}`;
}
