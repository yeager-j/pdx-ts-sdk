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
  type PdxEntry,
  type PdxScalar,
} from "@pdx-ts/pdxscript";

import { underField, type ContentRefSink, type ContentRefUse } from "./content-refs.ts";
import {
  makeScope,
  modifierEntry,
  registerModifierDescKey,
  type Modifier,
  type ModifierWithLoc,
} from "./effect-core.ts";
import type { ScopeObjOf } from "./generated/effects.ts";
import type { ScopedModifierBlock, ScopedModifierRecorder } from "./generated/modifiers.ts";
import { refId, type TypedRef } from "./generated/refs.ts";
import type { ScopeName } from "./generated/scopes.ts";
import type { Trigger } from "./trigger-core.ts";

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
  readonly multiplier?: number | readonly number[];
  /** Repeated scripted multipliers, emitted under the game's shorter `mult` spelling. */
  readonly mult?: number | readonly number[];
}

/** A reusable economic-template block used by edicts and dozens of other registries. */
export interface EconomicResourceBlock<S extends ScopeName> {
  /** Economic category used to generate modifier names and tooltips. */
  readonly category?: TypedRef<"economic_category"> | string;
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
 * A `modifier_rule` block: optional base weight plus gated adjustments.
 *
 * `M` defaults to plain {@link Modifier} (`desc` optional); `WeightBlockWithLoc`
 * below is the same shape with `M` pinned to {@link ModifierWithLoc} for
 * `modifier_rule_with_loc` consumers, not a separate runtime concept — the
 * writer lowers both through the same `weightBlock` function.
 */
export interface WeightBlock<S extends ScopeName, M extends Modifier<S> = Modifier<S>> {
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

/** A script effect block recorded against the scope declared by the content rules. */
export type EffectBlock<S extends ScopeName> = (scope: ScopeObjOf<S>) => void;

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
  readonly mult?: number | readonly number[];
  /** Repeated scripted multipliers emitted under `multiplier`. */
  readonly multiplier?: number | readonly number[];
}

/** Generated description of one localization slot on a content definition. */
export interface ContentLocalisation {
  readonly member: string;
  readonly pattern: string;
  readonly required: boolean;
}

interface ContentFieldBase {
  readonly key: string;
  readonly member: string;
  readonly repeated?: boolean;
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
 * A field CWT declares both as a bare scalar and as a modifier_rule block
 * (`stages.end = 100` versus `end = { base = 100 modifier = { ... } }`),
 * lowered by whichever form the author passes.
 */
interface ContentValueOrWeightField extends ContentFieldBase, ContentRefTypes {
  readonly shape: "valueOrWeightBlock";
  readonly conversion: "identity" | "ref";
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
  | ContentTriggeredModifierField
  | ContentModifierField
  | ContentInlineModifiersField
  | ContentWeightField
  | ContentWeightWithLocField
  | ContentValueOrWeightField
  | ContentWeightedEventsField
  | ContentStructField
  | ContentAliasStructField
  | ContentStructMapField
  | ContentScalarMapField
  | ContentRepeatedStructField;

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

function weightBlock(key: string, value: WeightBlock<ScopeName>, ctx?: LoweringContext): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.base !== undefined) {
    entries.push(kv("base", value.base));
  }
  const refs: ContentRefUse[] = [];
  entries.push(...(value.modifiers ?? []).map((modifier) => modifierEntry(modifier, refs)));
  collectRefs(ctx, refs, key);
  return block(key, entries);
}

function repeatedNumbers(key: string, value: number | readonly number[] | undefined): PdxEntry[] {
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map((item) => kv(key, item));
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

function economicResourceBlock(
  key: string,
  value: EconomicResourceBlock<ScopeName>,
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
  for (const operation of ["cost", "produces", "upkeep", "logistics"] as const) {
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
        const child: PdxEntry[] = [];
        // A reference written inside a script closure is a reference like any
        // other; the recorder reports them here so they face the same
        // integrity check as the declarative fields around them.
        const recorded: ContentRefUse[] = [];
        (value as EffectBlock<ScopeName>)(makeScope(child, recorded));
        entries.push(block(field.key, child));
        collectRefs(ctx, recorded, field.key);
        break;
      }
      case "economicResources": {
        const values = field.repeated
          ? (value as readonly EconomicResourceBlock<ScopeName>[])
          : [value as EconomicResourceBlock<ScopeName>];
        entries.push(...values.map((item) => economicResourceBlock(field.key, item, ctx)));
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
      case "valueOrWeightBlock":
        if (typeof value === "object") {
          entries.push(weightBlock(field.key, value as WeightBlock<ScopeName>, ctx));
        } else {
          entries.push(kv(field.key, contentScalar(value, field, false, ctx)));
        }
        break;
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

  constructor(
    prefix: string,
    descriptors: readonly ContentRegistryDescriptor[],
    registerLoc: RegisterLoc,
    onPrefixViolation?: (message: string) => void
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
  }

  define<K extends string, D extends ContentDef>(type: K, def: D): DefinedContent<K, D> {
    const descriptor = this.byType.get(type);
    if (descriptor === undefined) {
      throw new Error(`Unknown generated content type "${type}"`);
    }
    this.assertPrefixed(type, def.id);
    const definitions = this.definitions.get(type) ?? [];
    if (definitions.some((existing) => existing.id === def.id)) {
      throw new Error(`Duplicate ${type} id "${def.id}"`);
    }
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

  private collectLocalisation(
    id: string,
    def: Readonly<Record<string, unknown>>,
    slots: readonly ContentLocalisation[],
    into: LocalisationEntry[]
  ): void {
    for (const slot of slots) {
      const text = def[slot.member];
      if (text === undefined) {
        if (slot.required) {
          throw new Error(`Missing required localization "${slot.member}" for "${id}"`);
        }
        continue;
      }
      into.push([localisationKey(slot.pattern, id), text as string]);
    }
  }

  /**
   * Walks every field level (top, plain `struct` nesting, and `repeatedStruct`
   * nesting) for the two things that need a stable identity to resolve
   * against: repeated-struct ids (prefix and duplicate checks, matched
   * against localisation) and `WeightBlock`/`WeightBlockWithLoc` modifier
   * rows carrying `desc` (registered as localisation via
   * {@link collectModifierDescs}). `ownerId` is the nearest enclosing
   * identity — the definition id, or a repeated-struct entry's own id once
   * recursion crosses one — and `path` accumulates plain `struct` field keys
   * since the last identity, so a modifier's generated key is unique even
   * when a WeightBlock sits several `struct` levels deep.
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
      if (field.shape === "weightBlock" || field.shape === "weightBlockWithLoc") {
        this.collectModifierDescs(ownerId, fieldPath, raw as WeightBlock<ScopeName>, localisation);
        continue;
      }
      if (field.shape === "valueOrWeightBlock" && typeof raw === "object") {
        this.collectModifierDescs(ownerId, fieldPath, raw as WeightBlock<ScopeName>, localisation);
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
   * `WeightBlock`. Modifier rows are anonymous and repeated with no id of
   * their own, so the key is derived rather than author-supplied:
   * `<ownerId>_<fieldPath>_<index>`. `ownerId` and `fieldPath` are already
   * unique per definition (mod-prefixed and duplicate-checked, or a fixed
   * field key/struct path), and `index` disambiguates multiple modifier rows
   * on the same field — deterministic across runs, and never collides for
   * legitimate input with several modifiers on one definition.
   */
  private collectModifierDescs(
    ownerId: string,
    fieldPath: string,
    weight: WeightBlock<ScopeName>,
    into: LocalisationEntry[]
  ): void {
    (weight.modifiers ?? []).forEach((modifier, index) => {
      if (modifier.desc === undefined) {
        return;
      }
      const key = `${ownerId}_${fieldPath}_${index}`;
      into.push([key, modifier.desc]);
      registerModifierDescKey(modifier, key);
    });
  }
}
