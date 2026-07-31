import type { PdxEntry, PdxScalar, PdxValue } from "./ast.ts";

// `/` is empirically bare: vanilla writes `script = technologies/...` unquoted.
const BARE_STRING = /^[A-Za-z0-9_.:@/-]+$/;

function serializeScalar(scalar: PdxScalar): string {
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
      if (scalar.quoted || !BARE_STRING.test(scalar.value)) {
        return `"${scalar.value}"`;
      }
      return scalar.value;
  }
}

function serializeValue(value: PdxValue, depth: number): string {
  if (value.kind === "list") {
    if (value.items.length === 0) {
      return "{}";
    }
    return `{ ${value.items.map(serializeScalar).join(" ")} }`;
  }
  if (value.kind !== "block") {
    return serializeScalar(value);
  }
  if (value.entries.length === 0) {
    return "{}";
  }
  const indent = "\t".repeat(depth);
  const body = value.entries.map((entry) => serializeEntry(entry, depth + 1)).join("\n");
  return `{\n${body}\n${indent}}`;
}

function serializeEntry(entry: PdxEntry, depth: number): string {
  const indent = "\t".repeat(depth);
  return `${indent}${entry.key} ${entry.op} ${serializeValue(entry.value, depth)}`;
}

export function serializeEntries(entries: readonly PdxEntry[]): string {
  return entries.map((entry) => serializeEntry(entry, 0)).join("\n\n") + "\n";
}
