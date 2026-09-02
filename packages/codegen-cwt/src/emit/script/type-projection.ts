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

/**
 * Renders the index-signature type admitted by an open-keyed block.
 *
 * A reference-keyed map indexes by `string` rather than its branded reference:
 * the brand is an object, and an object cannot be an index-signature key.
 */
export function mapType(emitter: Emitter, map: MapValue): string {
  const value = emitter.typeOf(map.value);
  const entry =
    map.comparison === true ? `${value} | readonly [${emitter.use("PdxOp")}, ${value}]` : value;
  return `{ readonly [${map.keyName}: ${map.indexType}]: ${entry} }`;
}

/**
 * The widest maximum worth spelling as a tuple union.
 *
 * Each permitted length becomes one arm. A `0..100` range would create 101
 * arms of up to 100 members, obscuring the rule more than an array does. Eight
 * is the widest finite union the current rules produce.
 */
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
  // Only an array item union needs parentheses: `A | B[]` means one A beside
  // an array of B, while a tuple element already ends at its comma.
  const element = item.includes(" | ") ? `(${item})` : item;
  return cardinality.min === 0
    ? `readonly ${element}[]`
    : `readonly [${Array.from({ length: cardinality.min }, () => item).join(", ")}, ...${element}[]]`;
}

/**
 * Renders one repeated script member from its single-occurrence type.
 *
 * A repeated comparison is a non-empty list of operator/operand pairs. A
 * plain array of their union would accept `[">", 2]` as two bare operands and
 * emit two keys where the author intended one comparison.
 */
export function repeatedMemberType(
  emitter: Emitter,
  value: ArgValue,
  single: string,
  cardinality: Cardinality
): string {
  if (value.kind === "comparison") {
    const operand = emitter.typeOf(value.value);
    const pair = `readonly [${emitter.use("PdxOp")}, ${operand}]`;
    return `${single} | readonly [${pair}, ...(${pair})[]]`;
  }
  return cardinalityArrayType(single, cardinality);
}
