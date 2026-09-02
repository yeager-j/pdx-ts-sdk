/**
 * Projects one CWT rule field to an authoring member, its runtime metadata, and
 * the shape description the corpus gate measures it against.
 *
 * This is the half of content emission that knows nothing about registries.
 * Given a field's declarations, an overlay row and a scope context, it picks a
 * shape and returns the three things every caller needs. `emit/content/content-type.ts`
 * drives it over a `type[...]` body and over each repeated-struct field one
 * level down; the alias emitters drive it over an alias category's members.
 * Keeping the loop here is what lets those callers share one projection instead
 * of growing parallel ones that disagree.
 */

import type { DescentNode } from "../../corpus/observations.ts";
import { isRepeated, type RuleField, type RuleType } from "../../cwt/model.ts";
import { formOfShape } from "../../lower/authored-form.ts";
import type { EmittedField } from "../../lower/content-model.ts";
import { contentShape } from "../../lower/content-shape.ts";
import {
  economicResourceOperationInterior,
  triggeredModifierInterior,
  weightInterior,
} from "../../lower/field-interiors.ts";
import {
  aliasScalarFields,
  bareValuesOf,
  derivedClauseShape,
  economicResourceOperationParts,
  spliceCategory,
  structuralSpliceOf,
  triggeredModifierPotential,
  type AliasNameField,
} from "../../lower/rule-shapes.ts";
import type { LoweredValue } from "../../lower/value.ts";
import { camelCase, docComment, pascalCase } from "../../naming.ts";
import {
  type ContentFieldOverride,
  type ContentFieldShape,
  type FieldWidening,
} from "../../overlay/index.ts";
import {
  containerContext,
  contravariantScopeType,
  effectBlockArgs,
  scopeArg,
  scopeType,
  splitRootMetadata,
  withFrom,
  type FieldContext,
} from "../scope-context.ts";
import type { Emitter } from "../typescript.ts";
import { refTypesEntries } from "../value-metadata.ts";
import { assertedArity, assertedAssetPath, assertedUncheckedString } from "./field-assertions.ts";
import {
  admitsBlock,
  admitsScalars,
  arrayType,
  fieldDocs,
  metadata,
  scalarMetadata,
  withMetadataEntry,
  type FieldMetadata,
} from "./field-metadata.ts";
import type { DocTable, FieldOmissionRow } from "./field-rows.ts";
import {
  projectScalarMap,
  projectStruct,
  projectStructMap,
  projectTriggerStruct,
} from "./field-structs.ts";

export {
  authoredLiterals,
  fieldDocs,
  memberOptional,
  metadata,
  repeatsSiblings,
  type FieldMetadata,
} from "./field-metadata.ts";

/**
 * The TypeScript projection and conformance evidence for one supported field.
 * This is an emission result, not the semantic projection model.
 */
export interface FieldProjection {
  /**
   * The TypeScript type exposed on the generated authoring member, as plain
   * type text. The field-docs ledger records this spelling, so it carries no
   * comments even when {@link FieldProjection.documentedMemberType} does.
   */
  readonly memberType: string;
  /**
   * The same type with JSDoc on the members of an inline object type, for the
   * emitted interface. Only projections that build such a type supply it; read it
   * through {@link emittedMemberType} rather than directly.
   */
  readonly documentedMemberType?: string;
  /** Renders the runtime `ContentField` descriptor for the emitted member. */
  readonly metadata: FieldMetadata;
  /**
   * The field forms admitted by corpus conformance checks.
   * Its shape and repetition must match {@link metadata}.
   */
  readonly admits: Omit<EmittedField, "field">;
  /**
   * Marks a struct whose anonymous repetition is nested inside one key.
   * Dual projection uses this to distinguish the member's authored form.
   */
  readonly wrapped?: boolean;
  /**
   * Documentation contributed by projection in addition to the CWT declaration.
   * Use it for author-facing constraints introduced by an overlay.
   */
  readonly docs?: readonly string[];
  /** Extra top-level declarations a nested struct level needed, prepended by the caller. */
  readonly code?: string;
  /** Every name {@link FieldProjection.code} exports, for the public barrel's check. */
  readonly exportedNames?: readonly string[];
  /** Rows bubbled up from a nested struct level, their paths already prefixed. */
  readonly unsupported?: readonly FieldOmissionRow[];
  /**
   * Documentation rows for every field table declared by {@link code}.
   * Each table identifies its generated field constant directly.
   */
  readonly docTables?: readonly DocTable[];
  /**
   * Admitted forms for members inside this field's nested block.
   * Paths are rooted at the outer field and include every generated level.
   */
  readonly nested?: readonly EmittedField[];
  /**
   * Corpus-reader descents that reach the fields in {@link nested}.
   * Keep both collections paired so every described interior is measurable.
   */
  readonly descents?: readonly DescentNode[];
}

/**
 * The type text to write into the emitted interface, which documents the
 * members of an inline object type where the projection described them.
 */
export function emittedMemberType(projected: FieldProjection): string {
  return projected.documentedMemberType ?? projected.memberType;
}

/**
 * Registers the SDK imports required by an overlay widening's free-form type.
 * Call it when the widening joins a generated member type.
 */
export function useWideningSymbols(emitter: Emitter, widening: FieldWidening | undefined): void {
  for (const symbol of widening?.symbols ?? []) {
    emitter.use(symbol);
  }
}

/**
 * Inlines subtype arms into an ordinary field list while preserving declaration order.
 * An inlined field keeps its declared cardinality and records the arm it came
 * from in {@link RuleField.conditions}; whether that makes the member optional
 * is decided where the member is emitted.
 */
export function flatten(fields: readonly RuleField[], typeName: string): RuleField[] {
  return fields.flatMap((field) => {
    if (field.key.kind !== "subtype") {
      return [field];
    }
    if (field.type.kind !== "block") {
      return [];
    }
    const condition = { subtype: field.key.name, negated: field.key.negated, owner: typeName };
    return flatten(field.type.fields, typeName).map((inner) => ({
      ...inner,
      conditions: [...(inner.conditions ?? []), condition],
    }));
  });
}

/** Groups ordinary named fields after subtype arms have been flattened. */
export function mergeByName(
  fields: readonly RuleField[],
  typeName: string
): Map<string, RuleField[]> {
  const grouped = new Map<string, RuleField[]>();
  for (const field of flatten(fields, typeName)) {
    if (field.key.kind !== "name") {
      continue;
    }
    grouped.set(field.key.name, [...(grouped.get(field.key.name) ?? []), field]);
  }
  return grouped;
}

/**
 * Returns unkeyed alias splices declared at the definition body's top level.
 * The result preserves the order established by subtype flattening.
 */
export function topLevelSplices(fields: readonly RuleField[], typeName: string): AliasNameField[] {
  return flatten(fields, typeName).filter(
    (field): field is AliasNameField => field.key.kind === "aliasName"
  );
}

/** One top-level alias splice projected to a generated authoring member. */
export interface ProjectedSplice {
  /** The camel-cased authoring member name. */
  readonly member: string;
  /** The TypeScript type exposed on the generated authoring member. */
  readonly memberType: string;
  /** The rendered runtime field descriptor. */
  readonly metadata: string;
  /** Documentation inherited from the splice and its structural declaration. */
  readonly docs: readonly string[];
  /**
   * The block key used for keyed splice entries.
   * It is absent when entries are emitted directly into the definition body.
   */
  readonly key?: string;
  /** What the projection admits, for the corpus gate. Set whenever `key` is. */
  readonly admits?: Omit<EmittedField, "field">;
}

/**
 * Projects a structural alias splice to an optional authoring member containing ordered blocks.
 * Splices always use a repeated array because their declaration cardinality does not govern
 * individual block members.
 */
export function projectStructuralSplice(
  emitter: Emitter,
  category: string,
  docs: readonly string[]
): ProjectedSplice | null {
  const splice = structuralSpliceOf(emitter.lowerer, category);
  if (splice === null) {
    return null;
  }
  const member = camelCase(splice.memberKey);
  const shape = { shape: "aliasStruct", repeated: true } as const;
  return {
    member,
    key: splice.memberKey,
    memberType: arrayType(emitter.useAliasCategory(category, spliceTypeName(category))),
    metadata:
      `{ key: ${JSON.stringify(splice.memberKey)}, member: ${JSON.stringify(member)}, ` +
      `shape: "aliasStruct", form: ${JSON.stringify(formOfShape(shape))}, ` +
      `category: ${JSON.stringify(category)}, repeated: true }`,
    admits: shape,
    docs: [...docs, ...splice.declaration.docs],
  };
}

/** The interface one structural alias category's blocks are authored as. */
export function spliceTypeName(category: string): string {
  return `${pascalCase(category)}Fields`;
}

/**
 * Projects a top-level alias splice to a member emitted directly into the definition body.
 * Modifier splices become a closure; recognized structural categories become ordered arrays;
 * unsupported categories return `null`.
 */
export function projectTopLevelSplice(
  emitter: Emitter,
  field: AliasNameField,
  ctx: FieldContext
): ProjectedSplice | null {
  if (field.key.category !== "modifier") {
    return projectStructuralSplice(emitter, field.key.category, fieldDocs(field));
  }
  const scope = scopeType(emitter, field, ctx);
  return {
    member: "modifiers",
    memberType: `${emitter.use("ModifierClosure")}<${scopeArg(emitter, scope)}>`,
    metadata: `{ member: "modifiers", shape: "inlineModifiers" }`,
    docs: [
      "Modifiers written directly into the definition body, with no enclosing key.",
      ...fieldDocs(field),
    ],
  };
}

function authoredScalarType(type: RuleType, fallback: string): string {
  if (type.kind !== "literal") {
    return fallback;
  }
  if (type.text === "yes") {
    return "true";
  }
  return type.text === "no" ? "false" : fallback;
}

/**
 * What every localisation-key member's documentation says, appended to the
 * rule's own. One sentence, because the member appears about ninety times.
 */
const LOC_KEY_MEMBER_DOC =
  "Names a localization key: pass display text the SDK keys and emits for you, or a reference " +
  "to a key that already exists.";

function projectValue(
  emitter: Emitter,
  field: RuleField,
  name: string,
  widening: string | undefined
): FieldProjection | null {
  const value = emitter.lowerer.valueFor(field.type);
  if (value === null) {
    return null;
  }
  const repeated = isRepeated(field.cardinality);
  // `field.type.kind === "localisation"` is CWT's own way of typing a plain
  // body field as "this value names a localisation key" — the same RuleType
  // `job.condition_string` and `global_ship_design`'s name_field pointer both
  // use. It projects to the same `string`, `conversion: "identity"` shape
  // ordinary scalars do (`lower/value.ts`'s `ValueLowerer.valueFor`), so nothing
  // downstream can otherwise tell a key from any other string field;
  // `locKey: true` is that signal, and the runtime resolves the member
  // through it (SDK-303).
  const isLocKey = field.type.kind === "localisation";
  const renderedValueType = emitter.typeOf(value);
  const scalarType = isLocKey
    ? emitter.use("LocalizationInput")
    : authoredScalarType(field.type, renderedValueType);
  const base = scalarType + (widening === undefined ? "" : ` | ${widening}`);
  return {
    memberType: repeated ? arrayType(base) : base,
    // A key-typed member is written by `contentScalar` as the plain string the
    // definition walk already resolved it to, so its conversion stays the
    // identity even though the script reading of `localisation` is not.
    metadata: metadata(
      field,
      name,
      "value",
      isLocKey ? ['conversion: "identity"', "locKey: true"] : scalarMetadata(value)
    ),
    // A widening opens the set: it exists precisely to admit forms the rules do
    // not name, so the closed arm no longer describes everything legal.
    admits: admitsScalars(field, "value", widening === undefined ? value : null),
    docs: isLocKey ? [LOC_KEY_MEMBER_DOC] : undefined,
  };
}

function projectValueList(
  emitter: Emitter,
  field: RuleField,
  name: string,
  widening: string | undefined,
  quoted: boolean
): FieldProjection | null {
  const bare = bareValuesOf(field.type);
  if (bare === null) {
    return null;
  }
  const value = emitter.lowerer.unionFor(bare);
  if (value === null) {
    return null;
  }
  // `job.localized_tags = { localisation }` — the brace-list spelling of the
  // same "this value names a localisation key" declaration `projectValue` reads
  // off a bare `= localisation`. The element contract is the repeated scalar
  // one, so the element type and the runtime resolution are the same.
  const isLocKey = bare.every((type) => type.kind === "localisation");
  const elementType = isLocKey ? emitter.use("LocalizationInput") : emitter.typeOf(value);
  return {
    memberType: arrayType(elementType) + (widening === undefined ? "" : ` | ${widening}`),
    metadata: metadata(field, name, "valueList", [
      ...(isLocKey ? ['conversion: "identity"', "locKey: true"] : scalarMetadata(value)),
      ...(quoted ? ["quoted: true"] : []),
    ]),
    admits: admitsScalars(field, "valueList", widening === undefined ? value : null),
    docs: isLocKey ? [LOC_KEY_MEMBER_DOC] : undefined,
  };
}

function projectModifierBlock(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined
): FieldProjection {
  const scope = scopeType(emitter, field, ctx, override?.scope);
  return {
    memberType: `${emitter.use("ModifierClosure")}<${scopeArg(emitter, scope)}>`,
    metadata: metadata(field, name, "modifierBlock"),
    admits: admitsBlock(field, "modifierBlock", scope),
  };
}

/**
 * One projection serves both weight shapes and both routes to them: the overlay
 * requesting the shape by name, and the field splicing the matching
 * `modifier_rule` category. The `WithLoc` variant is the same block with a
 * different closure type.
 */
function projectWeightBlock(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  path: string,
  shape: "weightBlock" | "weightBlockWithLoc"
): FieldProjection {
  const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
  const closure = shape === "weightBlock" ? "WeightBlock" : "WeightBlockWithLoc";
  return {
    memberType: withFrom(emitter, `${emitter.use(closure)}<${scopeArg(emitter, scope)}>`, scope),
    metadata: metadata(field, name, shape),
    admits: admitsBlock(field, shape, scope),
    ...weightInterior(emitter.lowerer, name, path, scope),
  };
}

function projectAliasStruct(
  emitter: Emitter,
  field: RuleField,
  name: string,
  category: string
): FieldProjection {
  const memberType = emitter.useAliasCategory(category, `${pascalCase(category)}Block`);
  return {
    memberType: isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
    metadata: metadata(field, name, "aliasStruct", [`category: ${JSON.stringify(category)}`]),
    admits: admitsBlock(field, "aliasStruct"),
  };
}

/** A block holding trigger rules, authored as one `Trigger<S>` closure. */
function projectTrigger(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined
): FieldProjection {
  const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
  return {
    memberType: withFrom(emitter, `${emitter.use("Trigger")}<${scopeArg(emitter, scope)}>`, scope),
    metadata: metadata(field, name, "trigger"),
    admits: admitsBlock(field, "trigger", scope, "trigger"),
  };
}

/** A block holding effect rules, authored as one `EffectBlock` closure. */
function projectEffect(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined
): FieldProjection {
  const scope = scopeType(emitter, field, ctx, override?.scope);
  return {
    memberType: `${emitter.use("EffectBlock")}<${effectBlockArgs(emitter, scope)}>`,
    metadata: metadata(field, name, "effect", splitRootMetadata(scope)),
    admits: admitsBlock(field, "effect", scope, "effect"),
  };
}

/** One projection for the economic table, with and without its produce rows. */
function projectEconomicResources(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  shape: "economicResources" | "economicResourcesNoProduce"
): FieldProjection {
  const scope = scopeType(emitter, field, ctx, override?.scope);
  const block =
    shape === "economicResources" ? "EconomicResourceBlock" : "EconomicResourceBlockNoProduce";
  const memberType = `${emitter.use(block)}<${scopeArg(emitter, scope)}>`;
  return {
    memberType: withFrom(
      emitter,
      isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      scope
    ),
    metadata: metadata(field, name, shape),
    admits: admitsBlock(field, shape, scope),
  };
}

function projectEconomicResourceOperation(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  path: string
): FieldProjection {
  const parts = economicResourceOperationParts(field);
  const triggerScope = contravariantScopeType(emitter, parts.trigger, containerContext(field, ctx));
  const memberType =
    `${emitter.use("EconomicResourceOperation")}` + `<${scopeArg(emitter, triggerScope)}>`;
  return {
    memberType: withFrom(
      emitter,
      isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      triggerScope
    ),
    metadata: metadata(field, name, "economicResourceOperation"),
    admits: admitsBlock(field, "economicResourceOperation", triggerScope),
    ...economicResourceOperationInterior(name, path, triggerScope),
  };
}

/**
 * A `TriggeredModifier`, taking a second type argument only when its
 * `potential` runs somewhere other than the modifiers themselves.
 */
function projectTriggeredModifier(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  path: string
): FieldProjection {
  const modifierScope = scopeType(emitter, field, ctx, override?.scope);
  const potentialScope = scopeType(
    emitter,
    triggeredModifierPotential(field),
    containerContext(field, ctx)
  );
  const memberType =
    modifierScope.type === potentialScope.type
      ? `${emitter.use("TriggeredModifier")}<${scopeArg(emitter, modifierScope)}>`
      : `${emitter.use("TriggeredModifier")}<${scopeArg(emitter, modifierScope)}, ` +
        `${scopeArg(emitter, potentialScope)}>`;
  return {
    memberType: withFrom(
      emitter,
      isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
      modifierScope
    ),
    metadata: metadata(field, name, "triggeredModifierBlock"),
    admits: admitsBlock(field, "triggeredModifierBlock", modifierScope),
    ...triggeredModifierInterior(name, path, potentialScope),
  };
}

/**
 * The row constraints `WeightedEventRow` enforces at render time, mirrored onto
 * the generated inline members so the type states them where an author reads it.
 */
const WEIGHTED_EVENT_MEMBER_DOCS = {
  weight: [
    "Relative selection weight, as a whole number. A weight becomes the arm's",
    "key verbatim, and `random_events` keys its arms by an `int`. Duplicate",
    "weights are preserved as separate rows, and `0` is a row the game ships itself.",
  ],
  event: ["Event selected by this row. Omit it to emit the literal `0` no-op arm."],
} as const;

function projectWeightedEvents(
  emitter: Emitter,
  field: RuleField,
  name: string
): FieldProjection | null {
  if (field.type.kind !== "block") {
    return null;
  }
  // `int = 0` is the nothing-happens arm, authored by omitting `event`; the
  // remaining computed-key declarations carry the firable event types.
  const eventTypes = field.type.fields
    .filter((inner) => inner.key.kind === "computed" && inner.key.type.kind === "int")
    .map((inner) => inner.type)
    .filter((type) => type.kind !== "literal");
  const value = eventTypes.length === 0 ? null : emitter.lowerer.unionFor(eventTypes);
  if (value === null) {
    return null;
  }
  const eventType = emitter.typeOf(value);
  return {
    memberType: `readonly { weight: number; event?: ${eventType} }[]`,
    documentedMemberType:
      "readonly {\n" +
      docComment(WEIGHTED_EVENT_MEMBER_DOCS.weight) +
      "weight: number;\n" +
      docComment(WEIGHTED_EVENT_MEMBER_DOCS.event) +
      `event?: ${eventType};\n` +
      "}[]",
    docs: ["Weighted event rows. A row's weight must be a whole number."],
    metadata: metadata(field, name, "weightedEvents", scalarMetadata(value)),
    admits: admitsBlock(field, "weightedEvents"),
  };
}

type OrdinaryFieldShape = Exclude<ContentFieldShape, "repeatedStruct">;

function projectSelectedShape(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string,
  shape: OrdinaryFieldShape
): FieldProjection | null {
  switch (shape) {
    case "value":
      return projectValue(emitter, field, name, widening);
    case "valueList":
      return projectValueList(emitter, field, name, widening, override?.quoted ?? false);
    case "trigger":
      return projectTrigger(emitter, field, name, ctx, override);
    case "effect":
      return projectEffect(emitter, field, name, ctx, override);
    case "economicResources":
    case "economicResourcesNoProduce":
      return projectEconomicResources(emitter, field, name, ctx, override, shape);
    case "economicResourceOperation":
      return projectEconomicResourceOperation(emitter, field, name, ctx, path);
    case "triggeredModifierBlock":
      return projectTriggeredModifier(emitter, field, name, ctx, override, path);
    case "modifierBlock":
      return projectModifierBlock(emitter, field, name, ctx, override);
    case "weightBlock":
    case "weightBlockWithLoc":
      return projectWeightBlock(emitter, field, name, ctx, override, path, shape);
    case "struct":
      return projectStruct(emitter, field, name, path, ctx);
    case "weightedEvents":
      return projectWeightedEvents(emitter, field, name);
    case "structMap":
      return projectStructMap(emitter, field, name, path, ctx, override);
    case "scalarMap":
      return projectScalarMap(emitter, field, name);
    case "aliasStruct":
      return projectAliasStruct(emitter, field, name, override!.category!);
    default: {
      const unreachable: never = shape;
      return unreachable;
    }
  }
}

function projectFallbackShape(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  widening: string | undefined,
  path: string
): FieldProjection | null {
  const bare = bareValuesOf(field.type);
  if (bare !== null) {
    // A single bare block, rather than a bare scalar, is the "wrapped" spelling
    // of a repeated struct (see structBlockOf) — try that before treating it as
    // a scalar list, and don't fall through to a scalar reading if it declines,
    // since that would misread the block as an empty/invalid scalar list.
    if (bare.length === 1 && bare[0]!.kind === "block") {
      return projectStruct(emitter, field, name, path, ctx);
    }
    const asList = projectValueList(emitter, field, name, widening, false);
    if (asList !== null) {
      return asList;
    }
  }
  const struct = projectStruct(emitter, field, name, path, ctx);
  if (struct !== null) {
    return struct;
  }
  return projectValue(emitter, field, name, widening);
}

function projectInferredShape(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): FieldProjection | null {
  const triggerStruct = projectTriggerStruct(emitter, field, name, path, ctx);
  if (triggerStruct !== null) {
    return triggerStruct;
  }
  const category = spliceCategory(field.type);
  if (category === "trigger") {
    return projectTrigger(emitter, field, name, ctx, override);
  }
  if (category === "effect") {
    return projectEffect(emitter, field, name, ctx, override);
  }
  if (category === "modifier_rule") {
    return projectWeightBlock(emitter, field, name, ctx, override, path, "weightBlock");
  }
  if (category === "modifier_rule_with_loc") {
    return projectWeightBlock(emitter, field, name, ctx, override, path, "weightBlockWithLoc");
  }
  if (category !== null) {
    const members = aliasScalarFields(emitter.lowerer, category);
    if (members !== null) {
      return projectStruct(
        emitter,
        { ...field, type: { kind: "block", fields: members, bare: [] } },
        name,
        path,
        ctx
      );
    }
  }
  return projectFallbackShape(emitter, field, name, ctx, widening, path);
}

/**
 * The shape ladder for one declaration: the overlay-requested or derived shape
 * first, then the shapes recognized from the field's own splice category, then
 * the structural fallbacks. Arm order is load-bearing — a selected shape skips
 * the recognizers, and a bare block must try the wrapped-struct reading before
 * the scalar-list one.
 */
function projectOrdinary(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): FieldProjection | null {
  const selectedShape = override?.shape ?? derivedClauseShape(field);
  if (selectedShape === undefined) {
    return projectInferredShape(emitter, field, name, ctx, override, widening, path);
  }
  if (selectedShape === "repeatedStruct") {
    return projectFallbackShape(emitter, field, name, ctx, widening, path);
  }
  return projectSelectedShape(emitter, field, name, ctx, override, widening, path, selectedShape);
}

/**
 * A field CWT declares both as a scalar and as a block accepts both, projected at
 * runtime by whichever form the author passes.
 *
 * Picking one declaration is wrong in whichever direction that registry's
 * corpus leans, and the shipped game writes both: vanilla writes
 * `stages.end = 100` 254 times against 1 block, while `opinion_modifier.opinion`
 * needs the block's gated adjustments; `starbase_level.picture` is a bare
 * `<sprite>` in 18 definitions and a trigger-gated block in 9. Whichever arm
 * first-wins picking dropped became a form no author could produce, and a
 * presence-only corpus check could not see it.
 *
 * Both arms lower through the ordinary pipeline, so the pairing is not limited
 * to any particular combination: a scalar beside a weight block, a struct, a
 * trigger, or a bare list all fall out the same way.
 */
function projectDual(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): FieldProjection | null {
  const scalarArms: RuleField[] = [];
  const blockArms: RuleField[] = [];
  for (const field of group) {
    if (field.type.kind === "block") {
      blockArms.push(field);
    } else {
      scalarArms.push(field);
    }
  }
  if (scalarArms.length === 0 || blockArms.length === 0) {
    return null;
  }
  const scalar = pickOrdinary(emitter, scalarArms, name, ctx, undefined, widening, path);
  const block = pickOrdinary(emitter, blockArms, name, ctx, override, widening, path);
  if (scalar === null || block === null) {
    return null;
  }
  // Declaration order, so the emitted union reads in the order the rules do.
  const arms =
    group.indexOf(scalarArms[0]!) < group.indexOf(blockArms[0]!)
      ? [scalar, block]
      : [block, scalar];
  // Both arms share one key and one authoring member, so the writer can only
  // tell them apart by what the author passed. Two arms accepting the same form
  // — a repeated bool beside a bare value list, both arrays — are
  // indistinguishable, and declining is the honest answer. Where the *arity* is
  // what makes them collide rather than the shapes, an `arity` assertion fixes
  // it upstream of here.
  const forms = arms.map((arm) =>
    formOfShape({
      shape: contentShape(arm.admits.shape),
      repeated: arm.admits.repeated,
      wrapped: arm.wrapped,
    })
  );
  if (new Set(forms).size !== forms.length) {
    return null;
  }
  return {
    memberType: arms.map((arm) => arm.memberType).join(" | "),
    // Each arm carries the member too: the writer resolves an arm by its own
    // member name, so every arm renders under the one the outer field takes.
    metadata: (member) =>
      `{ key: ${JSON.stringify(name)}, member: ${JSON.stringify(member)}, ` +
      `shape: "dual", arms: [${arms.map((arm) => arm.metadata(member)).join(", ")}] }`,
    admits: {
      shape: "dual",
      // The key repeats if any arm lets it: `situation_type.picture` is one
      // scalar or N trigger-gated blocks.
      repeated: arms.some((arm) => arm.admits.repeated),
      ...(scalar.admits.literals === undefined ? {} : { literals: scalar.admits.literals }),
      ...(block.admits.scope === undefined ? {} : { scope: block.admits.scope }),
      ...(block.admits.clause === undefined ? {} : { clause: block.admits.clause }),
    },
    code: arms.map((arm) => arm.code ?? "").join(""),
    exportedNames: arms.flatMap((arm) => arm.exportedNames ?? []),
    unsupported: arms.flatMap((arm) => arm.unsupported ?? []),
    docTables: arms.flatMap((arm) => arm.docTables ?? []),
    // The block arm alone: a scalar arm has no interior, and both arms share
    // the one key the reader descends from.
    ...(block.nested === undefined ? {} : { nested: block.nested }),
    ...(block.descents === undefined ? {} : { descents: block.descents }),
  };
}

/**
 * A field declared several times as scalars is one field accepting the union —
 * `progress_direction` is `monodirectional` in one subtype and `bidirectional`
 * in the other, and first-wins picking made the second unreachable.
 */
function projectScalarUnion(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  widening: string | undefined
): FieldProjection | null {
  const boolish = (type: RuleType): boolean =>
    type.kind === "literal" && (type.text === "yes" || type.text === "no");
  if (group.some((field) => field.type.kind === "block" || boolish(field.type))) {
    return null;
  }
  const repeated = group.map((field) => isRepeated(field.cardinality));
  if (new Set(repeated).size > 1) {
    return null;
  }
  const value = emitter.lowerer.unionFor(group.map((field) => field.type));
  if (value === null) {
    return null;
  }
  const locKey = locKeyUnion(emitter, group, value);
  const base =
    (locKey?.type ?? emitter.typeOf(value)) + (widening === undefined ? "" : ` | ${widening}`);
  return {
    memberType: repeated[0]! ? arrayType(base) : base,
    metadata: metadata(
      group[0]!,
      name,
      "value",
      locKey === undefined ? scalarMetadata(value) : locKey.metadata
    ),
    admits: admitsScalars(group[0]!, "value", widening === undefined ? value : null),
    docs: locKey === undefined ? undefined : [LOC_KEY_MEMBER_DOC],
  };
}

/**
 * The localisation-key member type and metadata for any group CWT declares
 * with a `localisation` arm.
 *
 * Three shapes reach here. The plainest is localisation beside one or more
 * engine sentinels — `text = ""` and `fail_text = default` alongside
 * `text = localisation`, in the `custom_tooltip` block decisions and component
 * templates share; the sentinels stay in the union and travel verbatim, since
 * `default` selects the game's own fail text and is not a key the mod could
 * supply. The others are localisation beside a raw displayed scalar (a swap's
 * `name`) and localisation beside a content reference (a job swap's `name`,
 * `scripted_loc`'s `default`), whose ambiguous string arms `unionFor` has
 * already replaced with `LiteralText` and a bare reference type.
 *
 * The metadata keeps `conversion: "ref"` wherever an object-shaped arm
 * survives the definition walk: the walk resolves text to a key string and
 * leaves a reference as it stands, and `refId` handles both. Returns
 * `undefined` for a group with no localisation arm at all.
 */
function locKeyUnion(
  emitter: Emitter,
  group: readonly RuleField[],
  value: LoweredValue
):
  | { readonly type: string; readonly literals: readonly string[]; readonly metadata: string[] }
  | undefined {
  if (!group.some((field) => field.type.kind === "localisation")) {
    return undefined;
  }
  const literals = [
    ...new Set(group.flatMap((field) => (field.type.kind === "literal" ? [field.type.text] : []))),
  ];
  const carriesReference = value.objectKinds?.some(
    (kind) => kind === "typed-ref" || kind === "scope-ref"
  );
  return {
    type: emitter.typeOf(value),
    literals,
    metadata: [
      `conversion: ${JSON.stringify(carriesReference === true ? "ref" : "identity")}`,
      "locKey: true",
      ...(literals.length === 0 ? [] : [`locKeyLiterals: ${JSON.stringify(literals)}`]),
      ...refTypesEntries(value),
    ],
  };
}

/**
 * Projects one named field group through overlay assertions and ordinary shape
 * selection. Asset-path assertions are applied only after a shape is selected.
 */
export function pickOrdinary(
  emitter: Emitter,
  declared: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): FieldProjection | null {
  const identified = asIdentityName(declared, override, path);
  const projected = assertedAssetPath(
    emitter,
    projectFieldShape(emitter, identified, name, ctx, override, widening, path),
    identified,
    name,
    widening,
    path
  );
  const authoringType = override?.authoringType;
  const family = override?.localizationFamily;
  if (family !== undefined && authoringType === undefined) {
    throw new Error(
      `CONTENT_FIELD_OVERRIDES's "${path}" row grafts localization family "${family}" but ` +
        "supplies no authoringType, so the member would accept no bundle to register"
    );
  }
  if (projected === null || authoringType === undefined) {
    return projected;
  }
  for (const imported of authoringType.imports) {
    emitter.useFrom(imported.module, imported.name, "type");
  }
  const typed = { ...projected, memberType: authoringType.type };
  if (family === undefined) {
    return typed;
  }
  return {
    ...typed,
    metadata: withMetadataEntry(typed.metadata, `localizationFamily: ${JSON.stringify(family)}`),
  };
}

/**
 * Reads a `localisation`-typed field as the plain id it functionally is, for
 * an audited {@link ContentFieldOverride.identityName} row.
 *
 * The rewrite is on the rule types rather than on the projected member, so
 * everything downstream — the union, the metadata, the corpus gate's view of
 * the shape — sees one field that was never a localisation position, rather
 * than a localisation position with its resolution switched off.
 */
function asIdentityName(
  declared: readonly RuleField[],
  override: ContentFieldOverride | undefined,
  path: string
): readonly RuleField[] {
  if (override?.identityName !== true) {
    return declared;
  }
  if (!declared.some((field) => field.type.kind === "localisation")) {
    throw new Error(
      `CONTENT_FIELD_OVERRIDES's "${path}" row declares identityName, but the field has no ` +
        "localisation arm to reinterpret — the row is stale"
    );
  }
  return declared.map((field) =>
    field.type.kind === "localisation" ? { ...field, type: { kind: "scalar" as const } } : field
  );
}

function projectFieldShape(
  emitter: Emitter,
  declared: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): FieldProjection | null {
  const unchecked = assertedUncheckedString(
    emitter,
    assertedArity(declared, override),
    override,
    path
  );
  const group = unchecked.group;
  const documented = (projected: FieldProjection | null): FieldProjection | null =>
    projected === null || unchecked.docs.length === 0
      ? projected
      : { ...projected, docs: unchecked.docs };
  if (override?.shape === undefined && group.length > 1) {
    const dual = projectDual(emitter, group, name, ctx, override, widening, path);
    if (dual !== null) {
      return documented(dual);
    }
    const union = projectScalarUnion(emitter, group, name, widening);
    if (union !== null) {
      return documented(union);
    }
  }
  for (const field of group) {
    const projected = projectOrdinary(emitter, field, name, ctx, override, widening, path);
    if (projected !== null) {
      return documented(projected);
    }
  }
  return null;
}
