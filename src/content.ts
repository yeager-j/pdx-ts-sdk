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

import { makeScope, modifierEntry, type Modifier } from "./effect-core.ts";
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

/** A `modifier_rule` block: optional base weight plus gated adjustments. */
export interface WeightBlock<S extends ScopeName> {
  /** Starting weight before modifiers. */
  readonly base?: number;
  /** Conditional adjustments emitted as repeated `modifier` blocks. */
  readonly modifiers?: readonly Modifier<S>[];
}

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

interface ContentValueField extends ContentFieldBase {
  readonly shape: "value";
  readonly conversion: "identity" | "ref";
}

interface ContentValueListField extends ContentFieldBase {
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

interface ContentWeightField extends ContentFieldBase {
  readonly shape: "weightBlock";
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
  | ContentWeightField
  | ContentStructField
  | ContentRepeatedStructField;

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

/** A definition registered with a mod and usable as a typed cross-reference. */
export interface DefinedContent<
  K extends string,
  D extends { readonly id: string },
> extends TypedRef<K> {
  readonly id: D["id"];
  readonly def: D;
  toEntries(): PdxEntry;
}

type ContentDef = { readonly id: string };
type LocalisationEntry = readonly [key: string, text: string];
type RegisterLoc = (entries: readonly LocalisationEntry[]) => void;

function contentScalar(value: unknown, conversion: "identity" | "ref", quote: boolean): PdxScalar {
  const converted = conversion === "ref" ? refId(value as TypedRef<string> | string) : value;
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

function weightBlock(key: string, value: WeightBlock<ScopeName>): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.base !== undefined) {
    entries.push(kv("base", value.base));
  }
  entries.push(...(value.modifiers ?? []).map(modifierEntry));
  return block(key, entries);
}

function repeatedNumbers(key: string, value: number | readonly number[] | undefined): PdxEntry[] {
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map((item) => kv(key, item));
}

function economicOperation(key: string, value: EconomicResourceOperation<ScopeName>): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.when !== undefined) {
    entries.push(block("trigger", [...value.when.entries]));
  }
  entries.push(...Object.entries(value.amounts).map(([resource, amount]) => kv(resource, amount)));
  entries.push(...repeatedNumbers("multiplier", value.multiplier));
  entries.push(...repeatedNumbers("mult", value.mult));
  return block(key, entries);
}

function economicResourceBlock(key: string, value: EconomicResourceBlock<ScopeName>): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.category !== undefined) {
    entries.push(kv("category", refId(value.category)));
  }
  for (const operation of ["cost", "produces", "upkeep", "logistics"] as const) {
    const arm = value[operation];
    if (arm !== undefined) {
      entries.push(economicOperation(operation, arm));
    }
  }
  return block(key, entries);
}

function triggeredModifierBlock(key: string, value: TriggeredModifier<ScopeName>): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.when !== undefined) {
    entries.push(block("potential", [...value.when.entries]));
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

function fieldEntries(def: Readonly<Record<string, unknown>>, fields: readonly ContentField[]) {
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
          entries.push(kv(field.key, contentScalar(item, field.conversion, false)));
        }
        break;
      }
      case "valueList": {
        const values = Array.isArray(value) ? value : [value];
        if (values.length > 0) {
          entries.push(
            list(
              field.key,
              values.map((item) => contentScalar(item, field.conversion, field.quoted ?? false))
            )
          );
        }
        break;
      }
      case "trigger":
        entries.push(block(field.key, [...(value as Trigger<ScopeName>).entries]));
        break;
      case "effect": {
        const child: PdxEntry[] = [];
        (value as EffectBlock<ScopeName>)(makeScope(child));
        entries.push(block(field.key, child));
        break;
      }
      case "economicResources": {
        const values = field.repeated
          ? (value as readonly EconomicResourceBlock<ScopeName>[])
          : [value as EconomicResourceBlock<ScopeName>];
        entries.push(...values.map((item) => economicResourceBlock(field.key, item)));
        break;
      }
      case "triggeredModifierBlock": {
        const values = field.repeated
          ? (value as readonly TriggeredModifier<ScopeName>[])
          : [value as TriggeredModifier<ScopeName>];
        entries.push(...values.map((item) => triggeredModifierBlock(field.key, item)));
        break;
      }
      case "modifierBlock":
        entries.push(modifierBlock(field.key, value as ModifierClosure));
        break;
      case "weightBlock":
        entries.push(weightBlock(field.key, value as WeightBlock<ScopeName>));
        break;
      case "struct": {
        if (field.wrapped) {
          const items = value as readonly Readonly<Record<string, unknown>>[];
          entries.push(
            kv(
              field.key,
              container(items.map((item) => container(fieldEntries(item, field.fields))))
            )
          );
          break;
        }
        const values = field.repeated
          ? (value as readonly Readonly<Record<string, unknown>>[])
          : [value as Readonly<Record<string, unknown>>];
        entries.push(...values.map((item) => block(field.key, fieldEntries(item, field.fields))));
        break;
      }
      case "repeatedStruct": {
        const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        if (field.keying === "container") {
          entries.push(
            block(
              field.key,
              Object.entries(record).map(([id, item]) =>
                block(id, fieldEntries(item, field.fields))
              )
            )
          );
          break;
        }
        for (const [id, item] of Object.entries(record)) {
          entries.push(
            block(field.key, [kv(field.identityKey!, id), ...fieldEntries(item, field.fields)])
          );
        }
        break;
      }
    }
  }
  return entries;
}

function toEntry(def: ContentDef, descriptor: ContentRegistryDescriptor): PdxEntry {
  const fields = fieldEntries(def as Readonly<Record<string, unknown>>, descriptor.fields);
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

  toEntries(): PdxEntry {
    return toEntry(this.def, this.descriptor);
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

  constructor(
    prefix: string,
    descriptors: readonly ContentRegistryDescriptor[],
    registerLoc: RegisterLoc
  ) {
    this.prefix = prefix;
    this.descriptors = descriptors;
    this.byType = new Map(descriptors.map((descriptor) => [descriptor.type, descriptor]));
    this.registerLoc = registerLoc;
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
    this.collectRepeatedStructs(def, descriptor.fields, type, nestedIds, localisation);
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
      throw new Error(
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

  private collectRepeatedStructs(
    def: Readonly<Record<string, unknown>>,
    fields: readonly ContentField[],
    ownerType: string,
    pendingIds: Map<string, Set<string>>,
    localisation: LocalisationEntry[]
  ): void {
    for (const field of fields) {
      if (field.shape !== "repeatedStruct") {
        continue;
      }
      const record = def[field.member] as
        Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
      if (record === undefined) {
        continue;
      }
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
        this.collectRepeatedStructs(nested, field.fields, identity, pendingIds, localisation);
      }
      pendingIds.set(identity, pending);
    }
  }
}
