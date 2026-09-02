/** TypeScript projection for render-free script argument shapes. */

import type { Cardinality } from "../../cwt/model.ts";
import { canonicalScopeSet, type ArgValue, type MapValue } from "../../lower/script-shape.ts";
import type { Emitter } from "../typescript.ts";

/** Renders a supported-scope set as a TypeScript type. */
export function scopeType(
  scopes: readonly string[],
  index: ReadonlyMap<string, string>
): string | null {
  const canonical = canonicalScopeSet(scopes, index);
  if (canonical === "universal") {
    return "ScopeName";
  }
  return canonical === null ? null : canonical.map((scope) => JSON.stringify(scope)).join(" | ");
}

/** Renders the index-signature type admitted by an open-keyed block. */
export function mapType(emitter: Emitter, map: MapValue): string {
  const value = emitter.useValue(map.value).type;
  const entry =
    map.comparison === true ? `${value} | readonly [${emitter.use("PdxOp")}, ${value}]` : value;
  return `{ readonly [${map.keyName}: ${map.indexType}]: ${entry} }`;
}

const TUPLE_UNION_LIMIT = 8;

/** Renders the readonly tuple or array type admitted by a cardinality. */
export function cardinalityArrayType(item: string, cardinality: Cardinality): string {
  const tuple = (length: number): string =>
    `readonly [${Array.from({ length }, () => item).join(", ")}]`;
  if (cardinality.max !== null && cardinality.max <= TUPLE_UNION_LIMIT) {
    return Array.from({ length: cardinality.max - cardinality.min + 1 }, (_, index) =>
      tuple(cardinality.min + index)
    ).join(" | ");
  }
  const element = item.includes(" | ") ? `(${item})` : item;
  return cardinality.min === 0
    ? `readonly ${element}[]`
    : `readonly [${Array.from({ length: cardinality.min }, () => item).join(", ")}, ...${element}[]]`;
}

/** Renders one repeated script member from its single-occurrence type. */
export function repeatedMemberType(
  emitter: Emitter,
  value: ArgValue,
  single: string,
  cardinality: Cardinality
): string {
  if (value.kind === "comparison") {
    const operand = emitter.useValue(value.value).type;
    const pair = `readonly [${emitter.use("PdxOp")}, ${operand}]`;
    return `${single} | readonly [${pair}, ...(${pair})[]]`;
  }
  return cardinalityArrayType(single, cardinality);
}
