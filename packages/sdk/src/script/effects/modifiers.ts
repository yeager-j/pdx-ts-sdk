/** Lowering and localization registration for modifier-shaped effects. */

import { createHash } from "node:crypto";
import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScopeName } from "../../generated/scopes.ts";
import { compareUtf8 } from "../../ordering.ts";
import type { ContentRefUse } from "../../references.ts";
import { toScalar } from "../scalar.ts";
import { scriptValueScalar, type ScriptValue } from "../trigger-core.ts";
import type { ComplexTriggerModifier, Modifier, ModifierWithLoc } from "./types.ts";

/**
 * Resolved `desc` keys, by the exact `Modifier` object that carries them —
 * and, within that, by the owning field's `${ownerId}::${fieldKey}` token
 * (`ContentAuthoring.descOwnerKey` in content.ts), not by object identity
 * alone.
 *
 * Modifier rows are anonymous and repeated with no id of their own, so a
 * generated localisation key cannot ride the usual `<id>`/`<id>_desc`
 * pattern. `ContentAuthoring` (content.ts) generates and registers one key
 * per desc-bearing row at `define()` time — the only point with a stable
 * definition id and a once-only guarantee. A bare `WeakMap<Modifier, string>`
 * (one slot per object) is not enough on its own: an author can legally
 * reuse the exact same row object across two definitions, or in two
 * different `WeightBlock` fields of one definition (a shared "gate
 * condition" pulled out to avoid repeating it), and each registration would
 * then overwrite the last, so the FIRST occurrence's field silently starts
 * rendering the SECOND's key at lowering time (PR #16 review finding 3 — the
 * same class of bug SDK-48 fixed for index-derived keys, but this one is
 * identity-based rather than position-based). The inner map's owner-key
 * dimension keeps every occurrence's registration distinct.
 */
const modifierDescKeys = new WeakMap<Modifier<ScopeName>, Map<string, string>>();

/**
 * SDK-internal: records the localisation key a modifier row's `desc`
 * resolved to, for one `${ownerId}::${fieldKey}` occurrence of that row.
 */
export function registerModifierDescKey(
  modifier: Modifier<ScopeName>,
  ownerKey: string,
  key: string
): void {
  const existing = modifierDescKeys.get(modifier);
  if (existing === undefined) {
    modifierDescKeys.set(modifier, new Map([[ownerKey, key]]));
  } else {
    existing.set(ownerKey, key);
  }
}

/** `Modifier.descKey`'s required shape — lowercase snake_case, matching content ids. */
export const DESC_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * A derived modifier desc localisation key, plus a warning to surface when
 * the derivation fell back to a content hash rather than an author-supplied
 * `descKey`. The warning is returned rather than emitted so this function
 * stays free of any opinion about where a caller's diagnostics land —
 * `content.ts` has `onUnstableDescKey` wired to `mod.warnings` already;
 * `events.ts` threads it through `DefinedEvent.warnings` instead, since an
 * event has no `ContentAuthoring` instance to hang a callback off.
 */
export interface ModifierDescKeyResult {
  readonly key: string;
  readonly unstableWarning?: string;
}

/**
 * Derives the localisation key for one desc-bearing `modifier_rule` row:
 * `<ownerId>_<fieldPath>_<descKey-or-hash>`. Modifier rows are anonymous and
 * repeated with no id of their own, so the key cannot ride the row's own
 * identity and is derived instead. `ownerId` and `fieldPath` are already
 * unique per definition (mod-prefixed and duplicate-checked, or a fixed
 * field key/struct path); what disambiguates multiple rows on the same
 * field must be a function of the row's own content, never of its position
 * in the array — an index-derived key repoints at whatever row now occupies
 * that index after an insertion or reorder, silently misaligning any
 * shipped translation with no build error and no symptom until a player
 * reads that language (SDK-48).
 *
 * An author-supplied `descKey` is preferred when given: stable under
 * reordering and under text edits, so it is the only scheme translations
 * can safely be pinned against long-term. Without one, the key falls back
 * to a short hash of the `desc` text itself — still a function of content
 * rather than position, so it survives reordering and insertion, but it
 * changes (and orphans any existing translation) whenever the English text
 * is edited; the caller is expected to surface `unstableWarning` when that
 * happens, the same way `content.ts`'s `onUnstableDescKey`/`mod.warnings`
 * already does, rather than let the fallback stay silently unattended.
 *
 * The single derivation, shared rather than duplicated per caller
 * (`content.ts`'s `collectModifierDescs`, `events.ts`'s
 * `registerModifierDescs`) — every caller inherits a future change to this
 * scheme in one place.
 */
export function modifierDescKey(
  ownerId: string,
  fieldPath: string,
  modifier: ModifierWithLoc<ScopeName>
): ModifierDescKeyResult {
  if (modifier.descKey !== undefined) {
    if (!DESC_KEY_PATTERN.test(modifier.descKey)) {
      throw new Error(
        `Modifier.descKey "${modifier.descKey}" on "${ownerId}" (${fieldPath}) must be ` +
          `lowercase snake_case (e.g. "flesh_is_weak")`
      );
    }
    return { key: `${ownerId}_${fieldPath}_${modifier.descKey}` };
  }
  const slug = createHash("sha256").update(modifier.desc).digest("hex").slice(0, 8);
  return {
    key: `${ownerId}_${fieldPath}_${slug}`,
    unstableWarning:
      `Modifier desc on "${ownerId}" (${fieldPath}) has no descKey; its localisation key ` +
      `is a hash of the desc text and will change if that text is edited, silently ` +
      `orphaning any existing translation. Set descKey to pin a stable key.`,
  };
}

/**
 * A weight-shaped row's `complex_maths_enum` arms, without the members that
 * are the row's own rather than the operation's — the gate and its tooltip.
 * `content.ts`'s `WeightBlockOperations` is the same set, spelled from the
 * same place ({@link Modifier}).
 */
export type WeightOperations = Omit<Modifier<ScopeName>, "desc" | "descKey" | "when">;

/**
 * The operations in emission order, as (member, emitted key) pairs.
 *
 * Two lowerings read this: {@link modifierEntry} below, for a `modifier` row,
 * and `content.ts`'s `weightBlock`, for the operations written directly as
 * siblings of `base`. They are the same `complex_maths_enum` arms in the same
 * order, and a second hand-spelled sequence is a divergence nothing would
 * report — the emitted bytes stay well-formed either way, so a member added
 * to one list and not the other simply stops being emitted from the other
 * position. Order is load-bearing: it is what keeps emission a function of
 * the content rather than of the order an author's object literal declared
 * its members in.
 */
const WEIGHT_OPERATIONS: readonly (readonly [keyof WeightOperations, string])[] = [
  ["factor", "factor"],
  ["add", "add"],
  ["weight", "weight"],
  ["subtract", "subtract"],
  ["mult", "mult"],
  // `multiply`/`min`/`max` are the game's spellings; the members are
  // `multiplier`/`minValue`/`maxValue` — see {@link Modifier} for why.
  ["multiplier", "multiply"],
  ["divide", "divide"],
  ["minValue", "min"],
  ["maxValue", "max"],
];

/** SDK-internal: lowers a weight-shaped row's operations, in {@link
 * WEIGHT_OPERATIONS} order. */
export function weightOperationEntries(value: WeightOperations): PdxEntry[] {
  const entries: PdxEntry[] = [];
  for (const [member, key] of WEIGHT_OPERATIONS) {
    const operand = value[member];
    if (operand !== undefined) {
      entries.push(kv(key, scriptValueScalar(operand)));
    }
  }
  return entries;
}

/**
 * SDK-internal shared lowering for a `modifier_rule`/`modifier_rule_with_loc`
 * row. `refs`, when given, collects the content references the gating
 * trigger writes. `ownerKey`, when given, is this occurrence's
 * `${ownerId}::${fieldKey}` token — the same one it was registered under —
 * so a row shared across owners or fields resolves its OWN key rather than
 * whichever registration happened to run last. Omitted entirely (as every
 * non-`WeightBlock` caller below does — `RandomListArm`, `TriggeredModifier`,
 * `StructuralEffects.random`) it correctly still finds nothing, since
 * `desc` was never a supported field there to begin with.
 */
export function modifierEntry(
  modifier: Modifier<ScopeName>,
  refs?: ContentRefUse[],
  ownerKey?: string
): PdxEntry {
  const entries: PdxEntry[] = weightOperationEntries(modifier);
  if (modifier.desc !== undefined) {
    const key = ownerKey === undefined ? undefined : modifierDescKeys.get(modifier)?.get(ownerKey);
    if (key === undefined) {
      throw new Error(
        "Modifier.desc is display text that must be registered as localization before it can " +
          "be lowered, and this row was never registered for this occurrence. desc is only " +
          "supported on modifiers inside a content definition's WeightBlock (e.g. " +
          "situation_type.monthly_progress) — randomList/lockedRandomList/random and other " +
          "runtime-recorded effect modifiers have no stable, once-only point to register a key " +
          "against, so they cannot accept desc."
      );
    }
    entries.push(kv("desc", key));
  }
  entries.push(...modifier.when.entries);
  refs?.push(...modifier.when.refs);
  return block("modifier", entries);
}

const complexTriggerModifierDescKeys = new WeakMap<
  ComplexTriggerModifier<ScopeName>,
  Map<string, string>
>();

/**
 * SDK-internal: records the localisation key a complex-trigger-modifier
 * row's `desc` resolved to, for one `${ownerId}::${fieldKey}` occurrence.
 */
export function registerComplexTriggerModifierDescKey(
  modifier: ComplexTriggerModifier<ScopeName>,
  ownerKey: string,
  key: string
): void {
  const existing = complexTriggerModifierDescKeys.get(modifier);
  if (existing === undefined) {
    complexTriggerModifierDescKeys.set(modifier, new Map([[ownerKey, key]]));
  } else {
    existing.set(ownerKey, key);
  }
}

/**
 * SDK-internal shared lowering for a `complex_trigger_modifier` row. `refs`,
 * when given, collects the content references `potential` writes.
 * `ownerKey`, when given, is this occurrence's `${ownerId}::${fieldKey}`
 * token — see {@link modifierEntry}'s matching parameter for why this is
 * needed rather than a bare per-object lookup.
 */
export function complexTriggerModifierEntry(
  modifier: ComplexTriggerModifier<ScopeName>,
  refs?: ContentRefUse[],
  ownerKey?: string
): PdxEntry {
  const entries: PdxEntry[] = [kv("trigger", modifier.trigger)];
  if (modifier.triggerScope !== undefined) {
    entries.push(kv("trigger_scope", modifier.triggerScope));
  }
  if (modifier.parameters !== undefined) {
    const params = modifier.parameters;
    // A named set, not ordered author data — same reasoning and the same
    // comparator as `scriptedEntry`'s parameter bag (scripted.ts), which
    // this row's own `trigger`/`parameters` pair otherwise mirrors. Without
    // this, `Object.entries` would leak the author's object-literal
    // insertion order into the emitted mod, in violation of the "content,
    // never source position" invariant every other WeightBlock member here
    // already honors (`weightOperationEntries`, the fixed field sequence
    // below).
    const keys = Object.keys(params)
      .filter((key) => params[key] !== undefined)
      .sort(compareUtf8);
    entries.push(
      block(
        "parameters",
        keys.map((key) => kv(key, toScalar(params[key])))
      )
    );
  }
  entries.push(kv("mode", modifier.mode));
  if (modifier.mult !== undefined) {
    entries.push(kv("mult", scriptValueScalar(modifier.mult)));
  }
  if (modifier.multiplier !== undefined) {
    entries.push(kv("multiplier", scriptValueScalar(modifier.multiplier)));
  }
  if (modifier.divide !== undefined) {
    entries.push(kv("divide", scriptValueScalar(modifier.divide)));
  }
  if (modifier.minValue !== undefined) {
    entries.push(kv("min_value", scriptValueScalar(modifier.minValue)));
  }
  if (modifier.maxValue !== undefined) {
    entries.push(kv("max_value", scriptValueScalar(modifier.maxValue)));
  }
  if (modifier.desc !== undefined) {
    const key =
      ownerKey === undefined
        ? undefined
        : complexTriggerModifierDescKeys.get(modifier)?.get(ownerKey);
    if (key === undefined) {
      throw new Error(
        "ComplexTriggerModifier.desc is display text that must be registered as localization " +
          "before it can be lowered, and this row was never registered for this occurrence. " +
          "desc is only supported on complex trigger modifiers inside a content definition's " +
          "WeightBlock — see Modifier.desc for the same constraint on the sibling row kind."
      );
    }
    entries.push(kv("desc", key));
  }
  if (modifier.potential !== undefined) {
    entries.push(block("potential", [...modifier.potential.entries]));
    refs?.push(...modifier.potential.refs);
  }
  return block("complex_trigger_modifier", entries);
}
