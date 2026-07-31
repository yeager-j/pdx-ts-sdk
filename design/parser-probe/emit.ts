/**
 * Lowers `ParsedEntry` trees into `src/ast.ts`'s `PdxValue` and delegates to
 * the shared serializer — the probe deliberately has no serializer of its
 * own; one emitter for authored and parsed content is a thesis point.
 *
 * `var` scalars lower to the AST's first-class `var` node, which re-emits as
 * the bare `@name` — a reference stays a reference. (The probe originally
 * lowered vars to bare strings, leaning on the old serializer's BARE_STRING;
 * the shared AST grew a `var` node when it moved to @pdx-ts/pdxscript, whose
 * symmetric quoting rule would promote such strings.) `math` keeps the
 * probe's recorded decision: emitting it here throws loudly — though the
 * package it fed now carries `@[ ... ]` verbatim end to end.
 */

import { serialize, type PdxEntry, type PdxScalar, type PdxValue } from "@pdx-ts/pdxscript";

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
      return { kind: "var", name: scalar.name };
    case "math":
      throw new Error(
        `Cannot emit inline math ${scalar.source}: @[ ... ] semantics are deferred — ` +
          "the probe carries it at token level only"
      );
  }
}

function lowerValue(value: ParsedValue): PdxValue {
  if (value.kind === "block") {
    return { kind: "container", items: value.entries.map(lowerEntry) };
  }
  if (value.kind === "list") {
    return { kind: "container", items: value.items.map(lowerScalar) };
  }
  return lowerScalar(value);
}

export function lowerEntry(entry: ParsedEntry): PdxEntry {
  return { kind: "entry", key: entry.key, op: entry.op, value: lowerValue(entry.value) };
}

export function lowerEntries(entries: readonly ParsedEntry[]): PdxEntry[] {
  return entries.map(lowerEntry);
}

export function emitEntries(entries: readonly ParsedEntry[]): string {
  return serialize(lowerEntries(entries));
}
