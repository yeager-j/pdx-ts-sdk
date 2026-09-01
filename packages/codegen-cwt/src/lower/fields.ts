/**
 * Lowers one CWT rule field to an authoring member, its runtime metadata, and
 * the shape description the corpus gate measures it against.
 *
 * This is the half of content emission that knows nothing about registries.
 * Given a field's declarations, an overlay row and a scope context, it picks a
 * shape and returns the three things every caller needs. `emit/content/content-type.ts`
 * drives it over a `type[...]` body and over each repeated-struct field one
 * level down; the alias emitters drive it over an alias category's members.
 * Keeping the loop here is what lets those callers share one lowering instead
 * of growing parallel ones that disagree.
 */

import type { DescentNode } from "../corpus/observations.ts";
import { isRepeated, type RuleField, type RuleType } from "../cwt/model.ts";
import { camelCase, pascalCase } from "../naming.ts";
import {
  type ContentFieldOverride,
  type ContentFieldShape,
  type FieldWidening,
} from "../overlay/index.ts";
import { Emitter, type TsValue } from "../render/emitter.ts";
import type { DocTable, FieldOmissionRow } from "../render/field-rows.ts";
import { refTypesEntries } from "../render/writer.ts";
import { formOfShape } from "./authored-form.ts";
import { contentShape } from "./content-shape.ts";
import { assertedArity, assertedAssetPath, assertedUncheckedString } from "./field-assertions.ts";
import {
  economicResourceOperationInterior,
  triggeredModifierInterior,
  weightInterior,
} from "./field-interiors.ts";
import {
  admitsBlock,
  admitsScalars,
  arrayType,
  metadata,
  scalarMetadata,
  withMetadataEntry,
  type FieldMetadata,
} from "./field-metadata.ts";
import {
  lowerScalarMap,
  lowerStruct,
  lowerStructMap,
  lowerTriggerStruct,
} from "./field-structs.ts";
import {
  aliasScalarFields,
  bareValuesOf,
  derivedClauseShape,
  economicResourceOperationParts,
  spliceCategory,
  structuralSpliceOf,
  triggeredModifierPotential,
  type AliasNameField,
} from "./rule-shapes.ts";
import {
  containerContext,
  contravariantScopeType,
  effectBlockArgs,
  scopeArg,
  scopeType,
  splitRootMetadata,
  withFrom,
  type FieldContext,
} from "./scope-context.ts";

export {
  authoredLiterals,
  memberOptional,
  metadata,
  repeatsSiblings,
  type FieldMetadata,
} from "./field-metadata.ts";

/**
 * Describes one lowered field in the terms used by corpus conformance checks.
 * Consumers use it to compare shape, repetition, scalar values, and closure scope.
 */
export interface EmittedField {
  /** The game's own key, or a dotted path for one lowered inside a struct. */
  readonly field: string;
  /** Authored member path owning this field, preserved through nested lowering. */
  readonly authoredPath?: readonly string[];
  /** The runtime shape name, the same token the field metadata carries. */
  readonly shape: string;
  /** True when the authoring member lets the key repeat at the sibling level. */
  readonly repeated: boolean;
  /**
   * Marks a struct whose repetition occurs as anonymous blocks inside one key.
   * The corpus checker uses this to distinguish wrapped lists from repeated sibling keys.
   */
  readonly wrapped?: boolean;
  /** Every scalar the member admits, when the lowering closed the set. */
  readonly literals?: readonly string[];
  /**
   * The canonical scopes in which this field's closures run.
   * `"any"` is unpinned; `{ parameter }` means the enclosing definition selects
   * one of the listed scopes.
   */
  readonly scope?:
    | readonly string[]
    | "any"
    | {
        /** Scopes allowed for the enclosing definition's scope parameter. */
        readonly parameter: readonly string[];
      };
  /**
   * The script clause kind held by this block, when it contains scoped rules.
   * Consumers must use this value instead of inferring a clause from the shape name.
   */
  readonly clause?: "trigger" | "effect";
}

/**
 * The generated member type, runtime descriptor, and conformance evidence for
 * one lowered CWT field. Optional code and descent data describe nested blocks.
 */
export interface LoweredField {
  /** The TypeScript type exposed on the generated authoring member. */
  readonly memberType: string;
  /** Renders the runtime `ContentField` descriptor for the emitted member. */
  readonly metadata: FieldMetadata;
  /**
   * The field forms admitted by corpus conformance checks.
   * Its shape and repetition must match {@link metadata}.
   */
  readonly admits: Omit<EmittedField, "field">;
  /**
   * Marks a struct whose anonymous repetition is nested inside one key.
   * Dual lowering uses this to distinguish the member's authored form.
   */
  readonly wrapped?: boolean;
  /**
   * Documentation contributed by lowering in addition to the CWT declaration.
   * Use it for author-facing constraints introduced by an overlay.
   */
  readonly docs?: readonly string[];
  /** Extra top-level declarations a nested struct level needed, prepended by the caller. */
  readonly code?: string;
  /** Every name {@link LoweredField.code} exports, for the public barrel's check. */
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
 * Inlined fields become optional because the subtype predicate may not apply.
 */
export function flatten(fields: readonly RuleField[], typeName: string): RuleField[] {
  return fields.flatMap((field) => {
    if (field.key.kind !== "subtype") {
      return [field];
    }
    if (field.type.kind !== "block") {
      return [];
    }
    const predicate = `${field.key.negated ? "not " : ""}\`${field.key.name}\``;
    return flatten(field.type.fields, typeName).map((inner) => ({
      ...inner,
      cardinality: { min: 0, max: inner.cardinality.max },
      docs: [...inner.docs, `Only when ${typeName} subtype ${predicate} applies.`],
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

/** One top-level alias splice lowered to a generated authoring member. */
export interface LoweredSplice {
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
  /** What the lowering admits, for the corpus gate. Set whenever `key` is. */
  readonly admits?: Omit<EmittedField, "field">;
}

/**
 * Lowers a structural alias splice to an optional authoring member containing ordered blocks.
 * Splices always use a repeated array because their declaration cardinality does not govern
 * individual block members.
 */
export function lowerStructuralSplice(
  emitter: Emitter,
  category: string,
  docs: readonly string[]
): LoweredSplice | null {
  const splice = structuralSpliceOf(emitter, category);
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
 * Lowers a top-level alias splice to a member emitted directly into the definition body.
 * Modifier splices become a closure; recognized structural categories become ordered arrays;
 * unsupported categories return `null`.
 */
export function lowerTopLevelSplice(
  emitter: Emitter,
  field: AliasNameField,
  ctx: FieldContext
): LoweredSplice | null {
  if (field.key.category !== "modifier") {
    return lowerStructuralSplice(emitter, field.key.category, field.docs);
  }
  const scope = scopeType(emitter, field, ctx);
  return {
    member: "modifiers",
    memberType: `${emitter.use("ModifierClosure")}<${scopeArg(emitter, scope)}>`,
    metadata: `{ member: "modifiers", shape: "inlineModifiers" }`,
    docs: [
      "Modifiers written directly into the definition body, with no enclosing key.",
      ...field.docs,
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

function lowerValue(
  emitter: Emitter,
  field: RuleField,
  name: string,
  widening: string | undefined
): LoweredField | null {
  const value = emitter.valueFor(field.type);
  if (value === null) {
    return null;
  }
  const repeated = isRepeated(field.cardinality);
  // `field.type.kind === "localisation"` is CWT's own way of typing a plain
  // body field as "this value names a localisation key" — the same RuleType
  // `job.condition_string` and `global_ship_design`'s name_field pointer both
  // use. It lowers to the same `string`, `conversion: "identity"` shape
  // ordinary scalars do (`render/emitter.ts`'s `valueFor`), so nothing
  // downstream can otherwise tell a key from any other string field;
  // `locKey: true` is that signal, and the runtime resolves the member
  // through it (SDK-303).
  const isLocKey = field.type.kind === "localisation";
  const scalarType = isLocKey
    ? emitter.use("LocalizationInput")
    : authoredScalarType(field.type, value.type);
  const base = scalarType + (widening === undefined ? "" : ` | ${widening}`);
  if (!isLocKey) {
    emitter.useValue(value);
  }
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

function lowerValueList(
  emitter: Emitter,
  field: RuleField,
  name: string,
  widening: string | undefined,
  quoted: boolean
): LoweredField | null {
  const bare = bareValuesOf(field.type);
  if (bare === null) {
    return null;
  }
  const value = emitter.unionFor(bare);
  if (value === null) {
    return null;
  }
  // `job.localized_tags = { localisation }` — the brace-list spelling of the
  // same "this value names a localisation key" declaration `lowerValue` reads
  // off a bare `= localisation`. The element contract is the repeated scalar
  // one, so the element type and the runtime resolution are the same.
  const isLocKey = bare.every((type) => type.kind === "localisation");
  const elementType = isLocKey ? emitter.use("LocalizationInput") : emitter.useValue(value).type;
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

function lowerModifierBlock(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined
): LoweredField {
  const scope = scopeType(emitter, field, ctx, override?.scope);
  return {
    memberType: `${emitter.use("ModifierClosure")}<${scopeArg(emitter, scope)}>`,
    metadata: metadata(field, name, "modifierBlock"),
    admits: admitsBlock(field, "modifierBlock", scope),
  };
}

/**
 * One lowering serves both weight shapes and both routes to them: the overlay
 * requesting the shape by name, and the field splicing the matching
 * `modifier_rule` category. The `WithLoc` variant is the same block with a
 * different closure type.
 */
function lowerWeightBlock(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  path: string,
  shape: "weightBlock" | "weightBlockWithLoc"
): LoweredField {
  const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
  const closure = shape === "weightBlock" ? "WeightBlock" : "WeightBlockWithLoc";
  return {
    memberType: withFrom(emitter, `${emitter.use(closure)}<${scopeArg(emitter, scope)}>`, scope),
    metadata: metadata(field, name, shape),
    admits: admitsBlock(field, shape, scope),
    ...weightInterior(emitter, name, path, scope),
  };
}

function lowerAliasStruct(
  emitter: Emitter,
  field: RuleField,
  name: string,
  category: string
): LoweredField {
  const memberType = emitter.useAliasCategory(category, `${pascalCase(category)}Block`);
  return {
    memberType: isRepeated(field.cardinality) ? arrayType(memberType) : memberType,
    metadata: metadata(field, name, "aliasStruct", [`category: ${JSON.stringify(category)}`]),
    admits: admitsBlock(field, "aliasStruct"),
  };
}

/** A block holding trigger rules, authored as one `Trigger<S>` closure. */
function lowerTrigger(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined
): LoweredField {
  const scope = contravariantScopeType(emitter, field, ctx, override?.scope);
  return {
    memberType: withFrom(emitter, `${emitter.use("Trigger")}<${scopeArg(emitter, scope)}>`, scope),
    metadata: metadata(field, name, "trigger"),
    admits: admitsBlock(field, "trigger", scope, "trigger"),
  };
}

/** A block holding effect rules, authored as one `EffectBlock` closure. */
function lowerEffect(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined
): LoweredField {
  const scope = scopeType(emitter, field, ctx, override?.scope);
  return {
    memberType: `${emitter.use("EffectBlock")}<${effectBlockArgs(emitter, scope)}>`,
    metadata: metadata(field, name, "effect", splitRootMetadata(scope)),
    admits: admitsBlock(field, "effect", scope, "effect"),
  };
}

/** One lowering for the economic table, with and without its produce rows. */
function lowerEconomicResources(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  shape: "economicResources" | "economicResourcesNoProduce"
): LoweredField {
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

function lowerEconomicResourceOperation(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  path: string
): LoweredField {
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
function lowerTriggeredModifier(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  path: string
): LoweredField {
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

function lowerWeightedEvents(
  emitter: Emitter,
  field: RuleField,
  name: string
): LoweredField | null {
  if (field.type.kind !== "block") {
    return null;
  }
  // `int = 0` is the nothing-happens arm, authored by omitting `event`; the
  // remaining computed-key declarations carry the firable event types.
  const eventTypes = field.type.fields
    .filter((inner) => inner.key.kind === "computed" && inner.key.type.kind === "int")
    .map((inner) => inner.type)
    .filter((type) => type.kind !== "literal");
  const value = eventTypes.length === 0 ? null : emitter.unionFor(eventTypes);
  if (value === null) {
    return null;
  }
  emitter.useValue(value);
  return {
    memberType: `readonly { weight: number; event?: ${value.type} }[]`,
    metadata: metadata(field, name, "weightedEvents", scalarMetadata(value)),
    admits: admitsBlock(field, "weightedEvents"),
  };
}

type OrdinaryFieldShape = Exclude<ContentFieldShape, "repeatedStruct">;

function lowerSelectedShape(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string,
  shape: OrdinaryFieldShape
): LoweredField | null {
  switch (shape) {
    case "value":
      return lowerValue(emitter, field, name, widening);
    case "valueList":
      return lowerValueList(emitter, field, name, widening, override?.quoted ?? false);
    case "trigger":
      return lowerTrigger(emitter, field, name, ctx, override);
    case "effect":
      return lowerEffect(emitter, field, name, ctx, override);
    case "economicResources":
    case "economicResourcesNoProduce":
      return lowerEconomicResources(emitter, field, name, ctx, override, shape);
    case "economicResourceOperation":
      return lowerEconomicResourceOperation(emitter, field, name, ctx, path);
    case "triggeredModifierBlock":
      return lowerTriggeredModifier(emitter, field, name, ctx, override, path);
    case "modifierBlock":
      return lowerModifierBlock(emitter, field, name, ctx, override);
    case "weightBlock":
    case "weightBlockWithLoc":
      return lowerWeightBlock(emitter, field, name, ctx, override, path, shape);
    case "struct":
      return lowerStruct(emitter, field, name, path, ctx);
    case "weightedEvents":
      return lowerWeightedEvents(emitter, field, name);
    case "structMap":
      return lowerStructMap(emitter, field, name, path, ctx, override);
    case "scalarMap":
      return lowerScalarMap(emitter, field, name);
    case "aliasStruct":
      return lowerAliasStruct(emitter, field, name, override!.category!);
    default: {
      const unreachable: never = shape;
      return unreachable;
    }
  }
}

function lowerFallbackShape(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const bare = bareValuesOf(field.type);
  if (bare !== null) {
    // A single bare block, rather than a bare scalar, is the "wrapped" spelling
    // of a repeated struct (see structBlockOf) — try that before treating it as
    // a scalar list, and don't fall through to a scalar reading if it declines,
    // since that would misread the block as an empty/invalid scalar list.
    if (bare.length === 1 && bare[0]!.kind === "block") {
      return lowerStruct(emitter, field, name, path, ctx);
    }
    const asList = lowerValueList(emitter, field, name, widening, false);
    if (asList !== null) {
      return asList;
    }
  }
  const struct = lowerStruct(emitter, field, name, path, ctx);
  if (struct !== null) {
    return struct;
  }
  return lowerValue(emitter, field, name, widening);
}

function lowerInferredShape(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const triggerStruct = lowerTriggerStruct(emitter, field, name, path, ctx);
  if (triggerStruct !== null) {
    return triggerStruct;
  }
  const category = spliceCategory(field.type);
  if (category === "trigger") {
    return lowerTrigger(emitter, field, name, ctx, override);
  }
  if (category === "effect") {
    return lowerEffect(emitter, field, name, ctx, override);
  }
  if (category === "modifier_rule") {
    return lowerWeightBlock(emitter, field, name, ctx, override, path, "weightBlock");
  }
  if (category === "modifier_rule_with_loc") {
    return lowerWeightBlock(emitter, field, name, ctx, override, path, "weightBlockWithLoc");
  }
  if (category !== null) {
    const members = aliasScalarFields(emitter, category);
    if (members !== null) {
      return lowerStruct(
        emitter,
        { ...field, type: { kind: "block", fields: members, bare: [] } },
        name,
        path,
        ctx
      );
    }
  }
  return lowerFallbackShape(emitter, field, name, ctx, widening, path);
}

/**
 * The shape ladder for one declaration: the overlay-requested or derived shape
 * first, then the shapes recognized from the field's own splice category, then
 * the structural fallbacks. Arm order is load-bearing — a selected shape skips
 * the recognizers, and a bare block must try the wrapped-struct reading before
 * the scalar-list one.
 */
function lowerOrdinary(
  emitter: Emitter,
  field: RuleField,
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const selectedShape = override?.shape ?? derivedClauseShape(field);
  if (selectedShape === undefined) {
    return lowerInferredShape(emitter, field, name, ctx, override, widening, path);
  }
  if (selectedShape === "repeatedStruct") {
    return lowerFallbackShape(emitter, field, name, ctx, widening, path);
  }
  return lowerSelectedShape(emitter, field, name, ctx, override, widening, path, selectedShape);
}

/**
 * A field CWT declares both as a scalar and as a block accepts both, lowered at
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
function lowerDual(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
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
function lowerScalarUnion(
  emitter: Emitter,
  group: readonly RuleField[],
  name: string,
  widening: string | undefined
): LoweredField | null {
  const boolish = (type: RuleType): boolean =>
    type.kind === "literal" && (type.text === "yes" || type.text === "no");
  if (group.some((field) => field.type.kind === "block" || boolish(field.type))) {
    return null;
  }
  const repeated = group.map((field) => isRepeated(field.cardinality));
  if (new Set(repeated).size > 1) {
    return null;
  }
  const value = emitter.unionFor(group.map((field) => field.type));
  if (value === null) {
    return null;
  }
  const locKey = locKeyUnion(emitter, group, value);
  const base =
    (locKey?.type ?? emitter.useValue(value).type) +
    (widening === undefined ? "" : ` | ${widening}`);
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
  value: TsValue
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
    type: emitter.useValue(value).type,
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
 * Lowers one named field group through overlay assertions and ordinary shape
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
): LoweredField | null {
  const identified = asIdentityName(declared, override, path);
  const lowered = assertedAssetPath(
    emitter,
    pickLowering(emitter, identified, name, ctx, override, widening, path),
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
  if (lowered === null || authoringType === undefined) {
    return lowered;
  }
  for (const imported of authoringType.imports) {
    emitter.useFrom(imported.module, imported.name, "type");
  }
  const typed = { ...lowered, memberType: authoringType.type };
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
 * The rewrite is on the rule types rather than on the lowered member, so
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

function pickLowering(
  emitter: Emitter,
  declared: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  const unchecked = assertedUncheckedString(
    emitter,
    assertedArity(declared, override),
    override,
    path
  );
  const group = unchecked.group;
  const documented = (lowered: LoweredField | null): LoweredField | null =>
    lowered === null || unchecked.docs.length === 0
      ? lowered
      : { ...lowered, docs: unchecked.docs };
  if (override?.shape === undefined && group.length > 1) {
    const dual = lowerDual(emitter, group, name, ctx, override, widening, path);
    if (dual !== null) {
      return documented(dual);
    }
    const union = lowerScalarUnion(emitter, group, name, widening);
    if (union !== null) {
      return documented(union);
    }
  }
  for (const field of group) {
    const lowered = lowerOrdinary(emitter, field, name, ctx, override, widening, path);
    if (lowered !== null) {
      return documented(lowered);
    }
  }
  return null;
}
