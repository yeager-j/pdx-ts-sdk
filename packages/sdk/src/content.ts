/**
 * Generic content authoring: one writer and registry for every generated
 * content-type description.
 */

import {
  block,
  container,
  kv,
  list,
  quoted,
  scalar,
  serialize,
  varRef,
  type PdxEntry,
  type PdxScalar,
} from "@pdx-ts/pdxscript";

import { underField, type ContentRefSink, type ContentRefUse } from "./content-refs.ts";
import {
  modifierDescKey,
  modifierEntry,
  recordEffects,
  registerModifierDescKey,
  scriptCtx,
  type Modifier,
  type ModifierWithLoc,
  type ScriptCtx,
} from "./effect-core.ts";
import type { ScopeObjOf } from "./generated/effects.ts";
import type { ScopedModifierBlock, ScopedModifierRecorder } from "./generated/modifiers.ts";
import { refId, type EconomicCategoryRef, type TypedRef } from "./generated/refs.ts";
import type { ScopeName } from "./generated/scopes.ts";
import { scriptValueScalar, type ScriptValue, type Trigger } from "./trigger-core.ts";

/**
 * The declared escape hatch for modifier names the generated tables cannot
 * know: scripted modifiers this or another mod defines. Declaration-merge the
 * names in and `raw()` accepts them — including template patterns, which admit
 * a whole generated family at once:
 *
 *     declare module "@pdx-ts/sdk" {
 *       interface CustomModifiers {
 *         readonly my_scripted_modifier?: number;
 *         readonly [k: `mymod_${string}`]: number | undefined;
 *       }
 *     }
 */
export interface CustomModifiers {}

/**
 * The known modifier names for scope `S`, as one flat interface.
 *
 * This types `raw()`'s name parameter, never an authoring position: a flat
 * 45k-property type makes the editor build one enormous completion menu, which
 * is exactly what {@link ModifierClosure}'s path recorder exists to avoid.
 */
export type ModifierBlock<S extends ScopeName = ScopeName> = ScopedModifierBlock<S>;

/**
 * Records the modifiers a definition applies, scope-checked segment by segment.
 *
 * The traversed path spells the game's flat modifier name — the closure below
 * emits `country_unity_produces_mult = 0.01`:
 *
 *     modifier: (m) => m.country.unity.produces.mult(0.01)
 *
 * Each `.` completes from a small menu instead of one 45k-entry list, and a
 * typo in any segment is a compile error. Escape hatches: `m.raw(name, value)`
 * checks a flat name against every known name plus {@link CustomModifiers};
 * `m.unchecked(name, value)` accepts any string.
 */
export type ModifierClosure<S extends ScopeName = ScopeName> = (
  m: ScopedModifierRecorder<S>
) => void;

/** One cost/production/upkeep/logistics arm inside an economic `resources` block. */
export interface EconomicResourceOperation<S extends ScopeName> {
  /** Open resource ids and their numeric amounts. */
  readonly amounts: Readonly<Record<string, number>>;
  /** Optional in-game condition for applying this arm. */
  readonly when?: Trigger<S>;
  /** Repeated scripted multipliers, emitted under `multiplier`. */
  readonly multiplier?: ScriptValue | readonly ScriptValue[];
  /** Repeated scripted multipliers, emitted under the game's shorter `mult` spelling. */
  readonly mult?: ScriptValue | readonly ScriptValue[];
}

/** A reusable economic-template block used by edicts and dozens of other registries. */
export interface EconomicResourceBlock<S extends ScopeName> {
  /** Economic category used to generate modifier names and tooltips. */
  readonly category?: EconomicCategoryRef | string;
  /** Resources paid when the owning definition activates. */
  readonly cost?: EconomicResourceOperation<S>;
  /** Resources produced by the owning definition. */
  readonly produces?: EconomicResourceOperation<S>;
  /** Recurring resource upkeep. */
  readonly upkeep?: EconomicResourceOperation<S>;
  /** Logistics contribution used by the game's economic system. */
  readonly logistics?: EconomicResourceOperation<S>;
}

/**
 * {@link EconomicResourceBlock} without `produces`, for CWT's
 * `economic_template_no_produce` splice — the same open resource-name map,
 * minus the one arm that splice does not admit.
 *
 * Derived with `Omit` rather than duplicating the other three members so a
 * future change to {@link EconomicResourceBlock} (a new arm, a widened
 * `category`) flows through here automatically instead of risking drift
 * between two hand-kept copies.
 *
 * `economic_template_no_produce` is spliced at three sites in the vendored
 * rules today: `weapon_component_template` and
 * `strike_craft_component_template`'s own `resources`
 * (`components.cwt:189`, `:338`), and `espionage_operation.resources`
 * (`espionage.cwt:113`), not yet an exposed registry. This type exists so the
 * next registry that splices it gets correct typing for free rather than
 * needing its own overlay investigation.
 */
export type EconomicResourceBlockNoProduce<S extends ScopeName> = Omit<
  EconomicResourceBlock<S>,
  "produces"
>;

/**
 * The `complex_maths_enum` operations `modifier_rule.cwt:1-3` allows directly
 * alongside `base`, sibling to the `modifier` rows rather than inside one —
 * the same measured member set {@link Modifier} carries at row level, minus
 * `desc`/`when` which only make sense on a gated row. `Omit` rather than a
 * hand-kept duplicate, so a future change to `Modifier`'s numeric arms flows
 * through here automatically, the same reasoning as {@link
 * EconomicResourceBlockNoProduce}.
 *
 * Vanilla favors this top-level spelling for a block's own always-applied
 * weight: in `common/traditions/`, 292 of 293 `weight`/`ai_weight` blocks set
 * a top-level `factor` rather than `base`, and across all `ai_weight` blocks
 * under `common/`, top-level `weight` (2,255) outnumbers `base` (848).
 */
export type WeightBlockOperations<S extends ScopeName> = Omit<Modifier<S>, "desc" | "when">;

/**
 * A `modifier_rule` block: optional base weight, the same weight operations
 * directly as siblings of `base` (see {@link WeightBlockOperations}), plus
 * gated adjustments.
 *
 * `M` defaults to plain {@link Modifier} (`desc` optional); `WeightBlockWithLoc`
 * below is the same shape with `M` pinned to {@link ModifierWithLoc} for
 * `modifier_rule_with_loc` consumers, not a separate runtime concept — the
 * writer lowers both through the same `weightBlock` function.
 */
export interface WeightBlock<
  S extends ScopeName,
  M extends Modifier<S> = Modifier<S>,
> extends WeightBlockOperations<S> {
  /** Starting weight before modifiers. */
  readonly base?: number;
  /** Conditional adjustments emitted as repeated `modifier` blocks. */
  readonly modifiers?: readonly M[];
}

/**
 * A {@link WeightBlock} whose rows require `desc`, matching
 * `modifier_rule_with_loc` (e.g. `situation_type.monthly_progress`).
 */
export type WeightBlockWithLoc<S extends ScopeName> = WeightBlock<S, ModifierWithLoc<S>>;

/**
 * A script effect block recorded against the scope declared by the content
 * rules, with the ambient scopes that block runs in as a second argument.
 *
 * `From` is the scope the game hands the block as FROM, where the rules name
 * one (`## replace_scopes = { this = fleet from = archaeological_site }`):
 *
 *     onRollFailed: (fleet, ctx) => {
 *       ctx.from.effects((site) => { ... });
 *     }
 *
 * It defaults to undeclared, and `ctx.from` is then an inert sentinel rather
 * than a ref — a block whose FROM nothing describes must not be navigated.
 */
export type EffectBlock<S extends ScopeName, From extends ScopeName | undefined = undefined> = (
  scope: ScopeObjOf<S>,
  ctx: ScriptCtx<S, From>
) => void;

/**
 * A declarative field whose rules give the block a FROM: the value itself, or
 * a closure handed the block's scopes that returns it.
 *
 *     allow: (ctx) => ctx.from.trigger(hasSiteFlag("x"))
 *
 * A trigger and a weight block are values, not closures, so there is no
 * argument list to put FROM in — this adds one. The plain form stays: a
 * condition that never names FROM has no reason to grow a closure around it.
 *
 * Emitted only where the rules name a FROM, so the type's presence on a field
 * *is* the statement that FROM means something there. The closure runs once,
 * at definition time (see `ContentAuthoring.define`), so what the definition
 * carries from then on is the ordinary value.
 */
export type WithFrom<T, S extends ScopeName, From extends ScopeName | undefined = undefined> =
  T | ((ctx: ScriptCtx<S, From>) => T);

/** The common potential-plus-modifiers form behind `triggered_modifier_clause`. */
export interface TriggeredModifier<S extends ScopeName> {
  /** In-game condition emitted under the clause's `potential` block. */
  readonly when?: Trigger<S>;
  /** Optional localization key identifying the clause. */
  readonly key?: string;
  /** Whether the modifier remains visible when its potential fails. */
  readonly showIfNotPotential?: boolean;
  /** Replacement text shown when the potential fails. */
  readonly notPotentialOverrideTextKey?: string;
  /** Modifiers nested under an explicit `modifier` block. */
  readonly modifier?: ModifierClosure<S>;
  /** Modifiers spliced directly into the triggered-modifier block. */
  readonly modifiers?: ModifierClosure<S>;
  /** Optional localization key describing the modifier. */
  readonly description?: string;
  /** Values substituted into the description localization. */
  readonly descriptionParameters?: Readonly<Record<string, string>>;
  /** Hides generated modifier text in favor of `customTooltip`. */
  readonly showOnlyCustomTooltip?: boolean;
  /** Custom tooltip localization key. */
  readonly customTooltip?: string;
  /** Repeated scripted multipliers emitted under `mult`. */
  readonly mult?: ScriptValue | readonly ScriptValue[];
  /** Repeated scripted multipliers emitted under `multiplier`. */
  readonly multiplier?: ScriptValue | readonly ScriptValue[];
}

/** Generated description of one localization slot on a content definition. */
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

interface ContentFieldBase {
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
interface ContentRefTypes {
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
interface ContentDualField {
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
  | ContentEconomicResourcesNoProduceField
  | ContentTriggeredModifierField
  | ContentModifierField
  | ContentInlineModifiersField
  | ContentWeightField
  | ContentWeightWithLocField
  | ContentDualField
  | ContentWeightedEventsField
  | ContentStructField
  | ContentAliasStructField
  | ContentStructMapField
  | ContentScalarMapField
  | ContentRepeatedStructField;

/**
 * Every shape a dual field's arm can actually be lowered to — every
 * {@link ContentField} variant except the two that can never occur there: a
 * dual cannot nest inside another dual, and a top-level splice
 * ({@link ContentInlineModifiersField}) is never built by the arm pipeline.
 * Narrowing here (rather than widening those two to carry a `form` they never
 * need) is what lets {@link dualArm} read `.form` off an arm without a runtime
 * guard.
 */
type ContentDualArm = Exclude<ContentField, ContentDualField | ContentInlineModifiersField>;

/**
 * The five shapes an authored value can arrive in, which is all the writer
 * needs to tell one {@link ContentDualField} arm from another.
 *
 * A `Trigger` is a callable carrying `kind: "trigger"` — the call signature
 * exists to poison truthiness — so it has to be recognised before the plain
 * function test, or every trigger would read as a closure.
 */
export type AuthoredForm = "scalar" | "list" | "trigger" | "closure" | "block";

function authoredForm(value: unknown): AuthoredForm {
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

/**
 * Whether a value is a content reference: `TypedRef` is `{ id }`, which is an
 * object at runtime and a scalar in the file.
 *
 * The brand is a phantom property and absent at runtime, so `id` is the only
 * signature there is. That is why this alone cannot place a value — see
 * {@link dualArm}, which asks it only once an arm has claimed references.
 */
function isReference(value: unknown): value is TypedRef<string> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly id?: unknown }).id === "string"
  );
}

/**
 * The arm of a dual field that accepts what the author passed.
 *
 * A reference is the one value whose own shape cannot place it: `refId` unwraps
 * either an id string or a `{ id }` object, so an authored reference looks like
 * a block and belongs on a scalar arm. The arm's declared `conversion` settles
 * it — asking the metadata rather than guessing from the value keeps the
 * decision where the emitter already made it. Passing a reference where no arm
 * takes one falls through to the ordinary form matching, so a struct arm still
 * gets a struct that happens to carry an `id` member.
 *
 * Throws rather than guessing when nothing matches. The generated types make
 * the wrong form a compile error, so reaching there means either a cast or an
 * arm pair the emitter should not have produced, and both deserve to be loud.
 */
function dualArm(field: ContentDualField, value: unknown): ContentDualArm {
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

/**
 * Shapes a {@link WithFrom} closure can stand in for: the declarative values
 * that can hold a condition, and so can want FROM.
 *
 * `effect` and `modifierBlock` are closures already and are not in this set —
 * their closure *is* the value, not a way of computing one.
 */
function acceptsFromClosure(field: ContentField): boolean {
  switch (field.shape) {
    case "trigger":
    case "weightBlock":
    case "weightBlockWithLoc":
    case "economicResources":
    case "economicResourcesNoProduce":
    case "triggeredModifierBlock":
      return true;
    case "dual":
      return field.arms.some(acceptsFromClosure);
    default:
      return false;
  }
}

/**
 * Collapses a field's closure form to the value it returns.
 *
 * A `Trigger` is itself callable — the poisoned signature that makes
 * `if (someTrigger)` a compile error — so `typeof value === "function"` is not
 * enough to tell a closure from a condition, exactly as in {@link authoredForm}.
 */
function resolveFromClosure(field: ContentField, value: unknown): unknown {
  if (typeof value !== "function" || !acceptsFromClosure(field)) {
    return value;
  }
  if ((value as { readonly kind?: unknown }).kind === "trigger") {
    return value;
  }
  return (value as (ctx: ScriptCtx<ScopeName, ScopeName>) => unknown)(
    scriptCtx<ScopeName, ScopeName>()
  );
}

/**
 * Runs every {@link WithFrom} closure in a definition, once, and returns the
 * definition with their results in their place.
 *
 * Once, and here, because a modifier row's generated `desc` key is registered
 * against the row's object identity — running the closure again at write time
 * would produce a different object and lose the key. Resolving at definition
 * time also keeps what `DefinedContent.def` carries plain data: everything
 * downstream sees the same value the plain form would have produced.
 *
 * Recurses the same three ways the definition walk does — `dual` arms, plain
 * and repeated `struct` nesting, and `repeatedStruct` entries — since a
 * condition several levels down is scoped by the rules just the same.
 */
function resolveFromClosures(
  def: Readonly<Record<string, unknown>>,
  fields: readonly ContentField[]
): Readonly<Record<string, unknown>> {
  const resolved: Record<string, unknown> = { ...def };
  for (const field of fields) {
    const value = def[field.member];
    if (value === undefined) {
      continue;
    }
    if (acceptsFromClosure(field)) {
      resolved[field.member] = resolveFromClosure(field, value);
      continue;
    }
    if (field.shape === "struct") {
      resolved[field.member] = field.repeated
        ? (value as readonly Readonly<Record<string, unknown>>[]).map((item) =>
            resolveFromClosures(item, field.fields)
          )
        : resolveFromClosures(value as Readonly<Record<string, unknown>>, field.fields);
      continue;
    }
    if (field.shape === "repeatedStruct") {
      const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      resolved[field.member] = Object.fromEntries(
        Object.entries(record).map(([id, nested]) => [
          id,
          resolveFromClosures(nested, field.fields),
        ])
      );
    }
  }
  return resolved;
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

function aliasStructFieldsOf(category: string): readonly ContentField[] {
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

/** The reference vocabulary lives in `content-refs.ts` because the trigger and
 * effect encoders record them too; it is re-exported here where content
 * lowering — the first and densest producer — is defined. */
export type { ContentRefSink, ContentRefUse } from "./content-refs.ts";

/** A definition registered with a mod and usable as a typed cross-reference. */
export interface DefinedContent<
  K extends string,
  D extends { readonly id: string },
> extends TypedRef<K> {
  readonly id: D["id"];
  readonly def: D;
  /** Lowers the definition, reporting every reference it writes to `collect`. */
  toEntries(collect?: ContentRefSink): PdxEntry;
}

type ContentDef = { readonly id: string };
type LocalisationEntry = readonly [key: string, text: string];
type RegisterLoc = (entries: readonly LocalisationEntry[]) => void;

/** Accumulates the reference sink plus the dotted path to the current level. */
interface LoweringContext {
  readonly collect: ContentRefSink;
  readonly path: string;
}

function childContext(
  ctx: LoweringContext | undefined,
  segment: string
): LoweringContext | undefined {
  return ctx === undefined ? ctx : { collect: ctx.collect, path: joinPath(ctx.path, segment) };
}

function joinPath(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

/** Reports references a spliced trigger or effect closure recorded, re-rooted
 * under the field that holds them so the diagnostic names the whole path. */
function collectRefs(
  ctx: LoweringContext | undefined,
  refs: readonly ContentRefUse[],
  segment: string
): void {
  if (ctx === undefined) {
    return;
  }
  for (const use of underField(refs, joinPath(ctx.path, segment))) {
    ctx.collect(use);
  }
}

function contentScalar(
  value: unknown,
  field: ContentFieldBase & ContentRefTypes & { readonly conversion: "identity" | "ref" },
  quote: boolean,
  ctx?: LoweringContext
): PdxScalar {
  const converted = field.conversion === "ref" ? refId(value as TypedRef<string> | string) : value;
  if (ctx !== undefined && field.refTypes !== undefined && typeof converted === "string") {
    ctx.collect({
      targets: field.refTypes,
      id: converted,
      field: joinPath(ctx.path, field.key),
    });
  }
  if (quote) {
    return quoted(String(converted));
  }
  // A `@name` scripted-variable reference has to become a `var` node to write
  // bare (`base = @name`) — passed through as a plain string, pdxscript's
  // serializer quotes it defensively, and the game reads a literal instead of
  // evaluating the variable. Every `value_field`-typed field (a `ScriptValue`)
  // can carry this form, and no other field's real vanilla domain admits a
  // leading `@`, so the check is safe unconditionally rather than gated on
  // which field this is.
  if (typeof converted === "string" && converted.startsWith("@")) {
    return varRef(converted);
  }
  return scalar(converted as string | number | boolean);
}

/**
 * The recorder behind {@link ModifierClosure}: property access extends the
 * path, a call joins it with `_` into the flat name the game reads. One proxy
 * shape serves every scope — the generated recorder interfaces are the only
 * thing keeping paths honest, exactly like the effect recorder.
 */
function modifierRecorder(record: (name: string, amount: number) => void): unknown {
  const node = (path: readonly string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        if (path.length === 0 && (prop === "raw" || prop === "unchecked")) {
          return (name: string, amount: number) => record(name, amount);
        }
        return node([...path, prop]);
      },
      apply(_target, _thisArg, args) {
        record(path.join("_"), args[0] as number);
      },
    });
  return node([]);
}

function modifierEntries(closure: ModifierClosure): PdxEntry[] {
  const entries: PdxEntry[] = [];
  closure(modifierRecorder((name, amount) => entries.push(kv(name, amount))) as never);
  return entries;
}

function modifierBlock(key: string, value: ModifierClosure): PdxEntry {
  return block(key, modifierEntries(value));
}

/**
 * Lowers {@link WeightBlockOperations}'s numeric arms in a fixed sequence —
 * mirroring `modifierEntry`'s row-level order, since both read the same
 * `complex_maths_enum` — so emission never depends on the order an author's
 * object literal happened to declare its members in.
 */
function weightOperationEntries(value: WeightBlockOperations<ScopeName>): PdxEntry[] {
  const entries: PdxEntry[] = [];
  if (value.factor !== undefined) {
    entries.push(kv("factor", value.factor));
  }
  if (value.add !== undefined) {
    entries.push(kv("add", value.add));
  }
  if (value.weight !== undefined) {
    entries.push(kv("weight", value.weight));
  }
  if (value.subtract !== undefined) {
    entries.push(kv("subtract", value.subtract));
  }
  if (value.mult !== undefined) {
    entries.push(kv("mult", value.mult));
  }
  if (value.multiplier !== undefined) {
    entries.push(kv("multiply", value.multiplier));
  }
  if (value.divide !== undefined) {
    entries.push(kv("divide", value.divide));
  }
  if (value.minValue !== undefined) {
    entries.push(kv("min", value.minValue));
  }
  if (value.maxValue !== undefined) {
    entries.push(kv("max", value.maxValue));
  }
  return entries;
}

function weightBlock(key: string, value: WeightBlock<ScopeName>, ctx?: LoweringContext): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.base !== undefined) {
    entries.push(kv("base", value.base));
  }
  entries.push(...weightOperationEntries(value));
  const refs: ContentRefUse[] = [];
  entries.push(...(value.modifiers ?? []).map((modifier) => modifierEntry(modifier, refs)));
  collectRefs(ctx, refs, key);
  return block(key, entries);
}

function repeatedNumbers(
  key: string,
  value: ScriptValue | readonly ScriptValue[] | undefined
): PdxEntry[] {
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map((item) => kv(key, scriptValueScalar(item)));
}

function economicOperation(
  key: string,
  value: EconomicResourceOperation<ScopeName>,
  ctx?: LoweringContext
): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.when !== undefined) {
    entries.push(block("trigger", [...value.when.entries]));
    collectRefs(ctx, value.when.refs, `${key}.trigger`);
  }
  entries.push(...Object.entries(value.amounts).map(([resource, amount]) => kv(resource, amount)));
  entries.push(...repeatedNumbers("multiplier", value.multiplier));
  entries.push(...repeatedNumbers("mult", value.mult));
  return block(key, entries);
}

/** Every operation {@link economicResourceBlock} can iterate, in emission order. */
type EconomicResourceOperationKey = "cost" | "produces" | "upkeep" | "logistics";

/** The full arm list — every registry splicing plain `economic_template`. */
const ECONOMIC_RESOURCE_OPERATIONS: readonly EconomicResourceOperationKey[] = [
  "cost",
  "produces",
  "upkeep",
  "logistics",
];

/**
 * `economic_template_no_produce`'s arm list — `produces` left out entirely.
 *
 * `economicResourcesNoProduce` fields are typed as
 * {@link EconomicResourceBlockNoProduce}, which already keeps `produces`
 * uncompilable, but a cast can still force one past that type. Iterating this
 * shorter list rather than filtering the four-element one at the value level
 * is what keeps a cast-forced `produces` unemitted too: the loop below never
 * reads the key, so it does not matter whether the object carries it.
 */
const ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE: readonly EconomicResourceOperationKey[] = [
  "cost",
  "upkeep",
  "logistics",
];

function economicResourceBlock(
  key: string,
  value: EconomicResourceBlock<ScopeName>,
  operations: readonly EconomicResourceOperationKey[],
  ctx?: LoweringContext
): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.category !== undefined) {
    const category = refId(value.category);
    // The one reference this shared shape holds; its registry is written into
    // the interface above rather than into any generated field table.
    ctx?.collect({
      targets: ["economic_category"],
      id: category,
      field: joinPath(ctx.path, `${key}.category`),
    });
    entries.push(kv("category", category));
  }
  for (const operation of operations) {
    const arm = value[operation];
    if (arm !== undefined) {
      entries.push(economicOperation(operation, arm, childContext(ctx, key)));
    }
  }
  return block(key, entries);
}

function triggeredModifierBlock(
  key: string,
  value: TriggeredModifier<ScopeName>,
  ctx?: LoweringContext
): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.when !== undefined) {
    entries.push(block("potential", [...value.when.entries]));
    collectRefs(ctx, value.when.refs, `${key}.potential`);
  }
  if (value.key !== undefined) {
    entries.push(kv("key", value.key));
  }
  if (value.showIfNotPotential !== undefined) {
    entries.push(kv("show_if_not_potential", value.showIfNotPotential));
  }
  if (value.notPotentialOverrideTextKey !== undefined) {
    entries.push(kv("not_potential_override_text_key", value.notPotentialOverrideTextKey));
  }
  if (value.modifier !== undefined) {
    entries.push(modifierBlock("modifier", value.modifier));
  }
  if (value.modifiers !== undefined) {
    entries.push(...modifierEntries(value.modifiers));
  }
  if (value.description !== undefined) {
    entries.push(kv("description", value.description));
  }
  if (value.descriptionParameters !== undefined) {
    entries.push(
      block(
        "description_parameters",
        Object.entries(value.descriptionParameters).map(([name, parameter]) => kv(name, parameter))
      )
    );
  }
  if (value.showOnlyCustomTooltip !== undefined) {
    entries.push(kv("show_only_custom_tooltip", value.showOnlyCustomTooltip));
  }
  if (value.customTooltip !== undefined) {
    entries.push(kv("custom_tooltip", value.customTooltip));
  }
  entries.push(...repeatedNumbers("mult", value.mult));
  entries.push(...repeatedNumbers("multiplier", value.multiplier));
  return block(key, entries);
}

function fieldEntries(
  def: Readonly<Record<string, unknown>>,
  fields: readonly ContentField[],
  ctx?: LoweringContext
) {
  const entries: PdxEntry[] = [];
  for (const field of fields) {
    const value = def[field.member];
    if (value === undefined) {
      continue;
    }
    switch (field.shape) {
      case "value": {
        const values = field.repeated ? (value as readonly unknown[]) : [value];
        for (const item of values) {
          entries.push(kv(field.key, contentScalar(item, field, false, ctx)));
        }
        break;
      }
      case "valueList": {
        const values = Array.isArray(value) ? value : [value];
        if (values.length > 0) {
          entries.push(
            list(
              field.key,
              values.map((item) => contentScalar(item, field, field.quoted ?? false, ctx))
            )
          );
        }
        break;
      }
      case "trigger":
        entries.push(block(field.key, [...(value as Trigger<ScopeName>).entries]));
        collectRefs(ctx, (value as Trigger<ScopeName>).refs, field.key);
        break;
      case "effect": {
        // A reference written inside a script closure is a reference like any
        // other; the recorder reports them here so they face the same
        // integrity check as the declarative fields around them.
        const recorded: ContentRefUse[] = [];
        // Every effect block gets the same ctx object: `this` and `from` are
        // fixed script paths, and which of them the block may *read* is the
        // generated signature's business, settled before this runs.
        const child = recordEffects(recorded, (scope) =>
          (value as EffectBlock<ScopeName, ScopeName>)(scope, scriptCtx<ScopeName, ScopeName>())
        );
        entries.push(block(field.key, child));
        collectRefs(ctx, recorded, field.key);
        break;
      }
      case "economicResources": {
        const values = field.repeated
          ? (value as readonly EconomicResourceBlock<ScopeName>[])
          : [value as EconomicResourceBlock<ScopeName>];
        entries.push(
          ...values.map((item) =>
            economicResourceBlock(field.key, item, ECONOMIC_RESOURCE_OPERATIONS, ctx)
          )
        );
        break;
      }
      case "economicResourcesNoProduce": {
        const values = field.repeated
          ? (value as readonly EconomicResourceBlockNoProduce<ScopeName>[])
          : [value as EconomicResourceBlockNoProduce<ScopeName>];
        entries.push(
          ...values.map((item) =>
            economicResourceBlock(
              field.key,
              item as EconomicResourceBlock<ScopeName>,
              ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE,
              ctx
            )
          )
        );
        break;
      }
      case "triggeredModifierBlock": {
        const values = field.repeated
          ? (value as readonly TriggeredModifier<ScopeName>[])
          : [value as TriggeredModifier<ScopeName>];
        entries.push(...values.map((item) => triggeredModifierBlock(field.key, item, ctx)));
        break;
      }
      case "modifierBlock":
        entries.push(modifierBlock(field.key, value as ModifierClosure));
        break;
      case "inlineModifiers":
        entries.push(...modifierEntries(value as ModifierClosure));
        break;
      case "weightBlock":
      case "weightBlockWithLoc":
        entries.push(weightBlock(field.key, value as WeightBlock<ScopeName>, ctx));
        break;
      case "dual": {
        // The arm is an ordinary field under the same member, so writing it is
        // one more turn of this same loop rather than a second implementation
        // of every shape a dual can reach.
        const arm = dualArm(field, value);
        entries.push(...fieldEntries({ [arm.member]: value }, [arm], ctx));
        break;
      }
      case "weightedEvents": {
        const arms = value as readonly { weight: number; event?: unknown }[];
        entries.push(
          block(
            field.key,
            arms.map((arm) =>
              kv(
                String(arm.weight),
                arm.event === undefined ? 0 : contentScalar(arm.event, field, false, ctx)
              )
            )
          )
        );
        break;
      }
      case "struct": {
        if (field.wrapped) {
          const items = value as readonly Readonly<Record<string, unknown>>[];
          entries.push(
            kv(
              field.key,
              container(
                items.map((item) =>
                  container(fieldEntries(item, field.fields, childContext(ctx, field.key)))
                )
              )
            )
          );
          break;
        }
        const values = field.repeated
          ? (value as readonly Readonly<Record<string, unknown>>[])
          : [value as Readonly<Record<string, unknown>>];
        entries.push(
          ...values.map((item) =>
            block(field.key, fieldEntries(item, field.fields, childContext(ctx, field.key)))
          )
        );
        break;
      }
      case "aliasStruct": {
        const nested = aliasStructFieldsOf(field.category);
        const values = field.repeated
          ? (value as readonly Readonly<Record<string, unknown>>[])
          : [value as Readonly<Record<string, unknown>>];
        entries.push(
          ...values.map((item) =>
            block(field.key, fieldEntries(item, nested, childContext(ctx, field.key)))
          )
        );
        break;
      }
      case "structMap": {
        const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        entries.push(
          block(
            field.key,
            Object.entries(record).map(([name, item]) =>
              block(name, fieldEntries(item, field.fields, childContext(ctx, field.key)))
            )
          )
        );
        break;
      }
      case "scalarMap": {
        const record = value as Readonly<Record<string, number | string>>;
        entries.push(
          block(
            field.key,
            Object.entries(record).map(([name, amount]) => kv(name, amount))
          )
        );
        break;
      }
      case "repeatedStruct": {
        const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        if (field.keying === "container") {
          entries.push(
            block(
              field.key,
              Object.entries(record).map(([id, item]) =>
                block(id, fieldEntries(item, field.fields, childContext(ctx, field.key)))
              )
            )
          );
          break;
        }
        for (const [id, item] of Object.entries(record)) {
          entries.push(
            block(field.key, [
              kv(field.identityKey!, id),
              ...fieldEntries(item, field.fields, childContext(ctx, field.key)),
            ])
          );
        }
        break;
      }
    }
  }
  return entries;
}

function toEntry(
  def: ContentDef,
  descriptor: ContentRegistryDescriptor,
  collect?: ContentRefSink
): PdxEntry {
  const fields = fieldEntries(
    def as Readonly<Record<string, unknown>>,
    descriptor.fields,
    collect === undefined ? undefined : { collect, path: "" }
  );
  if (descriptor.keyedBy === undefined) {
    return block(def.id, fields);
  }
  // The id leads the body: vanilla writes `key` first in every one of these,
  // and a definition whose id is buried mid-block is needlessly hard to read.
  return block(descriptor.keyedBy.keyword, [kv(descriptor.keyedBy.nameField, def.id), ...fields]);
}

class ContentDefinition<K extends string, D extends ContentDef> implements DefinedContent<K, D> {
  readonly id: D["id"];
  readonly def: D;
  private readonly descriptor: ContentRegistryDescriptor;

  constructor(def: D, descriptor: ContentRegistryDescriptor) {
    this.id = def.id;
    this.def = def;
    this.descriptor = descriptor;
  }

  toEntries(collect?: ContentRefSink): PdxEntry {
    return toEntry(this.def, this.descriptor, collect);
  }
}

function localisationKey(pattern: string, id: string): string {
  return pattern.replace("$", id);
}

export class ContentAuthoring {
  private readonly prefix: string;
  private readonly descriptors: readonly ContentRegistryDescriptor[];
  private readonly byType: ReadonlyMap<string, ContentRegistryDescriptor>;
  private readonly definitions = new Map<string, ContentDefinition<string, ContentDef>[]>();
  private readonly nestedIds = new Map<string, Set<string>>();
  private readonly registerLoc: RegisterLoc;
  private readonly onPrefixViolation: (message: string) => void;
  private readonly onUnstableDescKey: (message: string) => void;
  private readonly onLocKeyLooksLikeText: (message: string) => void;

  constructor(
    prefix: string,
    descriptors: readonly ContentRegistryDescriptor[],
    registerLoc: RegisterLoc,
    onPrefixViolation?: (message: string) => void,
    onUnstableDescKey?: (message: string) => void,
    onLocKeyLooksLikeText?: (message: string) => void
  ) {
    this.prefix = prefix;
    this.descriptors = descriptors;
    this.byType = new Map(descriptors.map((descriptor) => [descriptor.type, descriptor]));
    this.registerLoc = registerLoc;
    this.onPrefixViolation =
      onPrefixViolation ??
      ((message) => {
        throw new Error(message);
      });
    this.onUnstableDescKey = onUnstableDescKey ?? (() => {});
    // A warning, not an invariant: the SDK cannot know whether the string is
    // really prose or a real (if unconventional) key, so the no-op default
    // does not reject anything a direct `ContentAuthoring` caller writes.
    // `buildMod` supplies the callback that surfaces it on `mod.warnings`.
    this.onLocKeyLooksLikeText = onLocKeyLooksLikeText ?? ((): void => {});
  }

  define<K extends string, D extends ContentDef>(type: K, rawDef: D): DefinedContent<K, D> {
    const descriptor = this.byType.get(type);
    if (descriptor === undefined) {
      throw new Error(`Unknown generated content type "${type}"`);
    }
    // Before anything reads a field: a closure form is authoring sugar, and
    // everything below — desc keys, dual arms, the writer — works on values.
    const resolved = resolveFromClosures(
      rawDef as Readonly<Record<string, unknown>>,
      descriptor.fields
    ) as D;
    this.assertPrefixed(type, resolved.id);
    const definitions = this.definitions.get(type) ?? [];
    if (definitions.some((existing) => existing.id === resolved.id)) {
      throw new Error(`Duplicate ${type} id "${resolved.id}"`);
    }
    // A synthetic localisation slot's generated key is only reachable in
    // game through the body pointer the vendored rules actually read; fill
    // it in before either the .yml text or the body fields get collected, so
    // the two are never produced apart.
    const def = this.applySyntheticPointers(resolved, descriptor.localisation) as D;
    const localisation: LocalisationEntry[] = [];
    const nestedIds = new Map<string, Set<string>>();
    this.collectLocalisation(def.id, def, descriptor.localisation, localisation);
    this.collectRepeatedStructs(def.id, "", def, descriptor.fields, type, nestedIds, localisation);
    this.registerLoc(localisation);
    for (const [identity, pending] of nestedIds) {
      const ids = this.nestedIds.get(identity) ?? new Set<string>();
      for (const id of pending) {
        ids.add(id);
      }
      this.nestedIds.set(identity, ids);
    }
    const content = new ContentDefinition<K, D>(def, descriptor);
    definitions.push(content as ContentDefinition<string, ContentDef>);
    this.definitions.set(type, definitions);
    return content;
  }

  entries(type: string): readonly PdxEntry[] {
    return (this.definitions.get(type) ?? []).map((definition) => definition.toEntries());
  }

  ids(type: string): readonly string[] {
    return (this.definitions.get(type) ?? []).map((definition) => definition.id);
  }

  render(): Map<string, string> {
    const files = new Map<string, string>();
    for (const descriptor of this.descriptors) {
      const entries = this.entries(descriptor.type);
      if (entries.length === 0) {
        continue;
      }
      files.set(
        `${descriptor.outputDir}/${this.prefix}_${descriptor.fileStem}.txt`,
        serialize(entries)
      );
    }
    return files;
  }

  private assertPrefixed(type: string, id: string): void {
    if (!id.startsWith(`${this.prefix}_`)) {
      this.onPrefixViolation(
        `${type} id "${id}" must start with the mod prefix "${this.prefix}_" ` +
          "so it cannot collide with vanilla or other mods"
      );
    }
  }

  /**
   * Defaults a synthetic localisation slot's `pointerMember` to the slot's
   * own computed key, whenever the slot's text is present and the author has
   * not already written the pointer themselves.
   *
   * A synthetic slot (`SYNTHETIC_LOCALISATION`) only adds a place to author
   * real text; the game still finds that text by reading a body field the
   * vendored rules point at (`archaeological_site_type`'s `desc = desc`, an
   * ordinary raw-key field renamed to `conditionalDesc`). Setting the text
   * member alone, with no matching pointer anywhere in the body, reproduces
   * the exact silent failure SDK-50 exists to close, one step removed: a
   * populated `.yml` and a clean build, with the game showing nothing. If the
   * author *has* written the pointer — to the same key or a different one —
   * that is a deliberate choice this leaves alone; two independently-set
   * values pointing at different keys is an authoring conflict, not
   * something this method can resolve, so it throws rather than guessing
   * which one the definition should show.
   */
  private applySyntheticPointers(
    def: Readonly<Record<string, unknown>>,
    slots: readonly ContentLocalisation[]
  ): Readonly<Record<string, unknown>> {
    let patched: Record<string, unknown> | undefined;
    for (const slot of slots) {
      if (slot.pointerMember === undefined || def[slot.member] === undefined) {
        continue;
      }
      if (def[slot.pointerMember] !== undefined) {
        throw new Error(
          `"${def["id"] as string}" sets both "${slot.member}" and "${slot.pointerMember}" — ` +
            `${slot.member}'s text is only reachable in game through the ${slot.pointerMember} ` +
            `pointer, so setting both is ambiguous. Set only ${slot.member} (the pointer is ` +
            `generated) or only ${slot.pointerMember} (write the key yourself).`
        );
      }
      (patched ??= { ...def })[slot.pointerMember] = localisationKey(
        slot.pattern,
        def["id"] as string
      );
    }
    return patched ?? def;
  }

  private collectLocalisation(
    id: string,
    def: Readonly<Record<string, unknown>>,
    slots: readonly ContentLocalisation[],
    into: LocalisationEntry[]
  ): void {
    for (const slot of slots) {
      const text = def[slot.member];
      if (text === undefined) {
        const waived = slot.requiredUnless !== undefined && def[slot.requiredUnless] === true;
        if (slot.required || (slot.requiredUnless !== undefined && !waived)) {
          throw new Error(`Missing required localization "${slot.member}" for "${id}"`);
        }
        continue;
      }
      into.push([localisationKey(slot.pattern, id), text as string]);
    }
  }

  /**
   * Walks every field level (top, plain `struct` nesting, and `repeatedStruct`
   * nesting) for three things that need this same recursive descent:
   * repeated-struct ids (prefix and duplicate checks, matched against
   * localisation), `WeightBlock`/`WeightBlockWithLoc` modifier rows carrying
   * `desc` (registered as localisation via {@link collectModifierDescs}), and
   * `locKey`-tagged scalar values that look like literal text rather than a
   * localisation key (SDK-50, via {@link onLocKeyLooksLikeText}). `ownerId` is
   * the nearest enclosing identity — the definition id, or a repeated-struct
   * entry's own id once recursion crosses one — and `path` accumulates plain
   * `struct` field keys since the last identity, so a modifier's generated key
   * (and a loc-key warning's field path) stays unique even several `struct`
   * levels deep.
   */
  private collectRepeatedStructs(
    ownerId: string,
    path: string,
    def: Readonly<Record<string, unknown>>,
    fields: readonly ContentField[],
    ownerType: string,
    pendingIds: Map<string, Set<string>>,
    localisation: LocalisationEntry[]
  ): void {
    for (const field of fields) {
      const raw = def[field.member];
      // An unkeyed splice has no key to build a path from, and nothing inside
      // it carries an identity or localisation of its own.
      if (raw === undefined || field.shape === "inlineModifiers") {
        continue;
      }
      const fieldPath = path === "" ? field.key : `${path}_${field.key}`;
      if (field.shape === "value" && field.locKey === true) {
        const values = field.repeated ? (raw as readonly unknown[]) : [raw];
        for (const item of values) {
          if (typeof item === "string" && item.includes(" ")) {
            this.onLocKeyLooksLikeText(
              `${ownerType}.${fieldPath} for "${ownerId}" is a localisation key, not free text, ` +
                `but contains a space: ${JSON.stringify(item)}. The game shows this string ` +
                "verbatim if no localisation entry defines that key."
            );
          }
        }
        continue;
      }
      if (field.shape === "weightBlock" || field.shape === "weightBlockWithLoc") {
        this.collectModifierDescs(ownerId, fieldPath, raw as WeightBlock<ScopeName>, localisation);
        continue;
      }
      if (field.shape === "dual") {
        // Same trick the writer uses: resolve the arm and walk it as the
        // ordinary field it is. `path`, not `fieldPath` — the arm carries the
        // same key, so the recursion rebuilds the identical path.
        const arm = dualArm(field, raw);
        this.collectRepeatedStructs(
          ownerId,
          path,
          { [arm.member]: raw },
          [arm],
          ownerType,
          pendingIds,
          localisation
        );
        continue;
      }
      if (field.shape === "struct") {
        const items = field.repeated
          ? (raw as readonly Readonly<Record<string, unknown>>[])
          : [raw as Readonly<Record<string, unknown>>];
        items.forEach((item, index) => {
          const itemPath = field.repeated ? `${fieldPath}_${index}` : fieldPath;
          this.collectRepeatedStructs(
            ownerId,
            itemPath,
            item,
            field.fields,
            ownerType,
            pendingIds,
            localisation
          );
        });
        continue;
      }
      if (field.shape !== "repeatedStruct") {
        continue;
      }
      const record = raw as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      const identity = `${ownerType}.${field.key}`;
      const existingIds = this.nestedIds.get(identity);
      const pending = pendingIds.get(identity) ?? new Set<string>();
      for (const [id, nested] of Object.entries(record)) {
        this.assertPrefixed(identity, id);
        if (existingIds?.has(id) || pending.has(id)) {
          throw new Error(`Duplicate ${identity} id "${id}"`);
        }
        pending.add(id);
        this.collectLocalisation(id, nested, field.localisation, localisation);
        this.collectRepeatedStructs(
          id,
          "",
          nested,
          field.fields,
          identity,
          pendingIds,
          localisation
        );
      }
      pendingIds.set(identity, pending);
    }
  }

  /**
   * Registers one localisation key per desc-bearing modifier row in a
   * `WeightBlock`, via the shared derivation `modifierDescKey` — see its doc
   * comment in `effect-core.ts` for the key shape, the `descKey`/hash-fallback
   * split, and why the derivation lives there rather than here.
   */
  private collectModifierDescs(
    ownerId: string,
    fieldPath: string,
    weight: WeightBlock<ScopeName>,
    into: LocalisationEntry[]
  ): void {
    for (const modifier of weight.modifiers ?? []) {
      if (modifier.desc === undefined) {
        continue;
      }
      const { key, unstableWarning } = modifierDescKey(
        ownerId,
        fieldPath,
        modifier as ModifierWithLoc<ScopeName>
      );
      if (unstableWarning !== undefined) {
        this.onUnstableDescKey(unstableWarning);
      }
      into.push([key, modifier.desc]);
      registerModifierDescKey(modifier, key);
    }
  }
}
