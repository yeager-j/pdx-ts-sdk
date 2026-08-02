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

/** Builds the graft over a collection's item array, for the generated factory
 * to spread in beside the collection itself. */
export function situationTypeDefiner(
  items: ContentItem<"situation_type", SituationTypeDef>[]
): SituationTypeDefiner {
  return {
    defineSituationType(def) {
      const { targetScope, ...rest } = def;
      const item = {
        itemKind: "content" as const,
        type: "situation_type" as const,
        id: def.id,
        def: rest as SituationTypeDef<typeof def.id>,
      };
      items.push(item);
      return { ...item, targetScope: targetScope as never };
    },
  };
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
      items.push({ itemKind: "on-action", hook, event: event as EventItemBase });
    },
  };
}
