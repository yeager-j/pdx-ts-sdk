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

function regionOpener(param: PdxParamBlock | PdxParamText): string {
  if (!isParamName(param.name)) {
    throw new Error(`Cannot serialize parameter name ${JSON.stringify(param.name)}`);
  }
  return `[[${param.negated ? "!" : ""}${param.name}]`;
}

function paramText(param: PdxParamBlock, depth: number): string {
  enterBody(depth, "region");
  const indent = "\t".repeat(depth);
  const open = regionOpener(param);
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
 * The depth guard applies here as much as to a region with a tree. Nothing is
 * emitted one level down, so it is easy to read this as a leaf — but the
 * parser does not treat it as one: reading the output back opens a region body
 * at `depth + 1` whether or not that body turns out to be a tree.
 */
function paramTextRegion(param: PdxParamText, depth: number): string {
  enterBody(depth, "region");
  return `${regionOpener(param)}${param.text}]`;
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
    return `${indent}${paramText(item, depth)}`;
  }
  if (item.kind === "param-text") {
    return `${indent}${paramTextRegion(item, depth)}`;
  }
  return `${indent}${scalarText(item)}`;
}

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
