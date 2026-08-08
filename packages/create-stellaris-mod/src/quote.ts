/**
 * The one place a string becomes a TypeScript string literal.
 *
 * Every recipe renderer interpolates author-supplied text — a mod name, a
 * technology's display name — into source it is about to write to disk. One
 * function does that, and its core is `JSON.stringify`: the JSON string grammar
 * is a strict subset of TypeScript's, so anything it produces is a legal TS
 * literal, and it escapes quotes, backslashes, control characters and lone
 * surrogates without anyone having to remember the list.
 *
 * Hand-rolled escaping is the alternative, and the reason not to write it is
 * that its bugs are source injection rather than mangled output.
 *
 * The one thing layered on top is Prettier's quote preference, and it is not
 * cosmetic. Generated source is required to be byte-identical to what Prettier
 * would print, and Prettier switches a string to single quotes when that means
 * fewer escapes — so a technology called `Robert"); DROP TABLE` would come back
 * from the formatter re-quoted, and the byte-stability gate would fail on a name
 * an author is perfectly entitled to type. `adversarial-names.test.ts` is what
 * found this, and is what holds it.
 */

/**
 * Prettier's rule, with `singleQuote: false`: prefer double quotes, unless the
 * value contains strictly more of them than single quotes.
 */
export function quoteTs(value: string): string {
  const doubles = occurrences(value, '"');
  const singles = occurrences(value, "'");
  if (doubles <= singles) {
    return JSON.stringify(value);
  }
  // Same escaping, re-aimed at the other delimiter: JSON's `\"` becomes a bare
  // `"`, and the now-significant `'` is escaped. Every other escape JSON chose —
  // backslashes, control characters, lone surrogates — is left exactly as it is,
  // which is also what Prettier does with them.
  const body = JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
  return `'${body}'`;
}

function occurrences(value: string, character: string): number {
  return value.split(character).length - 1;
}
