/**
 * Reading JSON files that people edit.
 *
 * The only thing here is the byte-order mark, and it is not a nicety. Node's
 * package and JSON module loaders strip a leading `EF BB BF` before parsing,
 * so a `package.json` or a Project Manifest saved by an editor that adds one
 * resolves and imports perfectly well. `readFile(..., "utf8")` does not strip
 * it — it decodes those bytes to U+FEFF — and `JSON.parse` then rejects the
 * result.
 *
 * Refusing such a file would be this package disagreeing with the runtime that
 * is about to read the same bytes successfully: a project told its manifest is
 * malformed, or an installed SDK reported unreadable, over a character
 * everything else ignores.
 */

/**
 * The byte-order mark, once decoded. Written as an escape rather than as the
 * character, which is invisible in an editor and in a diff.
 */
const BOM = "\uFEFF";

/**
 * Parses JSON text the way Node's own loaders would.
 *
 * Only the leading byte-order mark is tolerated; everything else is left to
 * `JSON.parse`, whose `SyntaxError` callers report as the fault it is.
 *
 * @param text The decoded file contents.
 * @returns The parsed value, whose shape the caller still has to check.
 * @throws SyntaxError When the text after any byte-order mark is not JSON.
 */
export function parseJsonFile(text: string): unknown {
  return JSON.parse(text.startsWith(BOM) ? text.slice(BOM.length) : text);
}
