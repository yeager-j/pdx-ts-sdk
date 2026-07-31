/**
 * The per-claim suite: one `it` per grammatical claim from GRAMMAR.md, each
 * with a one-line input. This file is written before the implementation —
 * the `it.todo`s below are the reviewed test plan, converted to live tests
 * as the lexer, parser, and serializer land (in that order).
 *
 * Claims marked (jomini) were mined from the jomini crate's test suite and
 * the pdx.tools syntax-tour post — battle-tested corners from shipped game
 * files, adapted for this API (jomini is MIT; inputs are quirk-shaped, not
 * copied text).
 *
 * Property tests (parse → serialize → parse fixpoint, corpus sweeps, the
 * jomini differential) live in their own files; this one is the TDD driver
 * loop, and every claim here should stay a one-liner.
 */

import { describe, it } from "vitest";

describe("lexer", () => {
  it.todo("strips a leading UTF-8 BOM");
  it.todo("drops # comments to end of line, including inline after a value");
  it.todo("drops a comment adjacent to a token without whitespace: foo=abc#def (jomini)");
  it.todo("drops a comment that ends the file with no trailing newline (jomini)");
  it.todo("lexes a BOM followed by only a comment as an empty document (jomini)");
  it.todo("treats semicolons as trivia: a = 1;; b = 2; (jomini — vanilla gfx files)");
  it.todo("lexes CRLF sources identically to LF");
  it.todo('captures quoted strings raw, honoring \\" only for termination (jomini)');
  it.todo("allows newlines and arbitrary bytes inside quoted strings (jomini)");
  it.todo("throws on an unterminated quoted string, with file:line");
  it.todo("lexes each operator as one token: = < > <= >= !=");
  it.todo("lexes @name as one token");
  it.todo("lexes @[ ... ] as one verbatim token, spaces included");
  it.todo("throws on unterminated @[ inline math, with file:line");
  it.todo("splits braces adjacent to tokens: a={b}");
  it.todo('starts a token immediately after a closing quote: "foo"="bar"3="x" (jomini)');
  it.todo(
    "keeps | : . - $ inside unquoted tokens: value:x|JOB|y| scope:a.b (jomini — Stellaris script values)"
  );
  it.todo("keeps non-ASCII bytes inside unquoted tokens (jomini)");
});

describe("parser: entries", () => {
  it.todo("parses a file as a sequence of entries, order preserved");
  it.todo("preserves duplicate keys in order");
  it.todo("preserves comparison operators on entries");
  it.todo("accepts @name keys (variable definitions)");
  it.todo("accepts quoted keys as their text (deferral documented) (jomini)");
  it.todo("records the 1-based source line on every entry");
  it.todo("throws when an operator has no value, with file:line");
  it.todo("throws when nesting exceeds the depth guard instead of overflowing the stack (jomini)");
});

describe("parser: scalars", () => {
  it.todo("classifies yes/no as bool");
  it.todo('keeps quoted "yes" a string');
  it.todo("classifies integers, decimals, negatives, and leading-dot as num");
  it.todo("classifies plus-signed numbers as num: +0.10 (jomini — Stellaris)");
  it.todo("classifies date-like tokens (2200.01.01) as str");
  it.todo("classifies @name values as var");
  it.todo("classifies everything else as str");
});

describe("parser: containers", () => {
  it.todo("parses all-scalar braces as a container of scalar items");
  it.todo("parses all-entry braces as a container of entry items");
  it.todo("parses mixed bare-and-entry braces, item order preserved (OR-prerequisites)");
  it.todo(
    'parses a quoted bare item in a mixed container: url "" (jomini — Stellaris DLC metadata)'
  );
  it.todo("parses empty braces as an empty container");
  it.todo("preserves empty anonymous containers as items (documented jomini divergence)");
  it.todo("parses nested containers to arbitrary depth (within the guard)");
  it.todo("parses bare container items: { { 0 1 } { 2 3 } }");
  it.todo(
    "parses any scalar followed by { at value position as a header: hsv, rgb, hex, LIST (jomini)"
  );
  it.todo("parses a 4-component rgb header container (jomini)");
  it.todo("parses name = rgb followed by another key as the plain scalar rgb (jomini)");
  it.todo("keeps scalar-then-container at item position as two bare items");
});

describe("parser: repair diagnostics", () => {
  it.todo("skips a stray closing brace and records a diagnostic (jomini — EU4 verona.txt)");
  it.todo(
    "auto-closes unterminated containers at EOF with a diagnostic naming the opening line (jomini — HOI4)"
  );
  it.todo("reads a top-level operator-less foo{...} as foo = {...} with a diagnostic (jomini)");
  it.todo("returns no diagnostics for well-formed input");
});

describe("serializer", () => {
  it.todo("renders an all-scalar container inline: { a b c }");
  it.todo("renders an entry container one per line, tab-indented");
  it.todo("renders a mixed container multiline, bare items on their own lines");
  it.todo("renders an empty container as {}");
  it.todo("separates top-level entries with a blank line and ends with a newline");
  it.todo("renders bools as yes/no");
  it.todo("throws on exponent-notation numbers");
  it.todo("keeps explicit quoting; quotes strings that are not bare-safe");
  it.todo("renders bare strings unquoted, including / paths and |: script values");
  it.todo('quotes a str that would re-lex as another kind: "yes", "123", "@x", "+5"');
  it.todo("re-emits escaped-quote content verbatim (raw round-trip) (jomini)");
  it.todo("renders var scalars as the bare @name");
  it.todo("renders math scalars verbatim");
  it.todo("renders header containers as header { ... }");
  it.todo("throws on a key that would need quoting (deferred by name)");
});

describe("round trip", () => {
  it.todo("parse → serialize → parse yields an identical tree, lines ignored");
  it.todo("serialize is byte-stable on its own output");
  it.todo("round-trips the nasty fixture: variables, swaps, six modifiers, OR-prerequisites");
  it.todo("round-trips repaired input in its repaired form (jomini)");
});
