/** Content definition identity, localization, and authoring registration. */
import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScopeName } from "../generated/scopes.ts";
import type { ContentRefSink } from "../references.ts";
import {
  modifierDescKey,
  registerComplexTriggerModifierDescKey,
  registerModifierDescKey,
} from "../script/effects/modifiers.ts";
import type { ModifierWithLoc } from "../script/effects/types.ts";
import type { TypedRef } from "../script/scalar.ts";
import { isComplexTriggerModifier } from "./blocks.ts";
import { dualArm, fieldEntries, resolveFromClosures } from "./lower.ts";
import type { ContentField, ContentLocalisation, ContentRegistryDescriptor } from "./schema.ts";
import type { WeightBlock } from "./types.ts";

export type { ContentRefSink, ContentRefUse } from "../references.ts";

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
/** One `.yml` line's worth of localization, before any file is chosen for it. */
export type LocalisationEntry = readonly [key: string, text: string];
type RegisterLoc = (entries: readonly LocalisationEntry[]) => void;

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
 * way down, mirroring `ContentAuthoring.collectRepeatedStructs`'s identical
 * rebind for the same reason: a nested entry (a tradition swap, a situation
 * stage) is itself a stable identity a `WeightBlock` inside it can key desc
 * localisation against.
 */

function toEntry(
  def: ContentDef,
  descriptor: ContentRegistryDescriptor,
  collect?: ContentRefSink
): PdxEntry {
  const fields = fieldEntries(def as Readonly<Record<string, unknown>>, descriptor.fields, {
    collect,
    path: "",
    ownerId: def.id,
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

  constructor(def: D, descriptor: ContentRegistryDescriptor) {
    this.id = def.id;
    this.def = def;
    this.descriptor = descriptor;
  }

  toEntries(collect?: ContentRefSink): PdxEntry {
    return toEntry(this.def, this.descriptor, collect);
  }
}

/**
 * A localisation slot's key for one identity: the slot's declared pattern with
 * `$` filled in. Shared with the patch path (`stellaris/vanilla/patch.ts`),
 * which applies the very same pattern to the *vanilla* id it is renaming, so
 * the replacement text lands on the key the game already reads.
 */
export function localisationKey(pattern: string, id: string): string {
  return pattern.replace("$", id);
}

export class ContentAuthoring {
  private readonly prefix: string;
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
    // A warning, not an invariant: the SDK cannot know whether the string is
    // really prose or a real (if unconventional) key, so the no-op default
    // does not reject anything a direct `ContentAuthoring` caller writes.
    // `buildMod` supplies the callback that surfaces it on `mod.warnings`.
    this.onLocKeyLooksLikeText = onLocKeyLooksLikeText ?? ((): void => {});
  }

  define<K extends string, D extends ContentDef>(
    type: K,
    rawDef: D,
    registerLoc: RegisterLoc = this.registerLoc
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
    registerLoc(localisation);
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
      if (
        raw === undefined ||
        field.shape === "inlineModifiers" ||
        field.shape === "inlineTrigger"
      ) {
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
        this.collectModifierDescs(
          ownerId,
          fieldPath,
          field.key,
          raw as WeightBlock<ScopeName>,
          localisation
        );
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
      if (field.shape === "struct" || field.shape === "triggerStruct") {
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
   * `WeightBlock`. `Modifier` rows go through the shared derivation
   * `modifierDescKey` — see its doc comment in `script/effects/modifiers.ts` for the key
   * shape, the `descKey`/hash-fallback split, and why the derivation lives
   * there rather than here (`events.ts`'s `registerModifierDescs` is the
   * other caller).
   *
   * `ComplexTriggerModifier` rows have no `descKey` field to pin against —
   * `complex_trigger_modifier`'s own name/parameter pair is already the
   * row's content-derived identity — so they key as
   * `<ownerId>_<fieldPath>_<index>`, keeping every row on the field counted
   * (both kinds together) so a `Modifier` and a `ComplexTriggerModifier`
   * sharing one `modifiers` array never collide on the same key either.
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
    into: LocalisationEntry[]
  ): void {
    const ownerKey = `${ownerId}::${fieldKey}`;
    weight.modifiers?.forEach((row, index) => {
      if (row.desc === undefined) {
        return;
      }
      if (isComplexTriggerModifier(row)) {
        const key = `${ownerId}_${fieldPath}_${index}`;
        into.push([key, row.desc]);
        registerComplexTriggerModifierDescKey(row, ownerKey, key);
        return;
      }
      const { key, unstableWarning } = modifierDescKey(
        ownerId,
        fieldPath,
        row as ModifierWithLoc<ScopeName>
      );
      if (unstableWarning !== undefined) {
        this.onUnstableDescKey(unstableWarning);
      }
      into.push([key, row.desc]);
      registerModifierDescKey(row, ownerKey, key);
    });
  }
}
