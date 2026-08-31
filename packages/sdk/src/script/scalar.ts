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

import { scalar, type PdxOp, type PdxScalar } from "@pdx-ts/pdxscript";

import { deferLocalization } from "../authoring/deferred-localization.ts";
import {
  isLiteralText,
  isLocalizationRef,
  isLocalizedTextRecord,
  type LiteralText,
  type LocalizationRef,
  type LocalizedTextRecord,
} from "../authoring/localization.ts";
import type { ScopeName } from "../generated/scopes.ts";
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

/** Whether a value is object-shaped, counting the callable `vanilla.*` proxies. */
function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Which reference form an object-shaped value is, or null when it is none of
 * them.
 *
 * The three forms are told apart in order because only the first two announce
 * themselves. `ScopeValue` carries a `kind` discriminant and a localization
 * reference a `refKind` one; a content reference is structurally open, so
 * `id` is the whole of its runtime signature and anything reaching the last
 * arm with no string `id` is not a reference at all.
 *
 * `id` is read rather than probed with `in`: a `vanilla.*` trie is a Proxy
 * over a bare function, and a membership test that reached the function
 * target would answer for the target rather than for the trie.
 */
function referenceForm(value: object): "scope" | "localization" | "typed" | null {
  if ("kind" in value && value.kind === "scope-ref") {
    return "scope";
  }
  if (isLocalizationRef(value)) {
    return "localization";
  }
  return typeof (value as { readonly id?: unknown }).id === "string" ? "typed" : null;
}

/**
 * Whether an authored value can stand in a reference position: one of the
 * three reference forms, or a plain value a reference-or-literal rule accepts.
 *
 * A caller with a better diagnostic than {@link refId}'s own asks this first,
 * so that its message rather than the generic refusal is the one an author
 * sees.
 */
export function isReferenceValue(value: unknown): boolean {
  return isObjectLike(value) ? referenceForm(value) !== null : true;
}

/** Describes an authored value for a diagnostic, without throwing on its shape. */
function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "a value that cannot be described";
  }
}

/**
 * The refusal shared by every reference position: what was passed, and the
 * forms that would have been read. `subject` names the position when the
 * caller knows it.
 */
function refusedReference(value: unknown, subject: string): Error {
  return new Error(
    `${subject} was given ${describeValue(value)}, which is not a reference. Write a content ` +
      "reference (a definition's item, `vanilla.*`, `external.*`), a scope value (`ctx.self`, " +
      "an event target), a localization reference, or the id as a bare string."
  );
}

/**
 * Refuses an object-shaped value that no reference position can read, naming
 * the field that holds it.
 *
 * {@link refId} refuses the same value on its own, so this adds the field name
 * rather than the check: a caller that has one gets `"prerequisites" was
 * given {}` instead of the same refusal without a subject.
 */
export function assertReferenceValue(value: unknown, field: string): void {
  if (!isReferenceValue(value)) {
    throw refusedReference(value, `"${field}"`);
  }
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
 * path rather than an id, which is the only reason the two are told apart. A
 * localization reference is the third kind, and lowers to its key.
 *
 * `ScopeValue`'s `kind` discriminant settles that distinction rather than the
 * presence of a `path` property. A content reference is structurally open, so
 * an object that is genuinely a `<planet_class>` may carry a path of its own
 * and must still serialize the id the game requires.
 *
 * @throws Error when an object-shaped value is none of the three forms. The
 * generated types make that a compile error, so reaching it means a cast or
 * erased types — and reading `id` off such a value would emit the word
 * `undefined` as if it named content.
 */
export function refId<T extends string | number | boolean>(
  value: TypedRef<string> | ScopeValue | LocalizationRef | T
): string | T {
  if (isObjectLike(value)) {
    switch (referenceForm(value)) {
      case "scope":
        return (value as ScopeValue).path;
      case "localization":
        return (value as LocalizationRef).key;
      case "typed":
        return (value as TypedRef<string>).id;
      default:
        throw refusedReference(value, "A reference position");
    }
  }
  return value;
}

/** Anything that lowers to one PDXScript scalar. */
export type ScalarArg = string | number | boolean | TypedRef<string> | ScopeValue | LocalizationRef;

/**
 * A runtime-discriminated object form a scalar position accepts.
 *
 * `localized-text` and `literal-text` exist because a stored-key position
 * overloaded with a braced block gets both its language record and that block
 * as objects: naming the scalar arm's own object forms is what keeps
 * `{ english: "..." }` off the block arm.
 */
export type ScalarObjectKind =
  "scope-ref" | "typed-ref" | "localization-ref" | "localized-text" | "literal-text";

/** The generated block contract needed to distinguish an effect's call forms. */
export type EffectBlockDiscriminator =
  | { readonly kind: "fields" }
  | { readonly kind: "map" }
  | { readonly kind: "alias-list" }
  | { readonly kind: "wrapper"; readonly fields: readonly unknown[] | null };

function isDeclaredScalarObject(
  value: unknown,
  scalarObjectKinds: readonly ScalarObjectKind[]
): boolean {
  if (
    ((typeof value !== "object" || value === null) && typeof value !== "function") ||
    Array.isArray(value)
  ) {
    return false;
  }
  if (scalarObjectKinds.includes("scope-ref") && "kind" in value && value.kind === "scope-ref") {
    return true;
  }
  if (scalarObjectKinds.includes("localization-ref") && isLocalizationRef(value)) {
    return true;
  }
  if (scalarObjectKinds.includes("literal-text") && isLiteralText(value)) {
    return true;
  }
  if (scalarObjectKinds.includes("localized-text") && isLocalizedTextRecord(value)) {
    return true;
  }
  return scalarObjectKinds.includes("typed-ref") && "id" in value && typeof value.id === "string";
}

/**
 * Lowers one authored `LocalizationInput` to the scalar the file stores.
 *
 * Dispatch order is the field's own engine sentinels, then a localization
 * reference, then the explicit spellings a mixed field admits — raw displayed
 * text, a content or scope reference — and only then inline display text. A
 * sentinel keeps precedence over English shorthand because it is an engine
 * word rather than a key; to show the word itself, write it as a language
 * record (`{ english: "default" }`).
 *
 * Recorded script has no owner yet, so inline text becomes a deferred marker
 * that the splice into a definition, an event, or a patch resolves. The result
 * is always a node rather than a string, because that marker is one.
 *
 * @param path - The generated script field path, e.g. `custom_tooltip.fail_text`.
 * @param sentinels - Engine literals this field declares beside the localization arm.
 * @throws Error If the value is none of the forms the position accepts.
 */
export function localizationScalar(
  value: unknown,
  path: string,
  sentinels: readonly string[] = []
): PdxScalar {
  if (typeof value === "string") {
    return sentinels.includes(value) ? scalar(value) : deferLocalization(value, path);
  }
  if (isLocalizationRef(value)) {
    return scalar(value.key);
  }
  if (isLiteralText(value)) {
    return scalar(value.text);
  }
  if (isLocalizedTextRecord(value)) {
    return deferLocalization(value, path);
  }
  // Asked before unwrapping, so that a value which is no reference either
  // falls to this field's own message below rather than to `refId`'s generic
  // refusal — a localization position can say what it wanted, and does.
  if (isReferenceValue(value)) {
    const lowered = refId(value as TypedRef<string> | ScopeValue);
    if (typeof lowered === "string") {
      return scalar(lowered);
    }
  }
  throw new Error(
    `"${path}" was given ${describeValue(value)}, which names no localization key. Write ` +
      "display text as a string or a language record, an existing key as a reference " +
      "(`mod.localization()`, a definition's `loc` member, `vanilla.localization()`, " +
      "`external.localization()`), and raw displayed text as `literalText()`."
  );
}

/**
 * The authored value behind one declared scalar object kind.
 *
 * The narrowing below has to remove the scalar arm by name rather than by
 * shape: a language record and a `LiteralText` are object types exactly like
 * the block arm they sit beside, so "anything object-shaped is the block" is
 * no longer a sound reading. Keying the removal off the kinds the generated
 * metadata actually declares keeps the type-level answer and the runtime
 * answer derived from one list.
 */
type ScalarObjectValue<K extends ScalarObjectKind> =
  | (K extends "localization-ref" ? LocalizationRef : never)
  | (K extends "localized-text" ? LocalizedTextRecord : never)
  | (K extends "literal-text" ? LiteralText : never)
  | (K extends "scope-ref" ? ScopeValue<ScopeName> : never)
  | (K extends "typed-ref" ? TypedRef<string> : never);

/**
 * Whether an object-shaped authored value belongs to a structured block arm.
 * Generated mixed-field metadata names every SDK scalar object kind the scalar
 * arm accepts, so this decision follows the generated contract rather than
 * treating every object as a block.
 */
export function isStructuredValue<T, K extends ScalarObjectKind>(
  value: T,
  scalarObjectKinds: readonly K[]
): value is Exclude<T, ScalarObjectValue<K> | string | number | boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return !isDeclaredScalarObject(value, scalarObjectKinds);
}

/**
 * Whether an effect's top-level scalar-or-block call receives its block arm.
 * The scalar arm's declared object kinds take precedence over the block's
 * authoring shape, so callable typed-reference proxies remain scalar values.
 */
export function isEffectBlockValue(
  value: unknown,
  scalarObjectKinds: readonly ScalarObjectKind[],
  block: EffectBlockDiscriminator
): boolean {
  if (block.kind === "alias-list") {
    return Array.isArray(value);
  }
  if (block.kind === "wrapper") {
    return block.fields === null
      ? typeof value === "function" && !isDeclaredScalarObject(value, scalarObjectKinds)
      : isStructuredValue(value, scalarObjectKinds);
  }
  return isStructuredValue(value, scalarObjectKinds);
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
 *
 * `field` names the argument in the error thrown for an empty list, which the
 * authoring types already reject and which writes no comparison at all.
 */
export function isComparisonList(
  value: ComparisonArg | readonly (readonly [PdxOp, ComparisonOperand])[],
  field: string
): value is readonly (readonly [PdxOp, ComparisonOperand])[] {
  if (Array.isArray(value) && value.length === 0) {
    throw new Error(
      `"${field}" was given an empty comparison list — write at least one ` +
        "[operator, value] pair, or omit the field"
    );
  }
  return Array.isArray(value) && Array.isArray(value[0]);
}

/**
 * The entries of an open-keyed argument, in authoring order, with omitted
 * values dropped.
 *
 * The rules say how few entries a block may hold and the type system cannot:
 * an index signature has no minimum. `field` names the argument in the error
 * thrown when `minimum` is not met.
 *
 * @example
 * ```ts
 * mapEntries({ minerals: 1000 }, "add_resource_from_debris.resources", 0);
 * // [["minerals", 1000]]
 * ```
 */
export function mapEntries<T>(
  values: { readonly [key: string]: T },
  field: string,
  minimum: number
): readonly (readonly [string, T])[] {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length < minimum) {
    throw new Error(
      `"${field}" was given ${entries.length} entries, but the rules require at least ${minimum}`
    );
  }
  return entries;
}

/**
 * The cases of a key/clause argument, in authoring order.
 *
 * Each case writes its key as a script key of the enclosing block, so a key
 * the block already writes itself would silently replace that argument.
 * `field` names the argument, and `reservedKeys` the keys the block writes,
 * in the error thrown for an empty key or a reserved key. `minimum` is the
 * case count the authoring type already states, checked again here for a
 * caller who reached the builder without it.
 *
 * @example
 * ```ts
 * caseEntries([["ethic_pacifist", isAi()]], "switch.cases", 1, ["trigger", "default"]);
 * // [["ethic_pacifist", <trigger>]]
 * ```
 */
export function caseEntries<T>(
  cases: readonly (readonly [string, T])[],
  field: string,
  minimum: number,
  reservedKeys: readonly string[]
): readonly (readonly [string, T])[] {
  if (cases.length < minimum) {
    throw new Error(
      `"${field}" was given ${cases.length} cases, but the rules require at least ${minimum}`
    );
  }
  for (const [key] of cases) {
    if (key === "") {
      throw new Error(`"${field}" was given a case with no key`);
    }
    if (reservedKeys.includes(key)) {
      throw new Error(
        `"${field}" was given the case key "${key}", which is one of the block's own ` +
          `keys (${reservedKeys.join(", ")}) — name the case after a value the selector matches`
      );
    }
  }
  return cases;
}

export function toScalar(
  value: unknown,
  booleanLiterals: readonly ("yes" | "no")[] = []
): string | number | boolean | PdxScalar {
  if (isObjectLike(value)) {
    // Same order as `localizationScalar`: this position's own message is the
    // better one, so the reference check runs before the unwrapping that
    // would otherwise throw the generic refusal.
    if (isReferenceValue(value)) {
      const lowered = refId(value as TypedRef<string> | ScopeValue);
      if (typeof lowered === "string") {
        return lowered;
      }
    }
    throw new Error(`Cannot serialize ${describeValue(value)} as an effect argument`);
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
