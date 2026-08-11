/**
 * Serializer for PDXScript. One canonical rendering — see GRAMMAR.md.
 *
 * The bare-vs-quoted decision is symmetric with the lexer: a `str` renders
 * bare only if re-lexing it would yield the same single `str` token
 * (`isBareToken` for the character class, `classifyUnquoted` to reject text
 * that would come back as a bool, num, or var). Anything unrepresentable —
 * a key or header that cannot render bare, an exponent-notation number, a
 * string whose raw content would terminate its own quotes — throws rather
 * than emitting output that reads back differently.
 */

import type { PdxContainer, PdxItem, PdxParamBlock, PdxScalar } from "./ast.ts";
import { classifyUnquoted, isBareToken } from "./lexer.ts";

function isBareString(value: string): boolean {
  return isBareToken(value) && classifyUnquoted(value).kind === "str";
}

/** True when emitting `value` between quotes would terminate the string early. */
function hasUnescapedQuote(value: string): boolean {
  let index = 0;
  while (index < value.length) {
    if (value[index] === "\\") {
      index += 2;
      continue;
    }
    if (value[index] === '"') {
      return true;
    }
    index += 1;
  }
  return false;
}

export function scalarText(scalar: PdxScalar): string {
  switch (scalar.kind) {
    case "bool":
      return scalar.value ? "yes" : "no";
    case "num": {
      const text = String(scalar.value);
      if (text.includes("e") || text.includes("E")) {
        throw new Error(`Cannot serialize ${scalar.value}: PDXScript has no exponent notation`);
      }
      return text;
    }
    case "str":
      if (scalar.quoted || !isBareString(scalar.value)) {
        if (hasUnescapedQuote(scalar.value)) {
          throw new Error(
            `Cannot serialize string ${JSON.stringify(scalar.value)}: ` +
              "it contains an unescaped quote (content is emitted raw; see GRAMMAR.md)"
          );
        }
        return `"${scalar.value}"`;
      }
      return scalar.value;
    case "var":
      if (!scalar.name.startsWith("@") || !isBareToken(scalar.name)) {
        throw new Error(`Cannot serialize variable reference ${JSON.stringify(scalar.name)}`);
      }
      return scalar.name;
    case "math":
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

function containerText(container: PdxContainer, depth: number): string {
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

function paramText(param: PdxParamBlock, depth: number): string {
  if (!isBareToken(param.name)) {
    throw new Error(`Cannot serialize parameter name ${JSON.stringify(param.name)}`);
  }
  const indent = "\t".repeat(depth);
  const open = `[[${param.negated ? "!" : ""}${param.name}]`;
  if (param.items.length === 0) {
    return `${open}\n${indent}]`;
  }
  const body = param.items.map((item) => serializeItem(item, depth + 1)).join("\n");
  return `${open}\n${body}\n${indent}]`;
}

function serializeItem(item: PdxItem, depth: number): string {
  const indent = "\t".repeat(depth);
  if (item.kind === "entry") {
    if (!isBareToken(item.key)) {
      throw new Error(
        `Cannot serialize key ${JSON.stringify(item.key)}: quoted keys are deferred (GRAMMAR.md)`
      );
    }
    const value =
      item.value.kind === "container" ? containerText(item.value, depth) : scalarText(item.value);
    return `${indent}${item.key} ${item.op} ${value}`;
  }
  if (item.kind === "container") {
    return `${indent}${containerText(item, depth)}`;
  }
  if (item.kind === "param") {
    return `${indent}${paramText(item, depth)}`;
  }
  return `${indent}${scalarText(item)}`;
}

export function serialize(items: readonly PdxItem[]): string {
  return items.map((item) => serializeItem(item, 0)).join("\n\n") + "\n";
}
