/**
 * Transform-style patching over a parsed definition, driven entirely by the
 * registry's generated field descriptors.
 *
 * A patch member is lowered by the same `fieldEntries` machinery a `defineX`
 * uses — closures, dual-arm dispatch, reference collection and quoting all
 * come from there — so the only original job left here is the splice: a
 * patched field keeps its slot, because emission walks the parsed body and
 * substitutes in place, appending only genuinely new keys. That is what keeps
 * "always emit complete objects" true for everything the surface does not
 * model.
 *
 * Nothing in this module knows a registry. Which members exist, what they
 * accept, and which key each writes are all read off the descriptor the
 * generated `patchX` hands in.
 *
 * Two input forms exist here that no `defineX` has, both of them ways to carry
 * a shipped definition's own data back out unchanged:
 *
 * - a {@link ParsedNumber} passed through whole re-emits as `@name`, not as a
 *   bare string — the package serializer's symmetric quoting rule would
 *   quote-promote `"@t3cost"` into a string the game cannot resolve;
 * - a passthrough (a parsed occurrence taken from the source body, or an
 *   {@link AnyOf} group) is emitted verbatim rather than re-lowered.
 *
 * Display text enters through two doors, and they are different mechanisms
 * rather than one with two spellings. A registry's own localisation slots
 * (`name`, `desc`) are a *rename*: the text replaces what vanilla already
 * defines, so it is written under vanilla's own key and lands in
 * `localisation/replace/`, the layer the game resolves first — a layer, never
 * a claim about filename order. Text on a patched member (a desc'd modifier
 * row) is new, so it needs a key nothing else can be using; the key is the
 * define path's own derivation with `<prefix>_<vanillaId>` substituted for the
 * owner, and it lands in the ordinary layer beside every other key this mod
 * mints.
 */

import { container, quoted, scalar, type PdxEntry, type PdxItem } from "@pdx-ts/pdxscript";

import {
  resolveFixedKeyText,
  type KeyedLocalization,
  type LocalizedText,
} from "../../authoring/localization.ts";
import { localisationKey } from "../../content/authoring.ts";
import { isComplexTriggerModifier } from "../../content/blocks.ts";
import { fieldEntries } from "../../content/lower.ts";
import type { ContentField, ContentLocalisation } from "../../content/schema.ts";
import type { ModWarning } from "../../diagnostics.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { ContentRefSink, ContentRefUse } from "../../references.ts";
import {
  modifierDescKey,
  registerComplexTriggerModifierDescKey,
  registerModifierDescKey,
} from "../../script/effects/modifiers.ts";
import type { ModifierWithLoc } from "../../script/effects/types.ts";
import { refId } from "../../script/scalar.ts";
import type { AnyOf, ParsedDefinition, ParsedNumber } from "./parsed-definitions.ts";

/** What the shared lowering reads; the same shape `fieldEntries` is handed. */
interface LoweringContext {
  readonly collect: ContentRefSink;
  readonly path: string;
  readonly ownerId: string;
}

/**
 * A parsed occurrence carried into a patched member unchanged.
 *
 * It is already a PDXScript node, so it is spliced rather than lowered: the
 * shipped definition's own blocks survive a patched member that keeps some of
 * them and replaces others.
 */
export type Passthrough = PdxItem;

/**
 * One patch member's admitted inputs, derived from the same type the
 * definition's own member has.
 *
 * A list-shaped member additionally admits passthrough elements and, where
 * {@link PATCH_WIDENINGS} declares one, an `Extra` element form. A member that
 * admits a number additionally admits the parsed form of one, so `t.cost`
 * flows back in with its `@variable` provenance intact.
 */
export type PatchInput<T, Extra = never> =
  | (T extends readonly (infer Element)[] ? readonly (Element | Extra | Passthrough)[] : T)
  | (number extends T ? ParsedNumber : never);

export interface PatchedContent<Source extends ParsedDefinition = ParsedDefinition> {
  readonly id: string;
  /** The registry the patched definition belongs to — the source's own tag. */
  readonly registry: Source["registry"];
  /** The vanilla definition this patch transforms — provenance for the win engine. */
  readonly source: Source;
  /**
   * The patched members as the callback returned them, before lowering.
   *
   * A patch is an authoring surface like `define`'s, so the build reads it the
   * same way `DefinedContent.def` is read — the nested identities it authors
   * (a `technology_swap` this mod adds) are ids of this mod's own, and other
   * definitions may name them.
   */
  readonly def: Readonly<Record<string, unknown>>;
  /**
   * The content references the patched fields write, for `buildMod`'s
   * dangling-reference guard. A patch is the other way a definition of this
   * mod's own gets named — appending an own technology to a vanilla tech's
   * prerequisites is the calibration anchor itself — so the ids it writes have
   * to resolve on the same terms a `define`'s do.
   */
  readonly refs: readonly ContentRefUse[];
  /**
   * Text this patch mints keys of its own for, bound for the mod's ordinary
   * localization file.
   *
   * Every key here is built from `<prefix>_<vanillaId>`, so it cannot collide
   * with a vanilla key by construction — the same guarantee `assertPrefixed`
   * gives a definition's own ids, reached by substituting the owner rather
   * than by checking the result.
   */
  readonly loc: readonly KeyedLocalization[];
  /**
   * Replacement text for keys vanilla already defines — a rename.
   *
   * Keyed by vanilla's own slot key (the registry's localisation pattern
   * applied to the vanilla id), so it is bound for `localisation/replace/`,
   * the layer the game resolves ahead of the ordinary one. Filename order
   * never decides a localisation winner, so this is a mechanism rather than a
   * claim, and carries no win assertion.
   */
  readonly replaceLoc: readonly KeyedLocalization[];
  /** Diagnostics raised while minting keys, for `mod.warnings`. */
  readonly warnings: readonly ModWarning[];
  /**
   * The mod prefix the capability closure minted this patch with.
   *
   * A patch keeps vanilla's id, so it has no id of its own to check ownership
   * against — which is why placing one used to be exempt from the capability's
   * ownership check entirely. It is no longer id-less in the sense that
   * matters: every key it mints is built from this prefix, so a patch minted
   * by one capability and placed in another's feature would write that
   * capability's keys and references into this one's output. Carrying the
   * prefix is what makes that checkable (`assertCapabilityItem`).
   */
  readonly prefix: string;
  toEntries(): PdxEntry;
}

/** A vanilla patch placed into a capability feature. */
export interface ContentPatchItem<Source extends ParsedDefinition = ParsedDefinition> {
  readonly itemKind: "patch";
  readonly patched: PatchedContent<Source>;
}

function isParsedNumber(value: unknown): value is ParsedNumber {
  return (
    typeof value === "object" &&
    value !== null &&
    !("kind" in value) &&
    !("id" in value) &&
    typeof (value as { readonly value?: unknown }).value === "number"
  );
}

function isAnyOf(value: unknown): value is AnyOf<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === "any-of"
  );
}

/**
 * A `ParsedNumber` as an ordinary authored scalar: its `@variable` name when it
 * came from one, and the resolved number otherwise. `contentScalar` turns the
 * `@`-prefixed string back into a bare variable reference, so the provenance
 * survives without this module knowing how a scalar is written.
 */
function parsedScalar(value: ParsedNumber): string | number {
  return value.ref ?? value.value;
}

/** Whether a list-shaped field quotes its items, looking through a dual. */
function quotesItems(field: ContentField): boolean {
  if (field.shape === "valueList") {
    return field.quoted ?? false;
  }
  if (field.shape === "dual") {
    return field.arms.some(quotesItems);
  }
  return false;
}

/**
 * The content types a field's ids may name, looking through a dual — the same
 * `refTypes` the define path's own lowering reads, never a list this module
 * keeps.
 */
function refTypesOf(field: ContentField): readonly string[] | undefined {
  if ("refTypes" in field && field.refTypes !== undefined) {
    return field.refTypes;
  }
  if (field.shape === "dual") {
    for (const arm of field.arms) {
      const types = refTypesOf(arm);
      if (types !== undefined) {
        return types;
      }
    }
  }
  return undefined;
}

/**
 * An alternation group as the game writes it: `OR = { a b }` inside the list.
 *
 * It is a whole entry rather than a scalar, which no authoring member's element
 * type can be, so it enters the lowering as a passthrough — which means
 * `contentScalar` never sees its options, and the references they name have to
 * be reported here or nowhere. An id inside an OR group is a reference exactly
 * as a bare one beside it is.
 */
function anyOfEntry(group: AnyOf<unknown>, field: ContentField, ctx: LoweringContext): PdxEntry {
  const quote = quotesItems(field);
  const targets = refTypesOf(field);
  const options = group.options.map((option) => {
    const id = String(refId(option as string));
    if (targets !== undefined && !id.startsWith("@")) {
      ctx.collect({ targets, id, field: keyOf(field) ?? field.member });
    }
    return quote ? quoted(id) : scalar(id);
  });
  return { kind: "entry", key: "OR", op: "=", value: container(options) };
}

/**
 * The patch-only input forms, rewritten into what `fieldEntries` already
 * understands. Everything else is handed to the define path untouched.
 */
function lowerable(value: unknown, field: ContentField, ctx: LoweringContext): unknown {
  if (isParsedNumber(value)) {
    return parsedScalar(value);
  }
  if (!Array.isArray(value)) {
    return value;
  }
  return (value as readonly unknown[]).map((item) => {
    if (isParsedNumber(item)) {
      return parsedScalar(item);
    }
    return isAnyOf(item) ? anyOfEntry(item, field, ctx) : item;
  });
}

/**
 * What the minting walk below accumulates: the owning identity, the entries it
 * mints, and the diagnostics it raises.
 */
interface MintContext {
  /**
   * `<prefix>_<vanillaId>` — the identity every key this walk mints is built
   * from, and the `ownerId` the lowering will resolve those keys under.
   *
   * A patched definition keeps vanilla's id in the emitted file, but a
   * localisation key is not the definition, and a key derived from the bare
   * vanilla id would be a key vanilla itself might already define. Prefixing
   * the owner is the same construction `assertPrefixed` enforces for content
   * this mod defines, applied at the one place a patch mints anything.
   */
  readonly ownerId: string;
  readonly into: KeyedLocalization[];
  readonly warnings: ModWarning[];
}

/**
 * An authored record, as opposed to a passthrough occurrence.
 *
 * Only authored values can carry display text: a passthrough is already a
 * PDXScript node taken from the shipped body, so its text (if any) is
 * vanilla's own, already keyed, and re-emitted verbatim. Minting for one would
 * invent a key for a `desc = <key>` line the game already resolves. Every node
 * kind carries `kind`, and no authored record does.
 */
function isAuthoredRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !("kind" in value);
}

/** The define path's own path accumulation: enclosing keys joined with `_`. */
function joinFieldPath(path: string, key: string): string {
  return path === "" ? key : `${path}_${key}`;
}

/**
 * Mints and registers one localisation key per desc-bearing row of a patched
 * `WeightBlock`.
 *
 * This is `ContentAuthoring.collectModifierDescs` with the owner substituted,
 * deliberately reusing `modifierDescKey` and the index-keyed complex form
 * rather than forking them: a patched row and a defined row derive their keys
 * the same way, differing only in what `ownerId` is. Registration runs before
 * the field lowers, exactly as `define`'s pre-pass does, because
 * `modifierEntry` refuses a `desc` it cannot resolve a key for.
 */
function mintModifierDescs(
  value: unknown,
  fieldKey: string,
  fieldPath: string,
  ctx: MintContext
): void {
  const rows = (value as { readonly modifiers?: unknown }).modifiers;
  if (!Array.isArray(rows)) {
    return;
  }
  const ownerKey = `${ctx.ownerId}::${fieldKey}`;
  (rows as readonly unknown[]).forEach((row, index) => {
    if (!isAuthoredRecord(row) || row["desc"] === undefined) {
      return;
    }
    const typed = row as unknown as ModifierWithLoc<ScopeName>;
    if (isComplexTriggerModifier(typed)) {
      const key = `${ctx.ownerId}_${fieldPath}_${index}`;
      ctx.into.push({
        key,
        translations: resolveFixedKeyText(
          typed.desc,
          `The complex trigger modifier desc on "${ctx.ownerId}" (${fieldPath}[${index}])`,
          key
        ),
      });
      registerComplexTriggerModifierDescKey(typed, ownerKey, key);
      return;
    }
    const { key, translations, unstableWarning } = modifierDescKey(
      ctx.ownerId,
      fieldPath,
      typed.desc
    );
    if (unstableWarning !== undefined) {
      ctx.warnings.push({ code: "unstable-desc-key", message: unstableWarning });
    }
    ctx.into.push({ key, translations });
    registerModifierDescKey(typed, ownerKey, key);
  });
}

/**
 * Mints the localisation a patched member needs, and refuses the shapes that
 * still have nowhere to put one.
 *
 * The shapes reached are exactly the ones `define`'s own pre-pass
 * (`ContentAuthoring.collectRepeatedStructs`) reaches:
 * `weightBlock`/`weightBlockWithLoc` rows carrying `desc`, `repeatedStruct`
 * ids carrying localisation, and — since the walk descends `struct` and `dual`
 * levels — anything either is nested inside. The first is minted here; the
 * second is refused, because a `repeatedStruct` entry's key *is* an id of this
 * mod's own and a patch has no minting rule for one (no live patch registry
 * has such a field, so nothing is withheld in practice).
 *
 * The other block shapes a definition can hold mint nothing: a
 * `triggeredModifierBlock`'s `description`/`custom_tooltip`, and a `locKey`
 * scalar such as `triggered_desc.text`, are keys the author writes and the
 * lowering copies; `modifierBlock` and `effect` run recorders that emit
 * `name = amount` rows and script entries only. Those ride through unchanged.
 */
function mintLocalisation(
  value: unknown,
  field: ContentField,
  member: string,
  path: string,
  ctx: MintContext
): void {
  switch (field.shape) {
    case "weightBlock":
    case "weightBlockWithLoc":
      mintModifierDescs(value, field.key, joinFieldPath(path, field.key), ctx);
      return;
    case "repeatedStruct":
      if (field.localisation.length > 0) {
        throw new Error(
          `The patched "${member}" is a nested definition whose ids carry localisation, and a ` +
            "patch has no rule for minting an id of its own inside a definition it does not " +
            "own. Patched localization covers renames (the registry's own name/desc members) " +
            "and desc'd modifier rows in weight blocks; define your own content for the rest."
        );
      }
      return;
    case "dual":
      // Every arm, not the resolved one: `dualArm` throws on a form no arm
      // takes, and the lowering below is where that belongs. An arm whose
      // shape does not match what the author passed finds nothing and mints
      // nothing on its own.
      for (const arm of field.arms) {
        mintLocalisation(value, arm, member, path, ctx);
      }
      return;
    case "struct":
    case "triggerStruct": {
      // A struct carries no localisation of its own, but the fields inside it
      // are ordinary fields — `technology_swap`'s `weight` is a dual whose
      // block arm is a `WeightBlock`, and a desc'd row there mints the same
      // key one at the top level does. Passthrough elements keep their index,
      // so an authored sibling's path does not move when one is added.
      const items = Array.isArray(value) ? (value as readonly unknown[]) : [value];
      const fieldPath = joinFieldPath(path, field.key);
      items.forEach((item, index) => {
        if (!isAuthoredRecord(item)) {
          return;
        }
        const itemPath = field.repeated ? `${fieldPath}_${index}` : fieldPath;
        for (const nested of field.fields) {
          const inner = item[nested.member];
          if (inner !== undefined) {
            mintLocalisation(inner, nested, `${member}.${nested.member}`, itemPath, ctx);
          }
        }
      });
      return;
    }
    default:
      return;
  }
}

/**
 * The PDXScript key a field writes, or undefined when the field has none — an
 * unkeyed splice (`inlineModifiers`) has no slot in the body to substitute, so
 * it is not patchable. The generated patch type leaves those members out; this
 * is the runtime half of the same fact.
 */
function keyOf(field: ContentField): string | undefined {
  return "key" in field ? field.key : undefined;
}

/**
 * Refuses a patch object carrying a member the transform would not emit.
 *
 * The lowering iterates descriptors, not the patch object, so an unknown key
 * would otherwise be dropped in silence — and the compiler does not catch it:
 * TypeScript performs no excess-property check on an object literal returned
 * from an inferred-return arrow, which is the shape every patch callback has.
 * A member the SDK cannot lower has to fail loudly rather than emit nothing.
 */
function assertPatchable(
  patched: Readonly<Record<string, unknown>>,
  source: ParsedDefinition,
  registry: string,
  patchable: ReadonlyMap<string, ContentField>,
  locSlots: ReadonlyMap<string, ContentLocalisation>
): void {
  for (const member of Object.keys(patched)) {
    if (locSlots.has(member)) {
      continue;
    }
    if (member === "id") {
      throw new Error(
        `A patch of ${registry} "${source.id}" may not set "id": a patched definition keeps ` +
          "vanilla's identity, because the override has to target the vanilla key to win, and " +
          "the transform already emits under it. Remove the member; to add content of your " +
          "own, define it instead of patching."
      );
    }
    if (patchable.has(member)) {
      continue;
    }
    const near = [...patchable.keys()]
      .filter((name) => name.toLowerCase().includes(member.toLowerCase().slice(0, 4)))
      .slice(0, 5);
    const hint = near.length > 0 ? ` (did you mean: ${near.join(", ")}?)` : "";
    throw new Error(
      `A patch of ${registry} "${source.id}" sets "${member}", which is not a patchable ` +
        `${registry} member, so it would emit nothing${hint}`
    );
  }
}

/**
 * Lowers the patched members and splices them into the parsed body.
 *
 * Every occurrence of a patched key is replaced by that member's new entries,
 * at the position of the first occurrence; a key the body does not have is
 * appended. Unpatched entries ride through untouched.
 */
export function patchContent<Source extends ParsedDefinition, Patch extends object>(
  source: Source,
  patch: (source: Source) => Patch,
  registry: Source["registry"],
  fields: readonly ContentField[],
  localisation: readonly ContentLocalisation[],
  prefix: string
): PatchedContent<Source> {
  const patched = patch(source) as Readonly<Record<string, unknown>>;
  const patchable = new Map(
    fields.flatMap((field) => (keyOf(field) === undefined ? [] : [[field.member, field] as const]))
  );
  const locSlots = new Map(localisation.map((slot) => [slot.member, slot] as const));
  assertPatchable(patched, source, registry, patchable, locSlots);

  // A rename writes vanilla's own slot key — the registry's pattern applied to
  // the vanilla id — so the text lands where the game already looks. It is a
  // replacement, not a new key, which is why it goes to its own layer rather
  // than beside the minted keys below.
  const replaceLoc: KeyedLocalization[] = [];
  for (const slot of localisation) {
    const text = patched[slot.member];
    if (text !== undefined) {
      const key = localisationKey(slot.pattern, source.id);
      replaceLoc.push({
        key,
        translations: resolveFixedKeyText(
          text as LocalizedText,
          `The patched "${slot.member}" of ${registry} "${source.id}"`,
          key
        ),
      });
    }
  }

  const mint: MintContext = {
    ownerId: `${prefix}_${source.id}`,
    into: [],
    warnings: [],
  };
  // Every field's keys are minted before any field lowers, mirroring the two
  // passes `define` runs for the same reason: `modifierEntry` resolves a row's
  // key at lowering time and refuses one that was never registered.
  for (const field of fields) {
    const value = patched[field.member];
    if (value !== undefined && keyOf(field) !== undefined) {
      mintLocalisation(value, field, field.member, "", mint);
    }
  }

  const refs: ContentRefUse[] = [];
  const ctx: LoweringContext = {
    collect: (use: ContentRefUse) => refs.push(use),
    path: "",
    ownerId: mint.ownerId,
  };
  const replacements = new Map<string, PdxEntry[]>();
  for (const field of fields) {
    const value = patched[field.member];
    if (value === undefined) {
      continue;
    }
    const key = keyOf(field);
    if (key === undefined) {
      continue;
    }
    const entries = fieldEntries({ [field.member]: lowerable(value, field, ctx) }, [field], ctx);
    replacements.set(key, [...(replacements.get(key) ?? []), ...entries]);
  }

  return {
    id: source.id,
    registry,
    source,
    def: patched,
    refs,
    loc: mint.into,
    replaceLoc,
    warnings: mint.warnings,
    prefix,
    toEntries(): PdxEntry {
      const body: PdxEntry[] = [];
      const substituted = new Set<string>();
      for (const entry of source.body) {
        const entries = replacements.get(entry.key);
        if (entries !== undefined) {
          if (!substituted.has(entry.key)) {
            substituted.add(entry.key);
            body.push(...entries);
          }
          continue;
        }
        body.push(entry);
      }
      for (const [key, entries] of replacements) {
        if (!substituted.has(key)) {
          body.push(...entries);
        }
      }
      return { kind: "entry", key: source.id, op: "=", value: container(body) };
    },
  };
}
