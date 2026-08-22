/**
 * Lowers one CWT rule field to an authoring member, its runtime metadata, and
 * the shape description the corpus gate measures it against.
 *
 * This is the half of content emission that knows nothing about registries.
 * Given a field's declarations, an overlay row and a scope context, it picks a
 * shape and returns the three things every caller needs. `content-type.ts`
 * drives it over a `type[...]` body and over each repeated-struct field one
 * level down; the alias emitters drive it over an alias category's members.
 * Keeping the loop here is what lets those callers share one lowering instead
 * of growing parallel ones that disagree.
 */

import type { DescentNode } from "../corpus/observations.ts";
import { isRepeated, type RuleField, type RuleType } from "../cwt/model.ts";
import { camelCase, pascalCase } from "../naming.ts";
import { type ContentFieldOverride, type FieldWidening } from "../overlay/index.ts";
import { Emitter } from "../render/emitter.ts";
import type { DocTable, FieldOmissionRow } from "../render/field-rows.ts";
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

export { authoredLiterals, memberOptional, metadata, repeatsSiblings } from "./field-metadata.ts";

/**
 * One lowered field, described in the terms a real PDXScript value can be
 * measured against: block or scalar, repeatable or not, which scalars it
 * admits, which scope its closures run in.
 *
 * The corpus gate used to see field *names* only, which is what limited it to
 * presence checking — `stages.end` could be block-typed against 254 scalar
 * writes and still report full coverage.
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
   * A `struct` whose repetition is nested inside the key, so its block holds
   * bare anonymous blocks rather than named entries. The interior form check
   * needs it for the same reason `valueList` is exempt there: "no named keys"
   * is what this shape writes, not evidence that the lowering is wrong.
   */
  readonly wrapped?: boolean;
  /** Every scalar the member admits, when the lowering closed the set. */
  readonly literals?: readonly string[];
  /**
   * What scope this field's closures run in:
   *
   * - a list of canonical scopes — the rules or an overlay row pinned it
   * - `"any"` — nothing pinned it. A contravariant lowering widens that to
   *   `Trigger<never>`, which admits every rule and checks none; any other
   *   lowering keeps `ScopeName`, which admits only rules legal in *every*
   *   scope, which is almost none
   * - `{ parameter }` — the definition declares which of these it is, so a rule
   *   legal in any one of them is writable by some definition
   */
  readonly scope?: readonly string[] | "any" | { readonly parameter: readonly string[] };
  /**
   * Set when the field's block holds trigger or effect rules, so a consumer
   * knows the keys inside it are scoped rules rather than struct members or
   * modifier names. The emitter knows this from the splice category it lowered;
   * nothing downstream should try to re-derive it from a shape name.
   */
  readonly clause?: "trigger" | "effect";
}

export interface LoweredField {
  readonly memberType: string;
  readonly metadata: string;
  /**
   * What the lowering admits, for the corpus gate. Carries the same `shape` and
   * `repeated` the metadata does, so the two cannot describe different things.
   */
  readonly admits: Omit<EmittedField, "field">;
  /**
   * A `struct` whose repetition is nested inside one key. Decides whether the
   * authoring member is an array — which is what tells two dual arms apart —
   * and rides into `admits` so the gate knows the block holds bare blocks.
   */
  readonly wrapped?: boolean;
  /**
   * Doc lines the lowering itself contributes, beyond the rules' own `###`
   * comments — how an overlay decision that weakens a type explains itself on
   * the member a modder hovers.
   */
  readonly docs?: readonly string[];
  /** Extra top-level declarations a nested struct level needed, prepended by the caller. */
  readonly code?: string;
  /** Rows bubbled up from a nested struct level, their paths already prefixed. */
  readonly unsupported?: readonly FieldOmissionRow[];
  /**
   * Documentation rows for every field table {@link code} declares, one
   * {@link DocTable} per emitted `..._FIELDS` constant, bubbled unchanged —
   * the table constant names the rows, so no path arithmetic rides along.
   */
  readonly docTables?: readonly DocTable[];
  /**
   * What the block's own members admit, at their dotted paths and at every
   * level below — the interior the corpus gate would otherwise measure nothing
   * against, since `admits` describes only the outer key.
   */
  readonly nested?: readonly EmittedField[];
  /**
   * How the corpus reader reaches that interior. Produced beside {@link nested}
   * from one lowering so the two cannot describe different trees: a descent
   * without its emitted fields manufactures unexpressed paths, and emitted
   * fields without their descent are measured against nothing.
   */
  readonly descents?: readonly DescentNode[];
}

/**
 * Declares the imports one overlay widening's `extraType` needs.
 *
 * The row states its own symbols ({@link FieldWidening.symbols}) because the
 * text is free-form TypeScript the overlay writes and the emitter only splices.
 * Applied where the row is read, which is the point the widening joins the
 * member's admitted forms.
 */
export function useWideningSymbols(emitter: Emitter, widening: FieldWidening | undefined): void {
  for (const symbol of widening?.symbols ?? []) {
    emitter.use(symbol);
  }
}

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
 * The alias categories a definition body splices unkeyed at its own top level.
 *
 * `static_modifier` is declared `{ alias_name[modifier] = alias_match_left[modifier]
 * icon = filepath … }` — the modifier grammar *is* the body, so vanilla writes
 * `empire_base = { max_rivalries = 3 }` with the modifier names at the block
 * root, beside the metadata keys. {@link mergeByName} keeps only `name` keys,
 * so without this the splice is invisible to the field model and the registry
 * would emit a definition that can set an icon but never a modifier.
 */
export function topLevelSplices(fields: readonly RuleField[], typeName: string): AliasNameField[] {
  return flatten(fields, typeName).filter(
    (field): field is AliasNameField => field.key.kind === "aliasName"
  );
}

export interface LoweredSplice {
  readonly member: string;
  readonly memberType: string;
  readonly metadata: string;
  readonly docs: readonly string[];
  /**
   * The block key the writer emits each entry under, for a splice whose entries
   * are keyed blocks rather than bare rows. Absent for `inlineModifiers`, whose
   * whole point is that its rows carry no enclosing key — which is also why
   * that one contributes no {@link EmittedField}.
   */
  readonly key?: string;
  /** What the lowering admits, for the corpus gate. Set whenever `key` is. */
  readonly admits?: Omit<EmittedField, "field">;
}

/**
 * Lowers a structural splice to one authoring member holding an ordered array
 * of that category's blocks. `structuralSpliceOf` (`rule-shapes.ts`) is the
 * recognizer that confirms a category is this shape; this is its one
 * lowering.
 *
 * The array is unconditional, and so is its optionality: the cardinality on the
 * `alias_name` line is ignored. A splice is a grammar production rather than a
 * field — the block is legal absent and legal repeated wherever the category is
 * spliced — and CWT annotates the two ends inconsistently anyway. The top-level
 * `alias_name[planet_initializer]` carries `0..inf`, but the recursive ones
 * inside `planet` and `moon` carry nothing at all, which `cardinalityOf` reads
 * as required — and would make every planet demand a sub-planet, forever.
 * {@link aliasScalarFields} already reasons this way for the scalar case.
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
 * Lowers one top-level splice to a single authoring member whose entries the
 * writer emits at the block root rather than under a key.
 *
 * Two kinds lower. `modifier` becomes `ModifierClosure` — the same closure every
 * keyed `modifier = { ... }` field already authors, spliced instead of wrapped,
 * exactly as `TriggeredModifier.modifiers` already does one level down. A
 * *structural* category (see {@link lowerStructuralSplice}) becomes an ordered
 * array of its own block interface.
 *
 * Everything else returns `null` and is reported: the remaining categories a
 * body splices this way (`game_rule`'s `trigger`, `script_value`'s
 * `modifier_rule`, `deposit`'s `resources_template_optional`) belong to types
 * the manifest does not expose, and naming a member for one would be inventing
 * an authoring surface rather than lowering a declared one.
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
  const literalType =
    field.type.kind === "literal" && field.type.text === "yes"
      ? "true"
      : field.type.kind === "literal" && field.type.text === "no"
        ? "false"
        : value.type;
  const base = literalType + (widening === undefined ? "" : ` | ${widening}`);
  // `field.type.kind === "localisation"` is CWT's own way of typing a plain
  // body field as "this value is a localisation key, not free text" — the
  // same RuleType `job.condition_string` and `global_ship_design`'s name_field
  // pointer both use. It lowers to the same `string`, `conversion: "identity"`
  // shape ordinary scalars do (`emit/types.ts`'s `valueFor`), so nothing
  // downstream can otherwise tell "raw key" from "any other string field" —
  // `locKey: true` is that signal, consumed by the runtime's
  // `onLocKeyLooksLikeText` check (SDK-50).
  const locKeyExtra = field.type.kind === "localisation" ? ["locKey: true"] : [];
  emitter.useValue(value);
  return {
    memberType: repeated ? arrayType(base) : base,
    metadata: metadata(field, name, "value", [...scalarMetadata(value), ...locKeyExtra]),
    // A widening opens the set: it exists precisely to admit forms the rules do
    // not name, so the closed arm no longer describes everything legal.
    admits: admitsScalars(field, "value", widening === undefined ? value : null),
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
  const listType = arrayType(emitter.useValue(value).type);
  return {
    memberType: listType + (widening === undefined ? "" : ` | ${widening}`),
    metadata: metadata(field, name, "valueList", [
      ...scalarMetadata(value),
      ...(quoted ? ["quoted: true"] : []),
    ]),
    admits: admitsScalars(field, "valueList", widening === undefined ? value : null),
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

/**
 * The shape ladder for one declaration: the overlay-requested or derived shape
 * first, then the shapes recognized from the field's own splice category, then
 * the structural fallbacks. Arm order is load-bearing — an explicit request
 * skips the recognizers, and a bare block must try the wrapped-struct reading
 * before the scalar-list one.
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
  const requested = override?.shape ?? derivedClauseShape(field);
  if (requested === "modifierBlock") {
    return lowerModifierBlock(emitter, field, name, ctx, override);
  }
  if (requested === "weightBlock" || requested === "weightBlockWithLoc") {
    return lowerWeightBlock(emitter, field, name, ctx, override, path, requested);
  }
  if (requested === "aliasStruct") {
    return lowerAliasStruct(emitter, field, name, override!.category!);
  }
  if (requested === "valueList") {
    return lowerValueList(emitter, field, name, widening, override?.quoted ?? false);
  }
  if (requested === undefined) {
    const triggerStruct = lowerTriggerStruct(emitter, field, name, path, ctx);
    if (triggerStruct !== null) {
      return triggerStruct;
    }
  }
  const category = spliceCategory(field.type);
  if (requested === "trigger" || (requested === undefined && category === "trigger")) {
    return lowerTrigger(emitter, field, name, ctx, override);
  }
  if (requested === "effect" || (requested === undefined && category === "effect")) {
    return lowerEffect(emitter, field, name, ctx, override);
  }
  if (requested === undefined && category === "modifier_rule") {
    return lowerWeightBlock(emitter, field, name, ctx, override, path, "weightBlock");
  }
  if (requested === undefined && category === "modifier_rule_with_loc") {
    return lowerWeightBlock(emitter, field, name, ctx, override, path, "weightBlockWithLoc");
  }
  if (requested === undefined && category !== null) {
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
  if (requested === "economicResources" || requested === "economicResourcesNoProduce") {
    return lowerEconomicResources(emitter, field, name, ctx, override, requested);
  }
  if (requested === "economicResourceOperation") {
    return lowerEconomicResourceOperation(emitter, field, name, ctx, path);
  }
  if (requested === "triggeredModifierBlock") {
    return lowerTriggeredModifier(emitter, field, name, ctx, override, path);
  }
  if (requested === "value") {
    return lowerValue(emitter, field, name, widening);
  }
  if (requested === "struct") {
    return lowerStruct(emitter, field, name, path, ctx);
  }
  if (requested === "structMap") {
    return lowerStructMap(emitter, field, name, path, ctx, override?.nestedTypeName);
  }
  if (requested === "scalarMap") {
    return lowerScalarMap(emitter, field, name);
  }
  if (requested === "weightedEvents") {
    return lowerWeightedEvents(emitter, field, name);
  }
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
  const scalarArms = group.filter((field) => field.type.kind !== "block");
  const blockArms = group.filter((field) => field.type.kind === "block");
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
    metadata:
      `{ key: ${JSON.stringify(name)}, member: ${JSON.stringify(camelCase(name))}, ` +
      `shape: "dual", arms: [${arms.map((arm) => arm.metadata).join(", ")}] }`,
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
  const base = emitter.useValue(value).type + (widening === undefined ? "" : ` | ${widening}`);
  return {
    memberType: repeated[0]! ? arrayType(base) : base,
    metadata: metadata(group[0]!, name, "value", scalarMetadata(value)),
    admits: admitsScalars(group[0]!, "value", widening === undefined ? value : null),
  };
}

export function pickOrdinary(
  emitter: Emitter,
  declared: readonly RuleField[],
  name: string,
  ctx: FieldContext,
  override: ContentFieldOverride | undefined,
  widening: string | undefined,
  path: string
): LoweredField | null {
  return assertedAssetPath(
    emitter,
    pickLowering(emitter, declared, name, ctx, override, widening, path),
    declared,
    name,
    widening,
    path
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
