/**
 * Serializer for PDXScript. One canonical rendering — see GRAMMAR.md.
 *
 * The bare-vs-quoted decision is symmetric with the lexer: a `str` renders
 * bare only if re-lexing it would yield the same single `str` token
 * (`isBareToken` for the character class, `classifyUnquoted` to reject text
 * that would come back as a bool, num, or var). Anything unrepresentable —
 * a key or header that cannot render bare, an exponent-notation number —
 * throws rather than emitting output that reads back differently.
 */

import type { PdxContainer, PdxEntry, PdxItem, PdxScalar } from "./ast.ts";
import { classifyUnquoted, isBareToken } from "./lexer.ts";

function isBareString(value: string): boolean {
  return isBareToken(value) && classifyUnquoted(value).kind === "str";
}

function scalarText(scalar: PdxScalar): string {
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
  if (container.items.every((item) => item.kind !== "entry" && item.kind !== "container")) {
    return `${head}{ ${container.items.map((item) => scalarText(item as PdxScalar)).join(" ")} }`;
  }
  const indent = "\t".repeat(depth);
  const body = container.items.map((item) => serializeItem(item, depth + 1)).join("\n");
  return `${head}{\n${body}\n${indent}}`;
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
  return `${indent}${scalarText(item)}`;
}

export function serialize(entries: readonly PdxEntry[]): string {
  return entries.map((entry) => serializeItem(entry, 0)).join("\n\n") + "\n";
}
