/**
 * What this package can represent, decided once.
 *
 * The lexer, the parser, the public constructors, and the serializer all
 * need the same answer to "is this a legal X?", and when they disagree the
 * package stops being closed under its own syntax: text the parser accepts
 * that the serializer refuses, or a hand-built value that emits something
 * reading back as a different node. Every such rule lives here, and the four
 * of them import it rather than restating it.
 *
 * The numeric rules are the load-bearing ones. A JS `number` is not a
 * PDXScript numeral: `9007199254740993` is not representable as a double,
 * `1e21` has no exponent spelling in this language, and reconstructing a
 * decimal from a double loses both. So a numeral is carried as its lexeme,
 * canonicalized *textually* — never through `Number` — and the projection to
 * a JS number is a separate, checked step for consumers doing arithmetic.
 *
 * `classifyUnquoted` belongs here for the same reason: what an unquoted
 * token means is what decides whether a string may be written without
 * quotes, so the lexer and the serializer have to be reading one rule.
 */

import type { PdxScalar } from "./ast.ts";

/**
 * The characters that end a bare token, and the only table that says so.
 *
 * The lexer stops a token at these and `isBareToken` refuses text holding
 * one, which is the same question asked from the two ends: whether some text
 * is *one* token. A second copy is how the two ends stop agreeing — text the
 * lexer would split still passing as one token on the way out, so a
 * constructed scalar emits two tokens where it promised one, and the package
 * stops being closed under its own syntax. So the lexer imports this rather
 * than restating it.
 */
export const TOKEN_TERMINATORS: ReadonlySet<string> = new Set([
  " ",
  "\t",
  "\r",
  "\n",
  "\v",
  "\f",
  ";",
  "{",
  "}",
  "[",
  "]",
  "=",
  "<",
  ">",
  "!",
  "#",
  '"',
]);

/**
 * The byte-order mark, which is a property of a *file* rather than of the
 * syntax: it marks the encoding of a whole document, so it is stripped where
 * a document begins and nowhere else. A `U+FEFF` anywhere further in is an
 * ordinary character this language has no reading for, and it is left alone.
 */
export const BYTE_ORDER_MARK = "\uFEFF";

/** True when `text` would lex back as a single unquoted identifier token. */
export function isBareToken(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const char of text) {
    if (TOKEN_TERMINATORS.has(char)) {
      return false;
    }
  }
  return true;
}

/**
 * The deepest nesting this package reads or writes.
 *
 * A level is a body: top-level items sit at 0, and the items inside a
 * container or a `[[NAME] ... ]` region sit one deeper. A region with no tree
 * counts too, since reading its output back opens a body either way.
 *
 * `parse` throws `PdxSyntaxError` for input past the limit, and `serialize`
 * throws for a tree past it. The constructors do not check: depth belongs to
 * a whole assembled tree, and `container()` sees only the level it is handed.
 *
 * The bound exists so absurd input errors instead of overflowing the stack,
 * and it is shared rather than the parser's alone so that a tree the parser
 * would refuse is a tree nothing can emit. It caps the output as well: one tab
 * per level per line grows with the square of the depth.
 */
export const MAX_NESTING_DEPTH = 1000;

/**
 * Every operator an entry can carry, in one list.
 *
 * `PdxOp` is derived from it rather than written beside it, so the type and
 * the runtime check cannot drift. The runtime check is the part that matters:
 * TypeScript erases, so a JavaScript caller or a hand-assembled object
 * literal can put any text in `op`, and the serializer emits it verbatim —
 * which is how a tree came to produce output this parser then refused.
 *
 * Frozen for the same reason the check exists. `as const` is erased too, so
 * an exported array is one `push` away from teaching `isOperator` an operator
 * the lexer will still refuse — the drift this list was made to prevent,
 * arriving from outside the package.
 */
export const PDX_OPERATORS = Object.freeze(["=", ">", "<", ">=", "<=", "!="] as const);

export type PdxOp = (typeof PDX_OPERATORS)[number];

/** True when `op` is an operator this package can write and read back. */
export function isOperator(op: string): op is PdxOp {
  return (PDX_OPERATORS as readonly string[]).includes(op);
}

const NUMERAL = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

/** True when an unquoted token reads as a number (vanilla writes `+0.10`). */
export function isNumeral(text: string): boolean {
  return NUMERAL.test(text);
}

/**
 * The one spelling this package emits for a numeral, computed by moving
 * digits rather than by parsing: a leading `+` goes, so do leading and
 * trailing zeros that say nothing, and `-0` is zero. Two lexemes with the
 * same canonical form are the same number, which is what makes tree equality
 * mean what a reader expects — and no digit is ever lost on the way, which
 * is what `Number` could not promise.
 */
export function canonicalNumeral(text: string): string {
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [whole = "", fraction = ""] = unsigned.split(".");
  const digits = whole.replace(/^0+/, "") || "0";
  const decimals = fraction.replace(/0+$/, "");
  const magnitude = decimals === "" ? digits : `${digits}.${decimals}`;
  return negative && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

/**
 * A JS number as a numeral. `String()` alone is not it, for two reasons.
 *
 * Doubles outside `1e-7 .. 1e21` come back in exponent notation, which
 * PDXScript has no reading for, so the exponent is expanded into the digits
 * it stands for. And above 2^53 `String()` prints the *shortest* decimal
 * that reparses to the same double, not the value it holds:
 * `String(1000000000000000128)` is `"1000000000000000100"`. An integral
 * double is therefore written from its exact integer, so a lexeme always
 * means what it says. Fractions keep the shortest spelling — the exact
 * decimal of `0.1` is 55 digits of noise no file should carry, and shortest
 * still reparses to the same double.
 */
export function decimalLexeme(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot represent ${value} as a PDXScript number: it is not finite`);
  }
  if (Number.isInteger(value)) {
    return canonicalNumeral(BigInt(value).toString());
  }
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (match === null) {
    return canonicalNumeral(text);
  }
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const shift = Number(exponent);
  const digits = whole + fraction;
  const point = whole.length + shift;
  const padded =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : `${digits.padEnd(point, "0").slice(0, point)}.${digits.slice(point)}`;
  return canonicalNumeral(`${sign}${padded}`);
}

/**
 * The JS-number projection of a numeral, or null when no double has that
 * value: `9007199254740993` has none, and silently answering
 * `9007199254740992` is the corruption this exists to stop. The lexeme is
 * unharmed either way — a caller that only moves the value around never
 * needs to ask.
 *
 * An integer is compared as an integer. Comparing formatted spellings
 * instead would answer this question with a different one — whether the
 * lexeme is the shortest decimal for that double — and get both directions
 * wrong past 2^53: `1000000000000000100` would pass while the double holds
 * `…128`, and the exactly-held `1000000000000000128` would be refused. A
 * fraction is a different question, because almost none are held exactly
 * (`0.1` is not); there, reparsing to the same double is the guarantee, and
 * shortest-spelling equality is exactly that test.
 */
export function tryNumberValue(lexeme: string): number | null {
  const value = Number(lexeme);
  if (!Number.isFinite(value)) {
    return null;
  }
  const canonical = canonicalNumeral(lexeme);
  if (!canonical.includes(".")) {
    return Number.isInteger(value) && BigInt(value) === BigInt(canonical) ? value : null;
  }
  return decimalLexeme(value) === canonical ? value : null;
}

/** {@link tryNumberValue}, for callers with no better answer than to stop. */
export function numberValue(lexeme: string): number {
  const value = tryNumberValue(lexeme);
  if (value === null) {
    throw new Error(
      `Cannot read ${lexeme} as a JavaScript number: no double has that value ` +
        "(the lexeme is preserved exactly; read it as text)"
    );
  }
  return value;
}

/**
 * True when `content` can sit between quotes and come back unchanged. The
 * lexer treats `\` as skipping the next character while it looks for the
 * closing quote, so content ending in an odd run of backslashes would eat
 * its own terminator, and an unescaped `"` would end the token early.
 */
export function isQuotableContent(content: string): boolean {
  let index = 0;
  while (index < content.length) {
    if (content[index] === "\\") {
      if (index + 1 >= content.length) {
        return false;
      }
      index += 2;
      continue;
    }
    if (content[index] === '"') {
      return false;
    }
    index += 1;
  }
  return true;
}

/**
 * True when `key` can be written without quotes.
 *
 * A key is never classified, so `yes` and `123` are keys like any other and
 * the character class decides — with one exception. A key opening with a
 * byte-order mark is written quoted, because a document may not begin with
 * one: `parse` reads that as the file's encoding mark and removes it, so a
 * bare `\uFEFFkey` at the top of a file would come back as `key`.
 *
 * The quotes cost nothing here, and that is why this rule is a key's alone. An
 * entry records no `quoted` flag for its key, so quoting one leaves the same
 * tree; a `str` carries that flag, so promoting a value would change the tree
 * a reparse gives back. A value that would open a document with the mark is
 * refused by `serialize` instead.
 */
export function isBareKey(key: string): boolean {
  return isBareToken(key) && !key.startsWith(BYTE_ORDER_MARK);
}

/** True when `name` can be written between `[[`/`[[!` and `]`. */
export function isParamName(name: string): boolean {
  return isBareToken(name);
}

/** How an unquoted token reads as a value. Shared by the lexer and the serializer. */
export function classifyUnquoted(text: string): PdxScalar {
  if (text === "yes" || text === "no") {
    return { kind: "bool", value: text === "yes" };
  }
  if (isNumeral(text)) {
    // The digits are kept as written, minus the spellings that say nothing
    // (`+0.10`, `2.0`, `-0`): a double cannot hold every numeral a file may
    // contain, and reconstructing one from a double is where the digits go.
    return { kind: "num", lexeme: canonicalNumeral(text) };
  }
  if (text.startsWith("@")) {
    return { kind: "var", name: text };
  }
  return { kind: "str", value: text, quoted: false };
}

/** True when `text` may be written without quotes and still read back as itself. */
export function isBareString(text: string): boolean {
  return isBareToken(text) && classifyUnquoted(text).kind === "str";
}

/**
 * True when `text` can be written as a value or a key at all — bare where
 * that reads back as itself, quoted otherwise. This is the disjunction the
 * serializer actually takes, and the constructors reject anything outside
 * it rather than build a value that cannot be emitted.
 */
export function isWritableText(text: string): boolean {
  return isBareString(text) || isQuotableContent(text);
}

/** True when `name` can be written as an `@name` reference. */
export function isVarName(name: string): boolean {
  return name.startsWith("@") && isBareToken(name);
}

/**
 * True when `source` is an inline-math token: `@[ ... ]` (or the deferred
 * `@\[ ... ]`) whose first `]` is its last character, since that is where
 * the lexer ends it.
 */
export function isMathSource(source: string): boolean {
  const opener = source.startsWith("@[") ? 2 : source.startsWith("@\\[") ? 3 : 0;
  if (opener === 0 || !source.endsWith("]")) {
    return false;
  }
  return !source.slice(opener, -1).includes("]");
}
