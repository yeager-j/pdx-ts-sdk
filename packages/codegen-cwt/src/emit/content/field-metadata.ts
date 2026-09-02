/**
 * How one projected field describes itself: the runtime metadata literal, the
 * member-type text helpers, and the admitted-shape descriptors the corpus gate
 * measures against. Every projection in `field-projection.ts` and its siblings speaks
 * through these, which is what keeps the metadata, the member type, and the
 * gate's view of a field from disagreeing.
 */

import { isOptional, isRepeated, type RuleField } from "../../cwt/model.ts";
import { formOfShape } from "../../lower/authored-form.ts";
import type { EmittedField } from "../../lower/content-model.ts";
import { contentShape } from "../../lower/content-shape.ts";
import { contentConversionOf, type LoweredValue } from "../../lower/value.ts";
import type { ContentFieldOverride } from "../../overlay/index.ts";
import type { FieldScope } from "../scope-context.ts";
import { refTypesEntries } from "../value-metadata.ts";

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
export function scalarMetadata(value: LoweredValue): string[] {
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

/** Whether the declaration sits under a subtype arm. */
export function isConditional(field: RuleField): boolean {
  return field.conditions !== undefined && field.conditions.length > 0;
}

/**
 * One evidence-backed optionality decision, shared by every generated member
 * read flat: a member may be absent when every declaration is either optional
 * or belongs to a subtype arm that may not apply.
 */
export function memberOptional(
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined
): boolean {
  return (
    override?.optional === true ||
    group.every((field) => isOptional(field.cardinality) || isConditional(field))
  );
}

/**
 * The doc lines the flat reading writes for each subtype arm a declaration
 * sits under, innermost arm first.
 */
export function conditionDocs(field: RuleField): string[] {
  return (field.conditions ?? []).map(
    (condition) =>
      `Only when ${condition.owner} subtype ${condition.negated ? "not " : ""}` +
      `\`${condition.subtype}\` applies.`
  );
}

/** A declaration's own docs followed by its subtype-arm lines, as the flat reading documents it. */
export function fieldDocs(field: RuleField): string[] {
  return [...field.docs, ...conditionDocs(field)];
}

/**
 * Renders one field's runtime descriptor under the authoring member it is
 * finally emitted as.
 *
 * The member is an argument rather than part of the rendered text because a
 * body field colliding with a localization slot authors under a renamed member
 * (`conditionalDesc`), which the emitter only decides once the slots are known.
 * A dual repeats the member on each arm, so every arm receives the same one.
 */
export type FieldMetadata = (member: string) => string;

/**
 * Renders the runtime descriptor for one generated content field.
 * Shape-specific entries can be appended through `extras`.
 */
export function metadata(
  field: RuleField,
  name: string,
  shape: string,
  extras: readonly string[] = []
): FieldMetadata {
  const repeated = repeatsSiblings(field, shape);
  return (member) => {
    const members = [
      `key: ${JSON.stringify(name)}`,
      `member: ${JSON.stringify(member)}`,
      `shape: ${JSON.stringify(shape)}`,
      `form: ${JSON.stringify(formOfShape({ shape: contentShape(shape), repeated }))}`,
      ...extras,
    ];
    if (repeated) {
      members.push("repeated: true");
    }
    return `{ ${members.join(", ")} }`;
  };
}

/**
 * Appends one entry to a field descriptor.
 *
 * Overlay corrections applied after a shape has been chosen (`pickOrdinary`)
 * have no other way in: threading every overlay property through each
 * {@link metadata} call site would make every projection carry properties only
 * one of them can use.
 */
export function withMetadataEntry(descriptor: FieldMetadata, entry: string): FieldMetadata {
  return (member) => {
    const rendered = descriptor(member);
    return `${rendered.slice(0, rendered.lastIndexOf("}")).trimEnd()}, ${entry} }`;
  };
}

/** The descriptor for a shape whose whole value is one scalar the rules type. */
export function admitsScalars(
  field: RuleField,
  shape: string,
  value: LoweredValue | null
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
