/**
 * How one lowered field describes itself: the runtime metadata literal, the
 * member-type text helpers, and the admitted-shape descriptors the corpus gate
 * measures against. Every lowering in `fields.ts` and its siblings speaks
 * through these, which is what keeps the metadata, the member type, and the
 * gate's view of a field from disagreeing.
 */

import { isOptional, isRepeated, type RuleField } from "../cwt/model.ts";
import { camelCase } from "../naming.ts";
import type { ContentFieldOverride } from "../overlay/index.ts";
import { contentConversionOf, type TsValue } from "../render/emitter.ts";
import { refTypesEntries } from "../render/writer.ts";
import { formOfShape } from "./authored-form.ts";
import { contentShape } from "./content-shape.ts";
import type { EmittedField } from "./fields.ts";
import type { FieldScope } from "./scope-context.ts";

/**
 * Selects literal tokens suitable for generated authoring documentation.
 * It omits `yes`/`no`-only sets because those tokens author as booleans instead of strings.
 */
export function authoredLiterals(literals: readonly string[] | undefined): {
  /** Literal strings suitable for the generated authoring documentation. */
  readonly literals?: readonly string[];
} {
  if (literals === undefined || literals.every((token) => token === "yes" || token === "no")) {
    return {};
  }
  return { literals };
}

/**
 * Renders the conversion metadata for an authored scalar.
 * Closed reference values also include the registry names their ids must satisfy.
 */
export function scalarMetadata(value: TsValue): string[] {
  return [
    `conversion: ${JSON.stringify(contentConversionOf(value.conversion))}`,
    ...refTypesEntries(value),
  ];
}

/** Renders an array type and preserves the grouping of union element types. */
export function arrayType(type: string): string {
  return type.includes(" | ") ? `(${type})[]` : `${type}[]`;
}

/**
 * Whether the key itself may appear more than once in a definition body.
 *
 * A `valueList` is the exception: its member is an array, but the writer emits
 * one key holding a brace list rather than repeated siblings.
 */
export function repeatsSiblings(field: RuleField, shape: string): boolean {
  return isRepeated(field.cardinality) && shape !== "valueList";
}

/** One evidence-backed optionality decision, shared by every generated member. */
export function memberOptional(
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined
): boolean {
  return override?.optional === true || group.every((field) => isOptional(field.cardinality));
}

/**
 * Renders the runtime descriptor for one generated content field.
 * Shape-specific entries can be appended through `extras`.
 */
export function metadata(
  field: RuleField,
  name: string,
  shape: string,
  extras: readonly string[] = []
): string {
  const repeated = repeatsSiblings(field, shape);
  const members = [
    `key: ${JSON.stringify(name)}`,
    `member: ${JSON.stringify(camelCase(name))}`,
    `shape: ${JSON.stringify(shape)}`,
    `form: ${JSON.stringify(formOfShape({ shape: contentShape(shape), repeated }))}`,
    ...extras,
  ];
  if (repeated) {
    members.push("repeated: true");
  }
  return `{ ${members.join(", ")} }`;
}

/**
 * Appends one entry to an already-rendered field descriptor.
 *
 * Overlay corrections applied after a shape has been chosen (`pickOrdinary`)
 * have no other way in: the descriptor is text by then, and threading every
 * overlay property through each {@link metadata} call site would make every
 * lowering carry properties only one of them can use.
 */
export function withMetadataEntry(descriptor: string, entry: string): string {
  return `${descriptor.slice(0, descriptor.lastIndexOf("}")).trimEnd()}, ${entry} }`;
}

/** The descriptor for a shape whose whole value is one scalar the rules type. */
export function admitsScalars(
  field: RuleField,
  shape: string,
  value: TsValue | null
): Omit<EmittedField, "field"> {
  return {
    shape,
    repeated: repeatsSiblings(field, shape),
    ...(value?.literals === undefined ? {} : { literals: value.literals }),
  };
}

/** The descriptor for a block shape, carrying the scope its closures run in. */
export function admitsBlock(
  field: RuleField,
  shape: string,
  scope?: FieldScope,
  clause?: "trigger" | "effect"
): Omit<EmittedField, "field"> {
  return {
    shape,
    repeated: repeatsSiblings(field, shape),
    ...(scope === undefined ? {} : { scope: scope.scopes }),
    ...(clause === undefined ? {} : { clause }),
  };
}
