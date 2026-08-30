/**
 * Serializer for PDXScript. One canonical rendering — see GRAMMAR.md.
 *
 * The bare-vs-quoted decision is symmetric with the lexer: a `str` renders
 * bare only if re-lexing it would yield the same single `str` token
 * (`isBareToken` for the character class, `classifyUnquoted` to reject text
 * that would come back as a bool, num, or var); otherwise it renders quoted,
 * keys included. What cannot be written either way throws instead of
 * emitting output that reads back differently — but the constructors reject
 * those values on the way in, so a throw here means a tree assembled as a
 * bare object literal.
 */

import type { PdxContainer, PdxItem, PdxParamBlock, PdxParamText, PdxScalar } from "./ast.ts";
import { regionOpener, regionTextProblem } from "./region.ts";
import {
  BYTE_ORDER_MARK,
  canonicalNumeral,
  isBareKey,
  isBareString,
  isBareToken,
  isMathSource,
  isNumeral,
  isOperator,
  isParamName,
  isQuotableContent,
  isVarName,
  MAX_NESTING_DEPTH,
  PDX_OPERATORS,
} from "./representable.ts";

/** Between quotes, and readable back as the same content. */
function quotedText(content: string, what: string): string {
  if (!isQuotableContent(content)) {
    throw new Error(
      `Cannot serialize ${what} ${JSON.stringify(content)}: content is emitted raw, and this ` +
        "would not read back as itself (see GRAMMAR.md)"
    );
  }
  return `"${content}"`;
}

/**
 * One scalar as this package writes it, which is what {@link serialize} would
 * emit for it.
 *
 * A `str` renders bare only where re-lexing it would give back the same single
 * `str`; otherwise it is quoted, so `"yes"`, `"123"` and `"@x"` come back as
 * strings rather than as a bool, a number, or a variable reference.
 *
 * @throws Error for a value no spelling can carry — a `num` whose lexeme is
 * not a canonical numeral, a string whose content would terminate its own
 * quotes, or a malformed `var` or `math`. The constructors refuse these on the
 * way in, so a throw here means a node assembled as a bare object literal.
 */
export function scalarText(scalar: PdxScalar): string {
  switch (scalar.kind) {
    case "bool":
      return scalar.value ? "yes" : "no";
    case "num":
      // A lexeme is emitted raw, so it has to be one: `"1 # injected"` would
      // read back as `1`, and `+01.0` as a different node than the literal
      // that was written. Same backstop the other kinds get.
      if (!isNumeral(scalar.lexeme) || canonicalNumeral(scalar.lexeme) !== scalar.lexeme) {
        throw new Error(
          `Cannot serialize number ${JSON.stringify(scalar.lexeme)}: it is not a canonical ` +
            "numeral (build numbers with scalar() or numeral())"
        );
      }
      return scalar.lexeme;
    case "str":
      return scalar.quoted || !isBareString(scalar.value)
        ? quotedText(scalar.value, "string")
        : scalar.value;
    case "var":
      if (!isVarName(scalar.name)) {
        throw new Error(`Cannot serialize variable reference ${JSON.stringify(scalar.name)}`);
      }
      return scalar.name;
    case "math":
      if (!isMathSource(scalar.source)) {
        throw new Error(`Cannot serialize inline math ${JSON.stringify(scalar.source)}`);
      }
      return scalar.source;
  }
}

/** Narrows an item to a scalar: one of the five value kinds, not a node. */
export function isScalar(item: PdxItem): item is PdxScalar {
  return (
    item.kind === "str" ||
    item.kind === "num" ||
    item.kind === "bool" ||
    item.kind === "var" ||
    item.kind === "math"
  );
}

/**
 * The depth the parser guards, checked from the writing end.
 *
 * A body sits one level below the item that opens it, and the parser refuses
 * to read a body past the limit — so emitting one would produce a file this
 * package could not read back, which is the closure the constructors and the
 * serializer are supposed to keep. The check is here rather than in
 * `container()` because depth is a property of the whole assembled tree, and
 * a constructor sees only the level it is handed.
 */
function enterBody(depth: number, what: string): void {
  if (depth + 1 > MAX_NESTING_DEPTH) {
    throw new Error(
      `Cannot serialize a ${what} nested deeper than ${MAX_NESTING_DEPTH} levels: parsing the ` +
        "result would fail with the same limit"
    );
  }
}

function containerText(container: PdxContainer, depth: number): string {
  enterBody(depth, "container");
  let head = "";
  if (container.header !== undefined) {
    if (!isBareToken(container.header)) {
      throw new Error(`Cannot serialize container header ${JSON.stringify(container.header)}`);
    }
    head = `${container.header} `;
  }
  if (container.items.length === 0) {
    return `${head}{}`;
  }
  if (container.items.every(isScalar)) {
    return `${head}{ ${container.items.map(scalarText).join(" ")} }`;
  }
  const indent = "\t".repeat(depth);
  const body = container.items.map((item) => serializeItem(item, depth + 1)).join("\n");
  return `${head}{\n${body}\n${indent}}`;
}

function openerFor(param: PdxParamBlock | PdxParamText): string {
  if (!isParamName(param.name)) {
    throw new Error(`Cannot serialize parameter name ${JSON.stringify(param.name)}`);
  }
  return regionOpener(param.name, param.negated);
}

function paramBlockText(param: PdxParamBlock, depth: number): string {
  enterBody(depth, "region");
  const indent = "\t".repeat(depth);
  const open = openerFor(param);
  if (param.items.length === 0) {
    return `${open}\n${indent}]`;
  }
  const body = param.items.map((item) => serializeItem(item, depth + 1)).join("\n");
  return `${open}\n${body}\n${indent}]`;
}

/**
 * A region with no tree re-emits byte-for-byte, with nothing added around
 * the body: the parser's region scan is deterministic, so what it captured
 * it captures again — but only if no indentation creeps in between the
 * opener and the closing `]`.
 *
 * That holds for a body the parser produced. A hand-assembled one is text
 * nothing checked, and it is spliced in raw: a body that balances comes back
 * as a `param` node, and one holding a bare `]` closes the region early and
 * spills the remainder into the document. `paramText()` refuses both, and
 * this is the same refusal for a tree built as an object literal.
 *
 * The depth guard applies here as much as to a region with a tree. Nothing is
 * emitted one level down, so it is easy to read this as a leaf — but the
 * parser does not treat it as one: reading the output back opens a region body
 * at `depth + 1` whether or not that body turns out to be a tree.
 */
function paramTextRegion(param: PdxParamText, depth: number): string {
  enterBody(depth, "region");
  const text = `${openerFor(param)}${param.text}]`;
  const problem = regionTextProblem(param.name, param.negated, param.text);
  if (problem !== null) {
    throw new Error(
      `Cannot serialize region body ${JSON.stringify(param.text)}: ${problem} ` +
        "(build regions with paramText() or paramBlock())"
    );
  }
  return text;
}

function serializeItem(item: PdxItem, depth: number): string {
  const indent = "\t".repeat(depth);
  if (item.kind === "entry") {
    // A key is raw text, never classified: `yes` and `123` are keys as
    // readily as `foo`. Only the character class decides, and a key outside
    // it is quoted rather than refused — the parser accepts quoted keys, so
    // refusing to write one is what made the language not closed. The same
    // answer covers a key opening with a byte-order mark, which no document
    // may open with.
    const key = isBareKey(item.key) ? item.key : quotedText(item.key, "key");
    // The same backstop the other fields get. `op` is emitted raw, and its
    // `PdxOp` type is gone by now, so a tree assembled as an object literal
    // could write text no parse of the result would accept.
    if (!isOperator(item.op)) {
      throw new Error(
        `Cannot serialize operator ${JSON.stringify(item.op)}: it is emitted raw, and parsing ` +
          `the result would fail (one of ${PDX_OPERATORS.join(" ")})`
      );
    }
    const value =
      item.value.kind === "container" ? containerText(item.value, depth) : scalarText(item.value);
    return `${indent}${key} ${item.op} ${value}`;
  }
  if (item.kind === "container") {
    return `${indent}${containerText(item, depth)}`;
  }
  if (item.kind === "param") {
    return `${indent}${paramBlockText(item, depth)}`;
  }
  if (item.kind === "param-text") {
    return `${indent}${paramTextRegion(item, depth)}`;
  }
  return `${indent}${scalarText(item)}`;
}

/**
 * Writes items back to PDXScript in this package's one canonical style: tabs,
 * a blank line between top-level items, and a final newline.
 *
 * The round trip it promises is semantic, not byte-identical, and it is a
 * claim about *items* rather than documents:
 *
 * ```ts
 * const document = parse(source);
 * const reparsed = parse(serialize(document.items));
 * withoutLines(reparsed.items); // equals withoutLines(document.items)
 * ```
 *
 * `withoutLines` is part of the claim, not a convenience. Canonical spacing
 * moves entries onto different lines, so `line` differs even where nothing
 * else does. The documents differ in other ways too: repaired input is
 * written in its repaired form, so the reparse reports no diagnostics.
 * Comments, blank lines and semicolons are dropped, `2.0` becomes `2`, and a
 * bare string that would read back as something else is quoted. A second
 * emission of the reparsed items is byte-identical to the first.
 *
 * @throws Error for a tree that could not be written and read back as itself:
 * an operator outside {@link PDX_OPERATORS}, a scalar {@link scalarText}
 * refuses, a region body that would read back as a different node, a
 * non-boolean region negation, nesting past {@link MAX_NESTING_DEPTH}, or a
 * document whose first character would be a byte-order mark.
 *
 * The last two are checked only here, so a constructor-built tree can still
 * reach them: depth is a property of an assembled tree that `container()`
 * cannot see, and whether a value opens the document is a property of its
 * position. The rest are refused by the constructors as well, so hitting one
 * of those means a tree assembled as bare object literals.
 */
export function serialize(items: readonly PdxItem[]): string {
  const text = items.map((item) => serializeItem(item, 0)).join("\n\n") + "\n";
  // The write side of the file boundary. `parse` reads a leading `U+FEFF` as
  // this document's encoding mark and removes it, so emitting one here would
  // produce a file that reads back short a character — `scalar("﻿foo")`
  // coming back as `foo`. Anywhere but the first character it is ordinary
  // text and needs no guard.
  if (text.startsWith(BYTE_ORDER_MARK)) {
    throw new Error(
      "Cannot serialize a document whose first character is U+FEFF: that is read back as a " +
        "byte-order mark and stripped (quote the value, or put it after another item)"
    );
  }
  return text;
}
