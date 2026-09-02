/** Content definition identity, localization, and authoring registration. */
import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScriptLocalizationSink } from "../authoring/deferred-localization.ts";
import {
  assertOwnLocalizationItem,
  isLiteralText,
  isLocalizationRef,
  isLocalizedTextRecord,
  isPlaceableLocalizationItem,
  localizationRef,
  resolveFixedKeyText,
  type KeyedLocalization,
  type LocalizationMint,
  type LocalizationRefs,
  type LocalizedText,
} from "../authoring/localization.ts";
import { freezeAuthoredData } from "../authoring/snapshot.ts";
import type { ModWarning } from "../diagnostics.ts";
import type { ScopeName } from "../generated/scopes.ts";
import type { AssetPathSink, RefUseSink } from "../references.ts";
import {
  modifierDescKey,
  registerComplexTriggerModifierDescKey,
  registerModifierDescKey,
} from "../script/effects/modifiers.ts";
import type { TypedRef } from "../script/scalar.ts";
import { isComplexTriggerModifier, TRIGGERED_MODIFIER_TEXT_MEMBERS } from "./blocks.ts";
import {
  contentFieldDescent,
  contentFieldRecordPath,
  mapContentFieldRecords,
} from "./field-descent.ts";
import { resolveLocalizationRole, type LocalizationRoleUse } from "./localization-families.ts";
import { fieldEntries, isPassthrough, resolveFromClosures } from "./lower.ts";
import type { ShapeMint } from "./mint-provenance.ts";
import {
  carriesPrefixSegment,
  type ContentField,
  type ContentLocalisation,
  type ContentRegistryDescriptor,
} from "./schema.ts";
import type { TriggeredModifier, WeightBlock } from "./types.ts";

export type {
  AssetPathSink,
  AssetPathUse,
  ContentRefUse,
  RecordedRefUse,
  RefUseSink,
} from "../references.ts";

/** A definition registered with a mod and usable as a typed cross-reference. */
export interface DefinedContent<
  K extends string,
  D extends { readonly id: string },
> extends TypedRef<K> {
  readonly id: D["id"];
  readonly def: D;
  /**
   * Lowers the definition, reporting every reference it writes to `collect` and
   * every filepath field it writes to `collectPath`.
   */
  toEntries(collect?: RefUseSink, collectPath?: AssetPathSink): PdxEntry;
}

type ContentDef = { readonly id: string };
type RegisterLoc = (entries: readonly KeyedLocalization[]) => void;

/**
 * Accumulates the reference sink, the dotted path to the current level (for
 * ref diagnostics), and the nearest enclosing identity (for desc-key
 * disambiguation — see {@link descOwnerKey}).
 *
 * `collect` is the part that is genuinely optional — a caller not collecting
 * dangling references simply skips it — but `ownerId` is not: `def.id` is
 * always known at `toEntry`, so the context itself is always constructed,
 * and desc-key resolution (unlike ref collection) is not an optional
 * diagnostic a caller can decline. `ownerId` starts as the top-level
 * definition's own id and rebinds to a repeated-struct entry's own id on the
 * way down, mirroring `ContentAuthoring.resolveFieldTree`'s identical
 * rebind for the same reason: a nested entry (a tradition swap, a situation
 * stage) is itself a stable identity a `WeightBlock` inside it can key desc
 * localisation against.
 */

function toEntry(
  def: ContentDef,
  descriptor: ContentRegistryDescriptor,
  collect?: RefUseSink,
  collectPath?: AssetPathSink,
  localization?: ScriptLocalizationSink
): PdxEntry {
  const fields = fieldEntries(def as Readonly<Record<string, unknown>>, descriptor.fields, {
    collect,
    collectPath,
    path: "",
    definitionId: def.id,
    ownerId: def.id,
    localization,
  });
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
  private readonly localization: ScriptLocalizationSink;
  private readonly registerLoc: RegisterLoc;

  constructor(
    def: D,
    descriptor: ContentRegistryDescriptor,
    registerLoc: RegisterLoc,
    warn: (warning: ModWarning) => void
  ) {
    this.id = def.id;
    this.def = def;
    this.descriptor = descriptor;
    this.registerLoc = registerLoc;
    // The `warned` set outlives one lowering, so a definition lowered twice —
    // `entries()` beside the compiler's own `toEntries` — reports the same
    // derived key once.
    this.localization = { into: [], warn, warned: new Set<string>() };
  }

  /**
   * Effects are recorded here rather than at define time, so the text a
   * recorded closure writes is only knowable now: the sink collects it while
   * the walk still holds each level's `ownerId`, and `registerLoc` places it
   * exactly as the definition's own slots were placed.
   *
   * Registering again on a second call is harmless: the same walk derives the
   * same keys from the same text, and the accumulator refuses only a *changed*
   * value under a key it already holds.
   */
  toEntries(collect?: RefUseSink, collectPath?: AssetPathSink): PdxEntry {
    const into: KeyedLocalization[] = [];
    const entry = toEntry(this.def, this.descriptor, collect, collectPath, {
      ...this.localization,
      into,
    });
    if (into.length > 0) {
      this.registerLoc(into);
    }
    return entry;
  }
}

/**
 * A localisation slot's key for one identity: the slot's declared pattern with
 * `$` filled in. Shared with the patch path (`installation/vanilla/patch.ts`),
 * which applies the very same pattern to the *vanilla* id it is renaming, so
 * the replacement text lands on the key the game already reads.
 */
export function localisationKey(pattern: string, id: string): string {
  return pattern.replace("$", id);
}

/**
 * One reference per localization slot a registry declares, for the definition
 * with this id — what an item's `loc` member carries.
 *
 * Every declared slot is present whether or not the definition supplied its
 * text, since {@link localisationKey} derives the key from the id alone.
 * `Refs` is the slot table's own emitted type: the table and the type come out
 * of one generator run, so naming it here narrows a record the runtime cannot
 * describe rather than asserting something the caller had to get right.
 */
export function contentLocalizationRefs<Refs extends LocalizationRefs>(
  id: string,
  slots: readonly ContentLocalisation[]
): Refs {
  const refs = slots.map(
    (slot) => [slot.member, localizationRef(localisationKey(slot.pattern, id))] as const
  );
  return Object.freeze(Object.fromEntries(refs)) as Refs;
}

/**
 * The key a `locKey` field's inline text is registered and emitted under.
 *
 * Derived from the nearest enclosing identity and the field's path rather than
 * from the text, so editing the words never orphans a shipped translation.
 * A repeated field counts its entries, which makes their keys order-sensitive
 * — the same trade a `complex_trigger_modifier` row's desc key already makes.
 *
 * Shared with the patch path (`installation/vanilla/patch.ts`), which applies
 * it to the patched definition's prefixed id. One derivation, so a patched
 * member and an authored one can never disagree about where their text went.
 */
export function keyedTextKey(ownerId: string, fieldPath: string, index?: number): string {
  return `${ownerId}_${occurrencePath(fieldPath, index)}`;
}

/** One occurrence's field path: a repeated field counts its entries into it. */
export function occurrencePath(fieldPath: string, index: number | undefined): string {
  return index === undefined ? fieldPath : `${fieldPath}_${index}`;
}

/**
 * Resolves each of a field's occurrences, keeping the one-or-a-list shape its
 * member has. `index` is the entry's position where the field repeats, and
 * `undefined` where the member holds a single occurrence — the same
 * distinction {@link occurrencePath} and {@link keyedTextKey} read.
 */
export function mapOccurrences(
  value: unknown,
  repeated: boolean,
  resolve: (item: unknown, index: number | undefined) => unknown
): unknown {
  return repeated
    ? (value as readonly unknown[]).map((item, index) => resolve(item, index))
    : resolve(value, undefined);
}

/**
 * Resolves one authored `locKey` value to the key the definition body emits,
 * registering the translations of inline text under the minted key.
 *
 * A standalone `mod.localization()` item registers its own translations here,
 * so consuming it places its text in the consuming definition's localization
 * file whether or not a feature also places the item itself (SDK-306) — and is
 * refused when another capability minted it, exactly as placing it would be.
 * Every other {@link LocalizationRef} names a key whose text is somewhere else
 * — a definition's own slot, a replacement layer, `external.localization` — so
 * it registers nothing. Two further values ride through untouched: a parsed
 * one, carrying a key read out of the install that is not this mod's to mint,
 * and one of the position's own `sentinels`, which is an engine word rather
 * than a key.
 *
 * A field the rules overload between a localization key and something else
 * carries the rest of its arms through untouched: {@link LiteralText} lowers
 * to the raw scalar the game displays, and a content or scope reference is
 * left as the object it is, for `contentScalar` to unwrap the way it unwraps
 * every other reference.
 *
 * @param sentinels - The field's `locKeyLiterals`, or nothing where it declares none.
 * @param position - Names the text position in a refusal, e.g. `tradition.custom_tooltip`.
 */
export function resolveKeyedText(
  value: unknown,
  sentinels: readonly string[] | undefined,
  mintedKey: string,
  position: string,
  mint: LocalizationMint
): unknown {
  if (isPlaceableLocalizationItem(value)) {
    assertOwnLocalizationItem(value, mint.prefix, position);
    mint.into.push({ key: value.key, translations: value.translations });
    return value.key;
  }
  if (isLocalizationRef(value)) {
    return value.key;
  }
  if (isPassthrough(value) || (typeof value === "string" && sentinels?.includes(value) === true)) {
    return value;
  }
  if (isLiteralText(value)) {
    return value.text;
  }
  if (typeof value !== "string" && !isLocalizedTextRecord(value)) {
    // A `<job>` swap name, a `<sprite>` scripted-loc default: the arm is a
    // reference, and a reference names no text this walk could register.
    if ((typeof value === "object" && value !== null) || typeof value === "function") {
      return value;
    }
    throw new Error(
      `${position} was given ${JSON.stringify(value)}, which names no localization key. ` +
        "Write display text as a string or a language record, and an existing key as a " +
        "reference."
    );
  }
  mint.into.push({
    key: mintedKey,
    translations: resolveFixedKeyText(value as LocalizedText, position, mintedKey),
  });
  return mintedKey;
}

/**
 * Resolves the four key-typed members of one triggered-modifier clause, whose
 * type is hand-written rather than generated and so has no `ContentField` for
 * {@link resolveFieldTree} to read.
 *
 * @param fieldPath - The clause's own path, index included where the field repeats.
 */
export function resolveTriggeredModifierText(
  value: TriggeredModifier<ScopeName>,
  ownerId: string,
  fieldPath: string,
  mint: LocalizationMint
): TriggeredModifier<ScopeName> {
  let resolved = value;
  for (const [member, key] of TRIGGERED_MODIFIER_TEXT_MEMBERS) {
    const text = value[member];
    if (text === undefined) {
      continue;
    }
    resolved = {
      ...resolved,
      [member]: resolveKeyedText(
        text,
        undefined,
        keyedTextKey(ownerId, `${fieldPath}_${key}`),
        `The triggered modifier "${key}" on "${ownerId}" (${fieldPath})`,
        mint
      ),
    };
  }
  return resolved;
}

export class ContentAuthoring {
  private readonly prefix: string;
  private readonly byType: ReadonlyMap<string, ContentRegistryDescriptor>;
  private readonly definitions = new Map<string, ContentDefinition<string, ContentDef>[]>();
  private readonly nestedIds = new Map<string, Set<string>>();
  private readonly roleUses: LocalizationRoleUse[] = [];
  private readonly registerLoc: RegisterLoc;
  private readonly onPrefixViolation: (message: string) => void;
  private readonly onUnstableDescKey: (message: string) => void;
  private readonly onWarning: (warning: ModWarning) => void;

  constructor(
    prefix: string,
    descriptors: readonly ContentRegistryDescriptor[],
    registerLoc: RegisterLoc,
    onPrefixViolation?: (message: string) => void,
    onUnstableDescKey?: (message: string) => void,
    onWarning?: (warning: ModWarning) => void
  ) {
    this.prefix = prefix;
    // Indexed by type, not kept as a list: nothing walks every registry since
    // the file-emitting `render` above went away — `buildMod` owns emission.
    this.byType = new Map(descriptors.map((descriptor) => [descriptor.type, descriptor]));
    this.registerLoc = registerLoc;
    this.onPrefixViolation =
      onPrefixViolation ??
      ((message) => {
        throw new Error(message);
      });
    this.onUnstableDescKey = onUnstableDescKey ?? (() => {});
    this.onWarning = onWarning ?? (() => {});
  }

  /**
   * `shapeMint` is the caller's *recorded* mint for this definition, read from
   * `mint-provenance.ts` rather than off the item. Its presence is what waives
   * the prefix check: the name of a shape-minted definition is built from
   * another definition's id and may hold no mod prefix at all, and its
   * ownership was decided — and checked — where it was minted, so re-deriving
   * it from the string here could only get it wrong. Taking the record rather
   * than a flag or a property is deliberate: only the SDK's own mint path can
   * produce one, so no caller can waive the check by claiming to have.
   */
  define<K extends string, D extends ContentDef>(
    type: K,
    rawDef: D,
    registerLoc: RegisterLoc = this.registerLoc,
    shapeMint?: ShapeMint
  ): DefinedContent<K, D> {
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
    if (shapeMint === undefined) {
      this.assertPrefixed(type, resolved.id, descriptor);
    }
    const definitions = this.definitions.get(type) ?? [];
    if (definitions.some((existing) => existing.id === resolved.id)) {
      throw new Error(`Duplicate ${type} id "${resolved.id}"`);
    }
    // A synthetic localisation slot's generated key is only reachable in
    // game through the body pointer the vendored rules actually read; fill
    // it in before either the .yml text or the body fields get collected, so
    // the two are never produced apart.
    const pointed = this.applySyntheticPointers(resolved, descriptor.localisation);
    const mint: LocalizationMint = { prefix: this.prefix, into: [] };
    const nestedIds = new Map<string, Set<string>>();
    this.collectLocalisation(resolved.id, pointed, descriptor.localisation, mint.into);
    const def = this.resolveFieldTree(
      resolved.id,
      "",
      pointed,
      descriptor.fields,
      type,
      nestedIds,
      mint
    ) as D;
    registerLoc(mint.into);
    for (const [identity, pending] of nestedIds) {
      const ids = this.nestedIds.get(identity) ?? new Set<string>();
      for (const id of pending) {
        ids.add(id);
      }
      this.nestedIds.set(identity, ids);
    }
    // The item handed over a frozen snapshot, but the walk above rewrites the
    // levels whose localization it resolved, and those new containers are what
    // a `PureMod` exposes. Frozen rather than snapshotted: the walk registered
    // desc keys against the modifier rows in this very tree (SDK-327).
    const content = new ContentDefinition<K, D>(
      freezeAuthoredData(def),
      descriptor,
      registerLoc,
      this.onWarning
    );
    definitions.push(content as ContentDefinition<string, ContentDef>);
    this.definitions.set(type, definitions);
    return content;
  }

  /**
   * The lowered entries for one registry, in define order. `buildMod` lowers
   * through `DefinedContent.toEntries` directly — it owns emission order,
   * same-path merging and the reference sink — so this is for callers holding
   * a `ContentAuthoring` of their own, and deliberately not a second way to
   * emit a file: there was one, and it disagreed with real emission on the
   * path scheme, on merging registries that share a path, and on order.
   */
  entries(type: string): readonly PdxEntry[] {
    return (this.definitions.get(type) ?? []).map((definition) => definition.toEntries());
  }

  /**
   * Every localization role named by the definitions walked so far, in define
   * order.
   *
   * The walk cannot decide whether a role's reference is owned — a handle and a
   * raw string both name an id whose definition may arrive in another feature —
   * so it records the use and the fold settles it against the ids this build
   * actually defines.
   */
  get localizationRoleUses(): readonly LocalizationRoleUse[] {
    return this.roleUses;
  }

  /**
   * The descriptor states the registry's ownership measure. `mintHead` is the
   * literal the registry's minted names carry before the prefix — `"GFX_"` for
   * sprites, `""` for everything else, including nested definition ids, which
   * are never minted with a head of their own. `exactNames` (SDK-183) switches
   * the measure to `_`-delimited segment containment: an exact-name registry's
   * own name may carry the prefix at its head, its tail, or inside.
   */
  private assertPrefixed(
    type: string,
    id: string,
    descriptor?: Pick<ContentRegistryDescriptor, "mintHead" | "exactNames">
  ): void {
    if (descriptor?.exactNames === true) {
      if (carriesPrefixSegment(id, this.prefix)) {
        return;
      }
      this.onPrefixViolation(
        `${type} id "${id}" must carry the mod prefix "${this.prefix}" as a "_"-delimited ` +
          `segment ("${this.prefix}_...", "..._${this.prefix}", or "..._${this.prefix}_...") ` +
          "so it cannot collide with vanilla or other mods"
      );
      return;
    }
    const head = descriptor?.mintHead ?? "";
    if (id.startsWith(`${head}${this.prefix}_`)) {
      return;
    }
    this.onPrefixViolation(
      `${type} id "${id}" must start with the mod prefix "${this.prefix}_"` +
        (head === "" ? "" : ` behind the "${head}" every ${type} name carries`) +
        " so it cannot collide with vanilla or other mods"
    );
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
      // A reference, not the bare key: the pointer member is itself a
      // key-typed field, and a string there is display text the walk below
      // would key and register a second time.
      (patched ??= { ...def })[slot.pointerMember] = localizationRef(
        localisationKey(slot.pattern, def["id"] as string)
      );
    }
    return patched ?? def;
  }

  private collectLocalisation(
    id: string,
    def: Readonly<Record<string, unknown>>,
    slots: readonly ContentLocalisation[],
    into: KeyedLocalization[]
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
      const key = localisationKey(slot.pattern, id);
      into.push({
        key,
        translations: resolveFixedKeyText(
          text as LocalizedText,
          `Localization "${slot.member}" for "${id}"`,
          key
        ),
      });
    }
  }

  /**
   * Walks every field level — top, `struct`, `aliasStruct` and `structMap`
   * nesting, and `repeatedStruct` nesting — for the five things that need this
   * same recursive descent: repeated-struct ids (prefix and duplicate checks,
   * matched against localisation), the localisation an engine-keyed map keys by
   * its own map key, `WeightBlock`/`WeightBlockWithLoc` modifier rows carrying
   * `desc` (registered via {@link collectModifierDescs}), `locKey` values,
   * whose inline text is registered under a key minted by {@link keyedTextKey},
   * and a `localizationFamily` field's role bundle, whose text is registered
   * under keys derived from the id it references
   * ({@link resolveLocalizationRole}).
   *
   * Returns the definition with every `locKey` value replaced by the key the
   * body emits, so the writer downstream lowers plain strings and cannot
   * disagree with what was registered here. The definition is rewritten rather
   * than mutated, and an untouched subtree is returned as it stands.
   *
   * `ownerId` is the nearest enclosing identity — the definition id, or a
   * repeated-struct entry's own id once recursion crosses one — and `path`
   * accumulates field keys since the last identity, so a minted key stays
   * unique several levels deep.
   */
  private resolveFieldTree(
    ownerId: string,
    path: string,
    def: Readonly<Record<string, unknown>>,
    fields: readonly ContentField[],
    ownerType: string,
    pendingIds: Map<string, Set<string>>,
    mint: LocalizationMint
  ): Readonly<Record<string, unknown>> {
    let rewritten: Record<string, unknown> | undefined;
    const rewrite = (member: string, value: unknown): void => {
      (rewritten ??= { ...def })[member] = value;
    };
    for (const field of fields) {
      const raw = def[field.member];
      // An unkeyed splice has no key to build a path from, and nothing inside
      // it carries an identity or localisation of its own.
      if (
        raw === undefined ||
        field.shape === "inlineModifiers" ||
        field.shape === "inlineTrigger"
      ) {
        continue;
      }
      const fieldPath = path === "" ? field.key : `${path}_${field.key}`;
      if (field.shape === "value" && field.locKey === true) {
        const position = `${ownerType}.${fieldPath} for "${ownerId}"`;
        rewrite(
          field.member,
          mapOccurrences(raw, field.repeated === true, (item, index) =>
            resolveKeyedText(
              item,
              field.locKeyLiterals,
              keyedTextKey(ownerId, fieldPath, index),
              position,
              mint
            )
          )
        );
        continue;
      }
      if (field.shape === "valueList" && field.locKey === true) {
        // A list's elements are always indexed, and the writer accepts a bare
        // value as the one-element list it is — normalizing here keeps the two
        // readings from disagreeing about what index an element carries.
        const items = Array.isArray(raw) ? raw : [raw];
        const position = `${ownerType}.${fieldPath} for "${ownerId}"`;
        rewrite(
          field.member,
          items.map((item, index) =>
            resolveKeyedText(
              item,
              undefined,
              keyedTextKey(ownerId, fieldPath, index),
              position,
              mint
            )
          )
        );
        continue;
      }
      if (field.shape === "value" && field.localizationFamily !== undefined) {
        const family = field.localizationFamily;
        const site = { ownerType, ownerId, fieldPath };
        rewrite(
          field.member,
          mapOccurrences(raw, field.repeated === true, (item) =>
            resolveLocalizationRole(item, family, site, mint.into, this.roleUses)
          )
        );
        continue;
      }
      if (field.shape === "triggeredModifierBlock") {
        rewrite(
          field.member,
          mapOccurrences(raw, field.repeated === true, (clause, index) =>
            resolveTriggeredModifierText(
              clause as TriggeredModifier<ScopeName>,
              ownerId,
              occurrencePath(fieldPath, index),
              mint
            )
          )
        );
        continue;
      }
      if (field.shape === "weightBlock" || field.shape === "weightBlockWithLoc") {
        this.collectModifierDescs(
          ownerId,
          fieldPath,
          field.key,
          raw as WeightBlock<ScopeName>,
          mint.into
        );
        continue;
      }
      const descent = contentFieldDescent(field, raw);
      if (descent.kind === "field") {
        // Same trick the writer uses: resolve the arm and walk it as the
        // ordinary field it is. `path`, not `fieldPath` — the arm carries the
        // same key, so the recursion rebuilds the identical path.
        const armDef = this.resolveFieldTree(
          ownerId,
          path,
          { [descent.field.member]: raw },
          [descent.field],
          ownerType,
          pendingIds,
          mint
        );
        if (armDef[descent.field.member] !== raw) {
          rewrite(field.member, armDef[descent.field.member]);
        }
        continue;
      }
      if (descent.kind !== "records") {
        continue;
      }
      if (
        descent.field.shape === "struct" ||
        descent.field.shape === "triggerStruct" ||
        descent.field.shape === "aliasStruct"
      ) {
        const walked = mapContentFieldRecords(descent, (occurrence) =>
          this.resolveFieldTree(
            ownerId,
            contentFieldRecordPath(path, descent.field.key, occurrence),
            occurrence.value as Readonly<Record<string, unknown>>,
            descent.fields,
            ownerType,
            pendingIds,
            mint
          )
        );
        if (walked !== raw) {
          rewrite(field.member, walked);
        }
        continue;
      }
      if (descent.field.shape === "structMap") {
        const structMapField = descent.field;
        const walked = mapContentFieldRecords(descent, (occurrence) => {
          const name = occurrence.key!;
          const item = occurrence.value as Readonly<Record<string, unknown>>;
          // The map key is the localisation key: an event-chain counter shows
          // under its own name, with no pattern around it.
          this.collectLocalisation(name, item, structMapField.localisation ?? [], mint.into);
          return this.resolveFieldTree(
            ownerId,
            contentFieldRecordPath(path, structMapField.key, occurrence),
            item,
            descent.fields,
            ownerType,
            pendingIds,
            mint
          );
        });
        if (walked !== raw) {
          rewrite(field.member, walked);
        }
        continue;
      }
      const repeatedStructField = descent.field;
      const identity = `${ownerType}.${repeatedStructField.key}`;
      const existingIds = this.nestedIds.get(identity);
      const pending = pendingIds.get(identity) ?? new Set<string>();
      const walked = mapContentFieldRecords(descent, (occurrence) => {
        const id = occurrence.key!;
        const nested = occurrence.value as Readonly<Record<string, unknown>>;
        // Nested definition ids are never minted with a head and carry no
        // exact-name allowance: no descriptor, so the plain measure applies.
        this.assertPrefixed(identity, id);
        if (existingIds?.has(id) || pending.has(id)) {
          throw new Error(`Duplicate ${identity} id "${id}"`);
        }
        pending.add(id);
        this.collectLocalisation(id, nested, repeatedStructField.localisation, mint.into);
        return this.resolveFieldTree(id, "", nested, descent.fields, identity, pendingIds, mint);
      });
      pendingIds.set(identity, pending);
      if (walked !== raw) {
        rewrite(field.member, walked);
      }
    }
    return rewritten ?? def;
  }

  /**
   * Registers one localisation key per desc-bearing modifier row in a
   * `WeightBlock`. `Modifier` rows go through the shared derivation
   * `modifierDescKey` — see its doc comment in `script/effects/modifiers.ts` for the key
   * shape, the key-pin/hash-fallback split, and why the derivation lives
   * there rather than here (`events.ts`'s `registerModifierDescs` and the
   * vanilla patch path are the other callers).
   *
   * `ComplexTriggerModifier` rows use the same `modifierDescKey` derivation as
   * `Modifier` rows: an author-supplied pin gives the anonymous key segment,
   * while an unpinned desc hashes its English text. The key therefore depends
   * on the row's own desc content, never on its position in the `modifiers`
   * array; a `LocalizationRef` continues to bypass registration because it
   * already names a fixed foreign key.
   *
   * The registration itself is keyed by the row object *and* by
   * `${ownerId}::${fieldKey}` — the token `descOwnerKey` rebuilds on the
   * render side — not by the row object alone. An author can legally reuse
   * the exact same row object across two definitions, or across two
   * `WeightBlock` fields of one definition, and each occurrence needs to
   * resolve its own key at lowering, not whichever occurrence happened to
   * register last (PR #16 review finding 3) — orthogonal to what determines
   * the key's *value* above: SDK-48 fixed what the key is derived from, this
   * fixes what the registration is keyed by, and both apply together.
   *
   * The token is the field's own key rather than `fieldPath`, because
   * `fieldPath` is a thing only this walk knows: it accumulates enclosing
   * `struct` keys and repeated indices, and the writer — which resolves the
   * key from the row at lowering time — has neither. Keying registration by
   * the path while lookup used the bare key made every desc'd row nested
   * inside a `struct` (`technology_swap.weight`) unlowerable: the
   * registration was real but unfindable, and `modifierEntry` threw as
   * though the row had never been registered. `fieldPath` still derives the
   * key's *value*, so two struct positions still emit distinct localisation
   * keys; only the registration token is the coarser of the two, and
   * {@link registerModifierDescKey} refuses a collision on it outright
   * rather than letting one occurrence resolve another's key.
   */
  private collectModifierDescs(
    ownerId: string,
    fieldPath: string,
    fieldKey: string,
    weight: WeightBlock<ScopeName>,
    into: KeyedLocalization[]
  ): void {
    const ownerKey = `${ownerId}::${fieldKey}`;
    weight.modifiers?.forEach((row) => {
      if (row.desc === undefined) {
        return;
      }
      if (isLocalizationRef(row.desc)) {
        return;
      }
      if (isComplexTriggerModifier(row)) {
        const { key, translations, unstableWarning } = modifierDescKey(
          ownerId,
          fieldPath,
          row.desc
        );
        if (unstableWarning !== undefined) {
          this.onUnstableDescKey(unstableWarning);
        }
        into.push({ key, translations });
        registerComplexTriggerModifierDescKey(row, ownerKey, key);
        return;
      }
      const { key, translations, unstableWarning } = modifierDescKey(ownerId, fieldPath, row.desc);
      if (unstableWarning !== undefined) {
        this.onUnstableDescKey(unstableWarning);
      }
      into.push({ key, translations });
      registerModifierDescKey(row, ownerKey, key);
    });
  }
}
