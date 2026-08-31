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

import {
  canonicalNumeral,
  decimalLexeme,
  isBareToken,
  isMathSource,
  isNumeral,
  isOperator,
  isQuotableContent,
  isVarName,
  isWritableText,
  type PdxOp,
} from "./representable.ts";

export type { PdxOp };

export type PdxScalar =
  | { kind: "str"; value: string; quoted: boolean }
  | { kind: "num"; lexeme: string }
  | { kind: "bool"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "math"; source: string };

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

export type PdxItem = PdxEntry | PdxScalar | PdxContainer | PdxParamBlock | PdxParamText;

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

export function container(items: readonly PdxItem[], header?: string): PdxContainer {
  if (header !== undefined && !isBareToken(header)) {
    reject("container header", header);
  }
  return { kind: "container", header, items };
}

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

export function kv(key: string, value: string | number | boolean | PdxValue): PdxEntry {
  const isNode = typeof value === "object" && value !== null && "kind" in value;
  return entry(key, "=", isNode ? value : scalar(value));
}

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
