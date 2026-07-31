/**
 * Tree comparison support. Source lines exist for diagnostics, not identity:
 * re-parsing serialized output moves every line, so fixpoint and differential
 * tests compare trees with lines stripped.
 */

import type { PdxItem, PdxValue } from "./ast.ts";

function stripValue(value: PdxValue): PdxValue {
  if (value.kind === "container") {
    return {
      kind: "container",
      ...(value.header !== undefined ? { header: value.header } : {}),
      items: value.items.map(stripItem),
    };
  }
  return value;
}

function stripItem(item: PdxItem): PdxItem {
  if (item.kind === "entry") {
    return { kind: "entry", key: item.key, op: item.op, value: stripValue(item.value) };
  }
  if (item.kind === "container") {
    return stripValue(item);
  }
  if (item.kind === "param") {
    return {
      kind: "param",
      name: item.name,
      negated: item.negated,
      items: item.items.map(stripItem),
    };
  }
  return item;
}

/** The same tree without source lines, for structural equality. */
export function withoutLines(items: readonly PdxItem[]): readonly PdxItem[] {
  return items.map(stripItem);
}
