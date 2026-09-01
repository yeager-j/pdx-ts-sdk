/** Shared structural interpretation of generated content field metadata. */
import {
  aliasStructFieldsOf,
  authoredForm,
  type ContentDualArm,
  type ContentDualField,
  type ContentField,
} from "./schema.ts";

type NestedContentField = Extract<
  ContentField,
  {
    readonly shape: "struct" | "triggerStruct" | "aliasStruct" | "structMap" | "repeatedStruct";
  }
>;

interface ContentFieldRecordOccurrence {
  readonly value: unknown;
  readonly index?: number;
  readonly key?: string;
}

interface ContentFieldRecordDescentBase {
  readonly kind: "records";
  readonly field: NestedContentField;
  readonly fields: readonly ContentField[];
  readonly original: unknown;
}

interface ContentFieldSingleDescent extends ContentFieldRecordDescentBase {
  readonly collection: "single";
  readonly occurrences: readonly [ContentFieldRecordOccurrence];
}

interface ContentFieldListDescent extends ContentFieldRecordDescentBase {
  readonly collection: "list";
  readonly occurrences: readonly ContentFieldRecordOccurrence[];
}

interface ContentFieldMapDescent extends ContentFieldRecordDescentBase {
  readonly collection: "map";
  readonly occurrences: readonly (ContentFieldRecordOccurrence & { readonly key: string })[];
}

/** One field's normalized route to its immediate nested fields, if it has any. */
export type ContentFieldDescent =
  | { readonly kind: "leaf" }
  | { readonly kind: "field"; readonly field: ContentDualArm; readonly value: unknown }
  | ContentFieldSingleDescent
  | ContentFieldListDescent
  | ContentFieldMapDescent;

/** One normalized record occurrence reached through a nested content field. */
export type ContentFieldRecord = ContentFieldRecordOccurrence;

function isReference(value: unknown): value is { readonly id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly id?: unknown }).id === "string"
  );
}

/**
 * Selects the ordinary field arm that accepts a dual field's authored value.
 *
 * A reference is the one value whose runtime shape cannot place it: it is an
 * `{ id }` object that lowers as a scalar. An arm's declared conversion settles
 * that case before ordinary authored-form matching. A value no arm accepts is
 * refused rather than guessed, since generated types should make it unreachable.
 */
export function dualArm(field: ContentDualField, value: unknown): ContentDualArm {
  if (isReference(value)) {
    const reference = field.arms.find(
      (candidate) =>
        candidate.form === "scalar" && "conversion" in candidate && candidate.conversion === "ref"
    );
    if (reference !== undefined) {
      return reference;
    }
  }
  const form = authoredForm(value);
  const arm = field.arms.find((candidate) => candidate.form === form);
  if (arm === undefined) {
    const declared = field.arms.map((candidate) => candidate.form).join(" or ");
    throw new Error(
      `Field "${field.key}" was given a ${form} value, and its declarations accept ${declared}`
    );
  }
  return arm;
}

function listDescent(
  field: NestedContentField,
  fields: readonly ContentField[],
  value: unknown
): ContentFieldListDescent {
  return {
    kind: "records",
    collection: "list",
    field,
    fields,
    original: value,
    occurrences: (value as readonly unknown[]).map((item, index) => ({ value: item, index })),
  };
}

function recordFields(field: NestedContentField): readonly ContentField[] {
  return field.shape === "aliasStruct" ? aliasStructFieldsOf(field.category) : field.fields;
}

/** Normalizes every structural `ContentField` shape into dual or record descent. */
export function contentFieldDescent(field: ContentField, value: unknown): ContentFieldDescent {
  switch (field.shape) {
    case "dual":
      return { kind: "field", field: dualArm(field, value), value };
    case "struct": {
      const fields = recordFields(field);
      if (field.repeated === true || field.wrapped === true) {
        return listDescent(field, fields, value);
      }
      return {
        kind: "records",
        collection: "single",
        field,
        fields,
        original: value,
        occurrences: [{ value }],
      };
    }
    case "triggerStruct":
    case "aliasStruct": {
      const fields = recordFields(field);
      if (field.repeated === true) {
        return listDescent(field, fields, value);
      }
      return {
        kind: "records",
        collection: "single",
        field,
        fields,
        original: value,
        occurrences: [{ value }],
      };
    }
    case "structMap":
    case "repeatedStruct":
      return {
        kind: "records",
        collection: "map",
        field,
        fields: recordFields(field),
        original: value,
        occurrences: Object.entries(value as Readonly<Record<string, unknown>>).map(
          ([key, item]) => ({ key, value: item })
        ),
      };
    case "value":
    case "valueList":
    case "trigger":
    case "effect":
    case "economicResources":
    case "economicResourceOperation":
    case "economicResourcesNoProduce":
    case "triggeredModifierBlock":
    case "modifierBlock":
    case "inlineModifiers":
    case "inlineTrigger":
    case "weightBlock":
    case "weightBlockWithLoc":
    case "weightedEvents":
    case "scalarMap":
      return { kind: "leaf" };
  }
}

/** Rewrites normalized record occurrences while preserving their authored collection form. */
export function mapContentFieldRecords(
  descent: Extract<ContentFieldDescent, { readonly kind: "records" }>,
  rewrite: (occurrence: ContentFieldRecord) => unknown
): unknown {
  const rewritten = descent.occurrences.map(rewrite);
  if (rewritten.every((value, index) => value === descent.occurrences[index]?.value)) {
    return descent.original;
  }
  switch (descent.collection) {
    case "single":
      return rewritten[0];
    case "list":
      return rewritten;
    case "map":
      return Object.fromEntries(
        descent.occurrences.map((occurrence, index) => [occurrence.key, rewritten[index]])
      );
  }
}

/** Adds a record occurrence's shared index or map-key segment to an underscore path. */
export function contentFieldRecordPath(
  path: string,
  fieldKey: string,
  occurrence: ContentFieldRecord
): string {
  const fieldPath = path === "" ? fieldKey : `${path}_${fieldKey}`;
  const segment = occurrence.index ?? occurrence.key;
  return segment === undefined ? fieldPath : `${fieldPath}_${segment}`;
}
