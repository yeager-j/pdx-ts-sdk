/**
 * The PDXScript AST.
 *
 * The shape follows the grammar (see GRAMMAR.md), not the uses: a braced
 * value is one node — a container of items, each item a scalar or a
 * `key op value` entry. "List" and "block" are not node kinds; they are
 * renderings the serializer derives from what a container holds. This is the
 * design the strict list/block split could not survive contact with:
 * vanilla's `prerequisites = { tech_stingers OR = { ... } }` mixes both in
 * one container, and here that is ordinary data, not an error.
 *
 * Two scalar kinds carry constructs whose *semantics* live outside this
 * package: `var` is an `@name` reference (resolution against scripted
 * variables is game knowledge), and `math` is an `@[ ... ]` expression
 * carried verbatim. Both re-serialize exactly; neither is interpreted.
 *
 * A number is its lexeme, not a JS `number`: doubles cannot hold every
 * numeral a game file may contain, and going through one is where digits
 * are lost (`9007199254740993`) or where a value stops having a spelling at
 * all (`1e21`). `numberValue()` is the checked projection for consumers
 * doing arithmetic.
 *
 * Every constructor here rejects what the parser could not have produced,
 * so a hand-built tree is in the same language as a parsed one — see
 * `representable.ts`, which the lexer and serializer share.
 *
 * Entries carry an optional source line — the parser always sets it,
 * hand-built trees omit it, and tree comparisons ignore it.
 */

import { assertNegation, regionTextProblem } from "./region.ts";
import {
  canonicalNumeral,
  decimalLexeme,
  isBareToken,
  isMathSource,
  isNumeral,
  isOperator,
  isParamName,
  isQuotableContent,
  isVarName,
  isWritableText,
  type PdxOp,
} from "./representable.ts";

// Declared with the operator table it is derived from, and re-exported here
// because an entry's operator is part of the AST a reader comes for. Its
// documentation lives with the declaration.
export type { PdxOp };

/**
 * A single value: a string, a number, a bool, an `@name` reference, or an
 * `@[ ... ]` expression.
 *
 * `quoted` on a `str` is a rendering hint, not part of the value: the
 * serializer promotes a bare string to quoted whenever bare would read back as
 * something else (`"yes"`, `"123"`, `"@x"`), and never demotes one. A `num` is
 * its lexeme rather than a JS `number` — see {@link numeral}.
 */
export type PdxScalar =
  | { kind: "str"; value: string; quoted: boolean }
  | { kind: "num"; lexeme: string }
  | { kind: "bool"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "math"; source: string };

/**
 * A braced list of items: `{ a b c }`, `{ a = 1 }`, or both at once.
 *
 * Deliberately not a map. It may hold entries, bare scalars, or a mix, its
 * keys may repeat, and item order is preserved — the game is sensitive to
 * both. Whether it renders inline or one item per line is the serializer's
 * decision from what it holds, not a property of the node.
 */
export interface PdxContainer {
  readonly kind: "container";
  /**
   * A scalar immediately preceding the braces at value position: `hsv` in
   * `color = hsv { 0.63 0.13 0.5 }`. Open-ended (`rgb`, `hsv360`, `hex`,
   * `LIST`, ...) — the rule is positional, not a name list.
   */
  readonly header?: string;
  readonly items: readonly PdxItem[];
}

/**
 * A `key op value` triple, such as `cost = 100` or `has_level >= 2`.
 *
 * The key is raw text and is never classified, so `yes` and `123` are keys
 * like any other. Duplicate keys are kept, in order.
 */
export interface PdxEntry {
  readonly kind: "entry";
  readonly key: string;
  readonly op: PdxOp;
  readonly value: PdxValue;
  /** 1-based source line; set by the parser, absent on hand-built trees. */
  readonly line?: number;
}

/**
 * A `[[NAME] ... ]` conditional region whose body is a balanced item
 * sequence: those items apply only when the scripted effect/trigger is
 * invoked with NAME defined (`[[!NAME]` when undefined). Stellaris
 * `common/scripted_effects` uses these; the `$NAME$` substitution tokens
 * inside are ordinary `str` scalars.
 */
export interface PdxParamBlock {
  readonly kind: "param";
  readonly name: string;
  readonly negated: boolean;
  readonly items: readonly PdxItem[];
}

/**
 * The same region when its body is *not* a balanced item sequence, so there
 * is no tree to give: the engine splices these regions as text before it
 * parses, and a mod may open a brace in one region and close it in another
 * (Gigastructural Engineering's fleet naming does). The body is kept
 * verbatim and re-emitted verbatim — comments included, since dropping them
 * would edit text this package did not read.
 */
export interface PdxParamText {
  readonly kind: "param-text";
  readonly name: string;
  readonly negated: boolean;
  /** The region's source between the opener and its closing `]`. */
  readonly text: string;
}

/** Anything that can stand at item position: in a file, or inside a container. */
export type PdxItem = PdxEntry | PdxScalar | PdxContainer | PdxParamBlock | PdxParamText;

/**
 * Anything that can stand on the right of an operator. Narrower than
 * {@link PdxItem}: a conditional region is an item, never a value.
 */
export type PdxValue = PdxScalar | PdxContainer;

/**
 * Something the parser recognised as malformed but repaired the way the game
 * does — shipped vanilla files contain each of these. Never dropped silently:
 * strict callers fail when `diagnostics` is non-empty.
 */
export interface PdxDiagnostic {
  readonly kind: "stray-closing-brace" | "unclosed-at-eof" | "operator-less-entry";
  readonly fileName: string;
  readonly line: number;
  readonly text: string;
}

/**
 * A parsed source file. The top level is a container body without braces:
 * usually all entries, but vanilla ships all-scalar files (`job_tags`) and
 * anonymous top-level containers (`gamesetup_settings`) too.
 */
export interface PdxDocument {
  readonly fileName: string;
  readonly items: readonly PdxItem[];
  readonly diagnostics: readonly PdxDiagnostic[];
}

function reject(what: string, value: string): never {
  throw new Error(`Cannot represent ${JSON.stringify(value)} as a PDXScript ${what}`);
}

/**
 * A scalar from a JS value, refusing anything this syntax cannot carry.
 *
 * A string is refused when it can be written neither bare nor between quotes
 * — content ending in an odd run of backslashes, or holding an unescaped `"`,
 * would eat its own terminator. It is *not* refused for merely needing quotes:
 * `scalar("two words")` is a bare `str` node that the serializer will quote,
 * and `scalar("yes")` likewise, so that it does not read back as a bool.
 *
 * A number is refused when it is not finite. Note that it goes through a JS
 * double: for an integer past 2^53 or more decimals than a double keeps, use
 * {@link numeral}, which takes the digits as written.
 *
 * @throws Error when the value has no spelling in this syntax.
 */
export function scalar(value: string | number | boolean): PdxScalar {
  switch (typeof value) {
    case "string":
      if (!isWritableText(value)) {
        reject("string", value);
      }
      return { kind: "str", value, quoted: false };
    case "number":
      return { kind: "num", lexeme: decimalLexeme(value) };
    case "boolean":
      return { kind: "bool", value };
  }
}

/**
 * A number written out, for the values a JS `number` cannot carry: an
 * integer past 2^53, or more decimals than a double keeps. The lexeme is
 * kept as given, minus the spellings that say nothing.
 */
export function numeral(lexeme: string): PdxScalar {
  if (!isNumeral(lexeme)) {
    reject("number", lexeme);
  }
  return { kind: "num", lexeme: canonicalNumeral(lexeme) };
}

/**
 * A string that keeps its quotes through the round trip, where {@link scalar}
 * would leave the serializer to decide.
 *
 * The content is emitted raw between the quotes: escapes are not decoded on
 * the way in and not added on the way out.
 *
 * @throws Error when the content could not sit between quotes and come back
 * unchanged — an unescaped `"`, or a trailing odd run of backslashes.
 */
export function quoted(value: string): PdxScalar {
  if (!isQuotableContent(value)) {
    reject("quoted string", value);
  }
  return { kind: "str", value, quoted: true };
}

/** An `@name` reference. Emits bare; resolving it is the caller's business. */
export function varRef(name: string): PdxScalar {
  if (!isVarName(name)) {
    reject("variable reference", name);
  }
  return { kind: "var", name };
}

/** An `@[ ... ]` expression, carried verbatim. */
export function inlineMath(source: string): PdxScalar {
  if (!isMathSource(source)) {
    reject("inline math expression", source);
  }
  return { kind: "math", source };
}

/**
 * A braced list of items, with an optional scalar header: the `hsv` in
 * `color = hsv { 0.63 0.13 0.5 }`.
 *
 * The items are not re-checked — each was built by its own constructor.
 * Nesting depth is not checked here either, because depth belongs to the whole
 * assembled tree rather than to one level; {@link serialize} refuses a tree
 * deeper than {@link MAX_NESTING_DEPTH}.
 *
 * @throws Error when the header could not be written as a bare token.
 */
export function container(items: readonly PdxItem[], header?: string): PdxContainer {
  if (header !== undefined && !isBareToken(header)) {
    reject("container header", header);
  }
  return { kind: "container", header, items };
}

/**
 * A `[[NAME] ... ]` region whose body is a balanced item sequence.
 *
 * The items are ordinary items, already checked by their own constructors;
 * what this adds is the name and the negation flag, which are what this node
 * contributes to the output.
 *
 * @throws Error when the name could not be written between `[[` and `]`, or
 * when `negated` is not a boolean — the type is erased, and a truthy
 * `"false"` would write `[[!NAME]` for a node whose field says otherwise.
 */
export function paramBlock(
  name: string,
  items: readonly PdxItem[],
  negated = false
): PdxParamBlock {
  if (!isParamName(name)) {
    reject("parameter name", name);
  }
  assertNegation(negated);
  return { kind: "param", name, negated, items };
}

/**
 * The same region when its body has no tree, carried as text.
 *
 * This is the one field in the AST that is spliced between delimiters rather
 * than written from a checked value, so it is the one that can emit something
 * reading back as a different node: a body that happens to balance comes back
 * as a `param`, and a body holding a bare `]` ends the region early and
 * spills the rest into the document. Both are refused here, with the reason.
 */
export function paramText(name: string, text: string, negated = false): PdxParamText {
  const problem = regionTextProblem(name, negated, text);
  if (problem !== null) {
    throw new Error(
      `Cannot represent ${JSON.stringify(text)} as the body of a PDXScript region: ${problem}`
    );
  }
  return { kind: "param-text", name, negated, text };
}

/**
 * A `key op value` entry.
 *
 * The key is not classified, so `yes` and `123` are keys like any other. A key
 * outside the bare character class is not refused but quoted on the way out,
 * since the parser reads quoted keys.
 *
 * `op` is checked at runtime as well as in the type: the `PdxOp` annotation is
 * erased, so it stops nothing a JavaScript caller does, and the operator is
 * emitted raw.
 *
 * @throws Error when the key can be written neither bare nor quoted, or when
 * `op` is not one of {@link PDX_OPERATORS}.
 */
export function entry(key: string, op: PdxOp, value: PdxValue): PdxEntry {
  // A key is not classified, so `yes` and `123` are legal keys: only the
  // character class, and quotability where that fails, decide.
  if (!isBareToken(key) && !isQuotableContent(key)) {
    reject("key", key);
  }
  // The `PdxOp` annotation is erased at runtime, so it stops nothing a
  // JavaScript caller does. Every other field is checked here; this one was
  // taken on trust and emitted verbatim.
  if (!isOperator(op)) {
    reject("operator", op);
  }
  return { kind: "entry", key, op, value };
}

/**
 * `key = value`, the common case. A JS value is passed through
 * {@link scalar}; an already-built node is used as it is.
 *
 * @throws Error for whatever {@link entry} or {@link scalar} would refuse.
 */
export function kv(key: string, value: string | number | boolean | PdxValue): PdxEntry {
  const isNode = typeof value === "object" && value !== null && "kind" in value;
  return entry(key, "=", isNode ? value : scalar(value));
}

/**
 * {@link kv} with a comparison operator: `has_level >= 2`.
 *
 * Scalar-only as a convenience, not as a rule of the syntax: the parser reads
 * a value the same way after any operator, and `entry("x", ">=",
 * container([]))` is accepted and round-trips as `x >= {}`. Use {@link entry}
 * for that.
 *
 * @throws Error for whatever {@link entry} or {@link scalar} would refuse.
 */
export function cmp(
  key: string,
  op: PdxOp,
  value: string | number | boolean | PdxScalar
): PdxEntry {
  const isNode = typeof value === "object" && value !== null && "kind" in value;
  return entry(key, op, isNode ? value : scalar(value));
}

/** Sugar for the common all-entries container: `key = { a = 1 b = 2 }`. */
export function block(key: string, entries: readonly PdxEntry[]): PdxEntry {
  return kv(key, container(entries));
}

/** Sugar for the common all-scalars container: `key = { a b c }`. */
export function list(key: string, items: readonly PdxScalar[]): PdxEntry {
  return kv(key, container(items));
}
