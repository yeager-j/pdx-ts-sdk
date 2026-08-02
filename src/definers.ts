/**
 * The permanently hand-written half of the definer surface.
 *
 * The 33 mechanical content definers and `namespace(ns)`'s event definers are
 * generated — `src/generated/content-definers.ts` and
 * `src/generated/event-definers.ts` — from the same rules that generate the
 * registries themselves. What stays here is what codegen cannot write:
 * `defineSituationType`, whose `targetScope` is the situation target contract
 * rather than anything the rules describe, and `on`, which has no registry
 * behind it at all.
 *
 * The situation definer is skip-listed in the codegen overlay
 * (`HAND_WRITTEN_CONTENT_DEFINERS`), the same arrangement `HAND_WRITTEN_TRIGGERS`
 * uses one level up, so `content-definers.ts` re-exports the definition below
 * instead of emitting a mechanical one beside it — and all 34 definers stay
 * importable from that one module.
 */

import type { ScopeName } from "./generated/scopes.ts";
import type { SituationTypeDef } from "./generated/situation-type.ts";
import type { ContentItem, EventItem, EventItemBase, OnActionBindingItem } from "./items.ts";
import type { OnActionRef } from "./on-actions.ts";

/**
 * Defines a situation type in this mod.
 *
 * One object, doing both jobs: it is the item a `collection(...)` collects and
 * the `targetScope`-carrying ref `startSituation` call sites are checked
 * against (see src/situations.ts). `links.cwt` gives the situation `target`
 * link `output_scope = any`, so no reading of the rules could produce this
 * signature. `targetScope` is authored and emits nothing — it is stripped out
 * of `def`, and what the emitter lowers is the rest — riding on the item
 * itself, where nothing reads it but the type system.
 */
export function defineSituationType<
  const Id extends string,
  T extends ScopeName | undefined = undefined,
>(
  def: SituationTypeDef<Id> & { readonly targetScope?: T }
): ContentItem<"situation_type", SituationTypeDef<Id>> & { readonly targetScope: T } {
  const { targetScope, ...rest } = def;
  return {
    itemKind: "content",
    type: "situation_type",
    id: def.id,
    def: rest as SituationTypeDef<Id>,
    targetScope: targetScope as T,
  };
}

/**
 * Binds this mod's events to a generated on-action hook.
 *
 * The events are a non-empty tuple, and the list order is author data: the
 * game fires a hook's `events = { ... }` list as written, so `buildMod`
 * registers straight down the array and never sorts it. Two separate `on()`
 * items on the same hook still concatenate in the order they reach `buildMod`;
 * this is the form that puts that order fully in the author's hands.
 *
 * `NoInfer` makes the hook the only inference site, so a scope or FROM
 * mismatch is reported against the events rather than silently widening the
 * hook. The tuple has to be written as an array literal at the call site — a
 * variable of type `EventItem[]` has no non-empty proof to offer.
 */
export function on<S extends ScopeName, From extends ScopeName | undefined>(
  hook: OnActionRef<S, From>,
  events: readonly [EventItem<NoInfer<S>, NoInfer<From>>, ...EventItem<NoInfer<S>, NoInfer<From>>[]]
): OnActionBindingItem {
  return { itemKind: "on-action", hook, events: events as readonly EventItemBase[] };
}
