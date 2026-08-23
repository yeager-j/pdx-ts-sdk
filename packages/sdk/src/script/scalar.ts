/**
 * Lowering an authored argument value to a PDXScript scalar.
 *
 * A branded reference (`vanilla.technology("tech_lasers_1")`) and a scope
 * reference (`eventTarget<"planet">("colony")`) are objects at authoring time
 * and one bare word in the output. Every place that takes an argument has to
 * unwrap them the same way, so the unwrapping lives here rather than in
 * whichever module happened to need it first — the content writer, effect
 * recorder, and scripted trigger/effect bindings all do.
 *
 * The navigable `vanilla.*` tries (`src/identifiers/trie.ts`) are Proxies
 * built over a bare function so the same value stays both callable and
 * navigable — `typeof` on such a Proxy reflects the function target, so a
 * gate on `typeof value === "object"` alone silently skips them. `refId` is
 * the one place that owns that representation and gate.
 */

import type { PdxOp, PdxScalar } from "@pdx-ts/pdxscript";

import type { ScopeValue } from "./effects/types.ts";
import { scriptValueScalar, type ScriptValue } from "./trigger-core.ts";

declare const refBrand: unique symbol;

/**
 * A reference to a key defined by some content type.
 *
 * The rules say a field holds a `<technology>`, but which technologies exist
 * is decided by the game install, not by the rules — so the brand is optional
 * and a raw id string still assigns. When the parser slice lands it can narrow
 * these to real unions without breaking a single caller.
 */
export interface TypedRef<T extends string> {
  readonly id: string;
  readonly [refBrand]?: T;
}

/**
 * Resolves an authored reference to the bare word the game expects, passing
 * plain values through.
 *
 * Some rules are overloaded between a reference and a literal —
 * `has_building` accepts both `<building>` and a bool — so this has to handle
 * either. A scope value (`ctx.self`, an event target) is a reference too, and
 * rules overload against those as freely: `is_planet_class` takes a
 * `<planet_class>` or any scope the game coerces to a planet. It lowers to its
 * path rather than an id, which is the only reason the two are told apart.
 *
 * `ScopeValue`'s `kind` discriminant settles that distinction rather than the
 * presence of a `path` property. A content reference is structurally open, so
 * an object that is genuinely a `<planet_class>` may carry a path of its own
 * and must still serialize the id the game requires.
 */
export function refId<T extends string | number | boolean>(
  value: TypedRef<string> | ScopeValue | T
): string | T {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    if ("kind" in value && value.kind === "scope-ref") {
      return value.path;
    }
    return (value as TypedRef<string>).id;
  }
  return value;
}

/** Anything that lowers to one PDXScript scalar. */
export type ScalarArg = string | number | boolean | TypedRef<string> | ScopeValue;

export type ScalarObjectKind = "scope-ref" | "typed-ref";

/**
 * Whether an object-shaped authored value belongs to a structured block arm.
 * Generated mixed-field metadata names every SDK scalar object kind the scalar
 * arm accepts, so this decision follows the generated contract rather than
 * treating every object as a block.
 */
export function isStructuredValue(
  value: unknown,
  scalarObjectKinds: readonly ScalarObjectKind[]
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (scalarObjectKinds.includes("scope-ref") && "kind" in value && value.kind === "scope-ref") {
    return false;
  }
  if (scalarObjectKinds.includes("typed-ref") && "id" in value && typeof value.id === "string") {
    return false;
  }
  return true;
}

/** An operand a comparison argument compares against. */
export type ComparisonOperand = ScriptValue | boolean;

/** One authored comparison: a bare operand, or an operator paired with one. */
export type ComparisonArg = ComparisonOperand | readonly [PdxOp, ComparisonOperand];

/**
 * Whether a comparison argument holds several comparisons rather than one.
 *
 * A field the rules let recur authors its repetitions as a list of
 * operator/operand pairs. A list of bare operands is not offered and is not
 * read as one: `[">", 2]` is the single comparison `> 2`, so the repeated form
 * has to nest — `[[">", 2], ["<", 10]]`.
 */
export function isComparisonList(
  value: ComparisonArg | readonly (readonly [PdxOp, ComparisonOperand])[]
): value is readonly (readonly [PdxOp, ComparisonOperand])[] {
  return Array.isArray(value) && Array.isArray(value[0]);
}

export function toScalar(
  value: unknown,
  booleanLiterals: readonly ("yes" | "no")[] = []
): string | number | boolean | PdxScalar {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    const lowered = refId(value as TypedRef<string> | ScopeValue);
    if (typeof lowered === "string") {
      return lowered;
    }
    throw new Error(`Cannot serialize ${JSON.stringify(value)} as an effect argument`);
  }
  const lowered = typeof value === "string" ? scriptValueScalar(value) : value;
  if (
    typeof lowered === "string" &&
    (lowered === "yes" || lowered === "no") &&
    booleanLiterals.includes(lowered)
  ) {
    return lowered === "yes";
  }
  return lowered as string | number | boolean | PdxScalar;
}
