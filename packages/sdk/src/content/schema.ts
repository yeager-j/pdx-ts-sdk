import type { ContentShape } from "../generated/content-shape.ts";

/**
 * Generated field metadata and registry descriptors consumed by the content lowerer.
 *
 * This module is the runtime protocol shared with the CWT code generator.
 */

export interface ContentLocalisation {
  readonly member: string;
  readonly pattern: string;
  readonly required: boolean;
  /**
   * Names a sibling boolean member that waives {@link required} when it is
   * `true` — a slot the rules require unless the definition opts out of
   * needing its own text (`tradition_swap.name`, required unless
   * `inherit_name = yes`). `required` itself stays the type's static
   * optionality (`name?: string`, since the field is genuinely optional on
   * *some* definitions); this only sharpens the runtime check.
   */
  readonly requiredUnless?: string;
  /**
   * Names the raw-key body member the game actually reads this slot's text
   * through (SDK-50's synthetic localisation slots — see
   * `SYNTHETIC_LOCALISATION`). A generated key with nothing in the
   * definition body pointing at it is unreachable in game, so
   * `ContentAuthoring.define` defaults this member to the slot's own
   * computed key whenever the slot's text is set and the pointer member is
   * not already set by the author — the two are produced together, never as
   * something an author can end up with only half of.
   */
  readonly pointerMember?: string;
}

export interface ContentFieldBase {
  readonly key: string;
  readonly member: string;
  readonly repeated?: boolean;
  /**
   * The one authored form this field's member accepts, precomputed by codegen
   * from the field's own `shape` (and, for a `struct`, whether it repeats or
   * is wrapped) — see `authoredForm` in `@pdx-ts/codegen-cwt`'s
   * `emit/authored-form.ts`. The runtime dual-arm dispatcher below only ever
   * reads this; it never reclassifies a shape into a form itself.
   */
  readonly form: AuthoredForm;
}

/**
 * The content types an id-valued field may name, present only when the rules
 * say *every* form the field admits is a `<type>` reference.
 *
 * It is what makes the dangling-reference guard registry-aware rather than
 * merely existence-aware: a technology named as a prerequisite has to be a
 * built technology, not any built thing. A field that also admits plain
 * scalars carries none, because an id-shaped value in it proves nothing.
 */
export interface ContentRefTypes {
  readonly refTypes?: readonly string[];
}

interface ContentValueField extends ContentFieldBase, ContentRefTypes {
  readonly shape: "value";
  readonly conversion: "identity" | "ref";
  /**
   * The rules type this field's raw value as a localisation key rather than
   * free text (CWT's bare `= localisation`, distinct from a `"$"`-pattern
   * slot the {@link ContentLocalisation} pipeline auto-generates a key for).
   * `contentScalar` uses it to warn when an authored value looks like prose
   * rather than a key (SDK-50) — the game shows an unresolved key verbatim,
   * with no error, so this is the closest the SDK can get to catching it.
   */
  readonly locKey?: true;
}

interface ContentValueListField extends ContentFieldBase, ContentRefTypes {
  readonly shape: "valueList";
  readonly conversion: "identity" | "ref";
  readonly quoted?: boolean;
}

interface ContentTriggerField extends ContentFieldBase {
  readonly shape: "trigger";
}

interface ContentEffectField extends ContentFieldBase {
  readonly shape: "effect";
}

interface ContentEconomicResourcesField extends ContentFieldBase {
  readonly shape: "economicResources";
}

/** One directly-authored {@link EconomicResourceOperation}, rather than an economic template. */
interface ContentEconomicResourceOperationField extends ContentFieldBase {
  readonly shape: "economicResourceOperation";
}

/**
 * {@link ContentEconomicResourcesField} for a field CWT splices from
 * `economic_template_no_produce` rather than plain `economic_template` — the
 * writer iterates a different, `produces`-free operation list for this shape
 * (see `economicResourceBlock` below), so a cast that forces a `produces` arm
 * past {@link EconomicResourceBlockNoProduce}'s type is still unemittable.
 */
interface ContentEconomicResourcesNoProduceField extends ContentFieldBase {
  readonly shape: "economicResourcesNoProduce";
}

interface ContentTriggeredModifierField extends ContentFieldBase {
  readonly shape: "triggeredModifierBlock";
}

interface ContentModifierField extends ContentFieldBase {
  readonly shape: "modifierBlock";
}

/**
 * A modifier clause spliced unkeyed into the definition's own body.
 *
 * `static_modifier` declares `alias_name[modifier] = alias_match_left[modifier]`
 * at the top level of its rule, so vanilla writes the modifier names at the
 * block root next to the metadata keys — `empire_base = { max_rivalries = 3 }`,
 * with no `modifier = { ... }` wrapper. Carries no `key` because the game reads
 * none, and no `repeated` because one closure records every row.
 */
interface ContentInlineModifiersField {
  readonly shape: "inlineModifiers";
  readonly member: string;
}

/** A trigger spliced directly into its owning struct, with no game key. */
interface ContentInlineTriggerField {
  readonly shape: "inlineTrigger";
  readonly member: string;
}

interface ContentWeightField extends ContentFieldBase {
  readonly shape: "weightBlock";
}

/** Same runtime shape as {@link ContentWeightField}; its rows require `desc`. */
interface ContentWeightWithLocField extends ContentFieldBase {
  readonly shape: "weightBlockWithLoc";
}

/**
 * A field CWT declares more than once at forms that are not the same kind of
 * thing: `stages.end = 100` beside `end = { base = 100 modifier = { ... } }`,
 * `picture = "GFX_x"` beside `picture = { trigger = { ... } picture = ... }`.
 *
 * Both declarations are legal and the shipped game writes both, so picking one
 * is wrong in whichever direction that registry's corpus happens to lean — it
 * leaves a form no author can produce. The field admits every declared arm and
 * the writer dispatches on what the author passed.
 *
 * Each arm carries its own complete lowering, which is what keeps this from
 * needing to know anything about the shapes it dispatches to: writing an arm is
 * writing an ordinary field whose value happens to have arrived here.
 */
export interface ContentDualField {
  readonly shape: "dual";
  readonly key: string;
  readonly member: string;
  /**
   * In CWT declaration order. Exactly one accepts any given authored value.
   *
   * Typed as {@link ContentDualArm} rather than the full {@link ContentField}
   * union: an arm is always built from a single ordinary declaration (see
   * codegen's `lowerDual`), never from another dual or a top-level splice, so
   * every arm actually carries the `form` the dispatcher below reads.
   */
  readonly arms: readonly ContentDualArm[];
}

/**
 * A block of `<weight> = <event>` rows (`random_events = { 100 = my_event.1
 * 20 = 0 }`). An entry with no `event` emits the `0` nothing-happens arm.
 */
interface ContentWeightedEventsField extends ContentFieldBase, ContentRefTypes {
  readonly shape: "weightedEvents";
  readonly conversion: "identity" | "ref";
}

/**
 * An anonymous, identity-less block: `text = { trigger = { ... } }` written N
 * times (shape 3), generalized down to whatever cardinality CWT declares — a
 * singular fixed-shape block like `forbidden_peace_offers` is just the N=0..1
 * case of the same mechanism, so `repeated` (from {@link ContentFieldBase})
 * decides `T` versus `T[]` exactly like every other shape.
 */
interface ContentStructField extends ContentFieldBase {
  readonly shape: "struct";
  readonly fields: readonly ContentField[];
  /**
   * True when CWT nests the repetition as bare anonymous blocks inside one
   * enclosing field (`discrete_terms = { { key = .. value = .. } ... }`)
   * rather than repeating `key` itself at the sibling level. Always implies
   * an array value, independent of `repeated`.
   */
  readonly wrapped?: boolean;
}

/** A struct whose `when` member writes direct trigger entries beside its named siblings. */
interface ContentTriggerStructField extends ContentFieldBase {
  readonly shape: "triggerStruct";
  readonly fields: readonly ContentField[];
}

/**
 * A block spliced from a CWT alias category that refers back to itself.
 *
 * `government_trigger`'s `OR`/`AND`/`limit` members each contain the whole
 * category again, so their field table cannot be written inline the way
 * {@link ContentStructField} writes its members — the constant would reference
 * itself before it is initialised. Naming the category instead and resolving it
 * through {@link registerAliasStructFields} at write time is what breaks the
 * cycle; a generated module registers its table once at import.
 */
interface ContentAliasStructField extends ContentFieldBase {
  readonly shape: "aliasStruct";
  readonly category: string;
}

/**
 * A map whose keys are engine names rather than identities.
 *
 * CWT spells this exactly like {@link ContentRepeatedStructField}'s "container"
 * keying — a wildcard-keyed block inside a block — but the two mean opposite
 * things, and only the overlay can tell them apart. A situation's `stages` keys
 * are ids the mod invents and localises; a ship size's `section_slots` keys are
 * `mid`, `bow`, `core` and the integers `1`-`6`, names the engine and the ship
 * models already agree on and that section templates reference by
 * `slot = "mid"`. So these keys take no mod prefix, register no ids, and carry
 * no localisation — applying the identity rules here would rename `mid` out of
 * existence.
 *
 * Entry order is not meaningful either, which is what makes a plain object
 * safe: a repeated-struct record relies on insertion order to carry a stage
 * sequence, and depends on its mod-prefix rule to keep every key non-integer-
 * like, since JS iterates integer-like keys first. Slots are addressed by name,
 * so `1` sorting ahead of `mid` changes nothing.
 */
interface ContentStructMapField extends ContentFieldBase {
  readonly shape: "structMap";
  readonly fields: readonly ContentField[];
}

/**
 * The scalar-valued form of {@link ContentStructMapField}: an engine-keyed map
 * of plain values, `min_upgrade_cost = { alloys = 20 }` from CWT's
 * `{ <resource> = float }`.
 *
 * Keys stay `string`. `<resource>` and `<job>` are content references, but
 * `TypedRef` is a branded object and cannot be a `Record` key — the same reason
 * an economic block's `amounts` is `Record<string, number>`. Closing that is the
 * vanilla identifier package's job, not this shape's.
 */
interface ContentScalarMapField extends ContentFieldBase {
  readonly shape: "scalarMap";
}

/**
 * A named, ordered collection whose name is both identity and localization
 * key — the same distinction `name_field` draws for top-level registries, one
 * level down. Authored as `Readonly<Record<id, fields>>` rather than an array
 * carrying its own id, so the id cannot be omitted, cannot collide, and the
 * mod prefix applies at one point.
 */
interface ContentRepeatedStructField extends ContentFieldBase {
  readonly shape: "repeatedStruct";
  readonly fields: readonly ContentField[];
  readonly localisation: readonly ContentLocalisation[];
  /**
   * "siblings" (shape 2 — `approach = { name = approach_a ... }` repeated):
   * each record entry is its own `key` block with `identityKey` set to the
   * record key. "container" (shape 1 — `stages = { stage_1 = { ... } }`): one
   * `key` block wraps entries individually keyed by the record key itself.
   */
  readonly keying: "siblings" | "container";
  /** Body field the id is written into. Only meaningful when keying is "siblings". */
  readonly identityKey?: string;
}

/** Generated runtime lowering for one admitted content field. */
export type ContentField =
  | ContentValueField
  | ContentValueListField
  | ContentTriggerField
  | ContentEffectField
  | ContentEconomicResourcesField
  | ContentEconomicResourceOperationField
  | ContentEconomicResourcesNoProduceField
  | ContentTriggeredModifierField
  | ContentModifierField
  | ContentInlineModifiersField
  | ContentInlineTriggerField
  | ContentWeightField
  | ContentWeightWithLocField
  | ContentDualField
  | ContentWeightedEventsField
  | ContentStructField
  | ContentTriggerStructField
  | ContentAliasStructField
  | ContentStructMapField
  | ContentScalarMapField
  | ContentRepeatedStructField;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

const CONTENT_SHAPE_PROTOCOL_IS_EXACT: Equal<ContentField["shape"], ContentShape> = true;
void CONTENT_SHAPE_PROTOCOL_IS_EXACT;

/**
 * Every shape a dual field's arm can actually be lowered to — every
 * {@link ContentField} variant except the two that can never occur there: a
 * dual cannot nest inside another dual, and a top-level splice
 * ({@link ContentInlineModifiersField}) is never built by the arm pipeline.
 * Narrowing here (rather than widening those two to carry a `form` they never
 * need) is what lets {@link dualArm} read `.form` off an arm without a runtime
 * guard.
 */
export type ContentDualArm = Exclude<
  ContentField,
  ContentDualField | ContentInlineModifiersField | ContentInlineTriggerField
>;

/**
 * The five shapes an authored value can arrive in, which is all the writer
 * needs to tell one {@link ContentDualField} arm from another.
 *
 * A `Trigger` is a callable carrying `kind: "trigger"` — the call signature
 * exists to poison truthiness — so it has to be recognised before the plain
 * function test, or every trigger would read as a closure.
 */
export type AuthoredForm = "scalar" | "list" | "trigger" | "closure" | "block";

export function authoredForm(value: unknown): AuthoredForm {
  if (Array.isArray(value)) {
    return "list";
  }
  if (typeof value !== "object" && typeof value !== "function") {
    return "scalar";
  }
  if ((value as { readonly kind?: unknown } | null)?.kind === "trigger") {
    return "trigger";
  }
  return typeof value === "function" ? "closure" : "block";
}

const ALIAS_STRUCT_FIELDS = new Map<string, readonly ContentField[]>();

/**
 * Publishes one alias category's field table under its CWT category name.
 *
 * Generated modules call this at import time. Keeping the table in a
 * module-level map rather than on the descriptor is deliberate: a
 * self-recursive category (`government_trigger`) has no non-circular inline
 * spelling, and a name resolved on write is the only lookup that terminates.
 */
export function registerAliasStructFields(category: string, fields: readonly ContentField[]): void {
  ALIAS_STRUCT_FIELDS.set(category, fields);
}

export function aliasStructFieldsOf(category: string): readonly ContentField[] {
  const fields = ALIAS_STRUCT_FIELDS.get(category);
  if (fields === undefined) {
    throw new Error(
      `No field table registered for alias category "${category}" — the generated ` +
        "module that declares it must be imported before rendering"
    );
  }
  return fields;
}

/** Generated description of one authorable content registry. */
export interface ContentRegistryDescriptor {
  readonly type: string;
  /**
   * The CWT reference this registry's definitions satisfy — usually its own
   * name, and `component_template.utility_component_template` for a registry
   * the manifest split out of a shared CWT type. It is what a field holding
   * `<component_template>` is asking for, so it is what an item brands itself
   * with and what the build's dangling-reference guard resolves against.
   */
  readonly referenceName: string;
  readonly outputDir: string;
  readonly fileStem: string;
  readonly fields: readonly ContentField[];
  readonly localisation: readonly ContentLocalisation[];
  /**
   * Set when the registry keys entries by a repeated keyword instead of by the
   * id — `utility_component_template = { key = "..." }` rather than
   * `my_id = { ... }`. `keyword` is the literal top-level key and `nameField`
   * the body field the id moves into.
   */
  readonly keyedBy?: { readonly keyword: string; readonly nameField: string };
}
