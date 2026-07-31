/**
 * Lowers `ParsedEntry` trees into `src/ast.ts`'s `PdxValue` and delegates to
 * the shared serializer — the probe deliberately has no serializer of its
 * own; one emitter for authored and parsed content is a thesis point.
 *
 * `var` scalars lower to bare strings (`@t3cost` passes the serializer's
 * BARE_STRING unquoted, so a reference re-emits as a reference). `math` has
 * no lowering: `@[ ... ]` cannot survive the serializer's quoting rules, so
 * emitting it throws loudly — its semantics are deferred, never mangled.
 */

import type { PdxEntry, PdxScalar, PdxValue } from "../../src/ast.ts";
import { serializeEntries } from "../../src/serialize.ts";
import type { ParsedEntry, ParsedScalar, ParsedValue } from "./parser.ts";

function lowerScalar(scalar: ParsedScalar): PdxScalar {
  switch (scalar.kind) {
    case "str":
      return { kind: "str", value: scalar.value, quoted: scalar.quoted };
    case "num":
      return { kind: "num", value: scalar.value };
    case "bool":
      return { kind: "bool", value: scalar.value };
    case "var":
      return { kind: "str", value: scalar.name, quoted: false };
    case "math":
      throw new Error(
        `Cannot emit inline math ${scalar.source}: @[ ... ] semantics are deferred — ` +
          "the probe carries it at token level only"
      );
  }
}

function lowerValue(value: ParsedValue): PdxValue {
  if (value.kind === "block") {
    return { kind: "block", entries: value.entries.map(lowerEntry) };
  }
  if (value.kind === "list") {
    return { kind: "list", items: value.items.map(lowerScalar) };
  }
  return lowerScalar(value);
}

export function lowerEntry(entry: ParsedEntry): PdxEntry {
  return { key: entry.key, op: entry.op, value: lowerValue(entry.value) };
}

export function lowerEntries(entries: readonly ParsedEntry[]): PdxEntry[] {
  return entries.map(lowerEntry);
}

export function emitEntries(entries: readonly ParsedEntry[]): string {
  return serializeEntries(lowerEntries(entries));
}
