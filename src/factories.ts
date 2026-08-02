/**
 * The permanently hand-written half of the collection factories (SDK-22).
 *
 * A factory is a collection bound to one output file that returns only the
 * definers its registry allows; the definers register what they create, so
 * creation IS registration. The 34 content factories and `createEvents` are
 * generated — `src/generated/content-factories.ts` and
 * `src/generated/event-factory.ts` — from the same rules that generate the
 * registries themselves.
 *
 * What stays here is what codegen cannot write: `makeCollection` (the shared
 * factory core the generated code builds on), `createOnActions` (no registry
 * behind it), and the `defineSituationType` graft, whose `targetScope` is the
 * situation target contract rather than anything the rules describe. The graft
 * is skip-listed in the codegen overlay (`HAND_WRITTEN_CONTENT_DEFINERS`), the
 * same arrangement `HAND_WRITTEN_TRIGGERS` uses one level up, so the generated
 * situation-type collection extends the interface below instead of emitting a
 * mechanical definer beside it.
 *
 * The free halves of the same two hand-written members live here too (SDK-23):
 * `defineSituationType`, which the factory graft now delegates to, and `on`,
 * whose collection method wraps it. Both surfaces coexist until the factories
 * are deleted, and the wrapping is what makes that a deletion rather than a
 * behavior change.
 */

import type { ScopeName } from "./generated/scopes.ts";
import type { SituationTypeDef } from "./generated/situation-type.ts";
import {
  assertFileStem,
  type Collection,
  type ContentItem,
  type EventItem,
  type EventItemBase,
  type ModItem,
  type OnActionBindingItem,
} from "./items.ts";
import type { OnActionRef } from "./on-actions.ts";

/** The shared factory core: a validated file stem plus the item array every
 * definer pushes into. The generated factories build on this, so a stem is
 * checked once, here, for all 35 of them. */
export function makeCollection<T extends ModItem>(
  file: string | undefined
): { collection: Collection<T>; items: T[] } {
  if (file !== undefined) {
    assertFileStem(file);
  }
  const items: T[] = [];
  return { collection: { itemKind: "collection", file, items }, items };
}

/**
 * The `defineSituationType` graft, as an interface the generated
 * `SituationTypeCollection` extends.
 *
 * `targetScope` is authored, emits nothing, and rides on the returned item as
 * the contract `startSituation` call sites are checked against (see
 * src/situations.ts). `links.cwt` gives the situation `target` link
 * `output_scope = any`, so no reading of the rules could produce this signature.
 */
export interface SituationTypeDefiner {
  defineSituationType<const Id extends string, T extends ScopeName | undefined = undefined>(
    def: SituationTypeDef<Id> & { readonly targetScope?: T }
  ): ContentItem<"situation_type", SituationTypeDef<Id>> & { readonly targetScope: T };
}

/**
 * The free `defineSituationType` (SDK-23), re-exported from
 * `src/generated/content-definers.ts` so all 34 definers come from one module.
 *
 * One object, doing both jobs: it is the item a `collection(...)` collects and
 * the `targetScope`-carrying ref `startSituation` call sites are checked
 * against. `targetScope` is stripped out of `def` — what the emitter lowers is
 * the rest — and rides on the item itself, where nothing reads it but the type
 * system.
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

/** Builds the graft over a collection's item array, for the generated factory
 * to spread in beside the collection itself. */
export function situationTypeDefiner(
  items: ContentItem<"situation_type", SituationTypeDef>[]
): SituationTypeDefiner {
  return {
    defineSituationType(def) {
      const item = defineSituationType(def);
      items.push(item);
      return item;
    },
  };
}

/**
 * Binds this mod's events to a generated on-action hook (SDK-23).
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

export interface OnActionCollection extends Collection<OnActionBindingItem> {
  /** Binds one of this mod's events to a generated on-action hook. The
   * event value must appear in a collection passed to the same `buildMod`. */
  on<S extends ScopeName, From extends ScopeName | undefined>(
    hook: OnActionRef<S, From>,
    event: EventItem<NoInfer<S>, NoInfer<From>>
  ): void;
}

/** On-action bindings are not a content registry — the hooks are generated, the
 * collection holding the bindings is not. */
export function createOnActions(): OnActionCollection {
  const { collection, items } = makeCollection<OnActionBindingItem>(undefined);
  return {
    ...collection,
    on(hook, event) {
      items.push(on(hook, [event]));
    },
  };
}
