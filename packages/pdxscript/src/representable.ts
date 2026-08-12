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

const TERMINATORS = new Set([
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

/** True when `text` would lex back as a single unquoted identifier token. */
export function isBareToken(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const char of text) {
    if (TERMINATORS.has(char)) {
      return false;
    }
  }
  return true;
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
 * A JS number as a numeral. `String()` alone is not it: doubles outside
 * `1e-7 .. 1e21` come back in exponent notation, which PDXScript has no
 * reading for, so the exponent is expanded into the digits it stands for.
 */
export function decimalLexeme(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot represent ${value} as a PDXScript number: it is not finite`);
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
 */
export function tryNumberValue(lexeme: string): number | null {
  const value = Number(lexeme);
  if (!Number.isFinite(value) || decimalLexeme(value) !== canonicalNumeral(lexeme)) {
    return null;
  }
  return value;
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
