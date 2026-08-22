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
import type { TsValue } from "../render/emitter.ts";
import { conversionFor, refTypesEntries } from "../render/writer.ts";
import { formOfShape } from "./authored-form.ts";
import { contentShape } from "./content-shape.ts";
import type { EmittedField } from "./fields.ts";
import type { FieldScope } from "./scope-context.ts";

/**
 * The literals a doc row may carry: the admitted set, except where lowering
 * changes the authored representation. `admits.literals` speaks the game's
 * tokens because the corpus gate measures shipped files, but boolean fields
 * author as `true`/`false` while admitting `yes`/`no` — printing those tokens
 * in a docs table tells an author to pass strings that do not type-check.
 * Booleans are the only conversion with that mismatch, and their admitted
 * sets are exactly the subsets of `{yes, no}`, so those are omitted; the
 * member type `boolean` already says everything the row would.
 */
export function authoredLiterals(literals: readonly string[] | undefined): {
  readonly literals?: readonly string[];
} {
  if (literals === undefined || literals.every((token) => token === "yes" || token === "no")) {
    return {};
  }
  return { literals };
}

/**
 * The scalar-lowering half of a field's metadata: how to turn the authored
 * value into an id, and — when the rules say every admitted form is a
 * reference — which registries that id must come from. The second half is what
 * lets `buildMod` hold an own-prefixed reference to the registry it names.
 */
export function scalarMetadata(value: TsValue): string[] {
  return [`conversion: ${JSON.stringify(conversionFor(value))}`, ...refTypesEntries(value)];
}

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
