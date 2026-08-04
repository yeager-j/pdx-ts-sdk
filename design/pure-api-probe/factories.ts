/**
 * Registry-typed collection factories (SDK-22, Jackson's design from the
 * spike discussion). Each factory is a collection bound to one output file
 * and returns only the definers its registry allows; the definers register
 * what they create, so creation IS registration. `createEvents` co-declares
 * file and namespace at one site — one namespace per event file holds by
 * construction, visible while authoring, not discovered at build.
 *
 * In the migration these are emitted by codegen (one per registry) exactly
 * where the `GeneratedContentMethods` class methods are emitted today;
 * `createTechnologies` is written here as the template. The pluralized
 * naming needs a codegen rule (`technology` → `createTechnologies`).
 */

import { buildEvent, type DefinedEvent, type EventDef } from "../../packages/sdk/src/events.ts";
import type { CountryShipOfSizeLimitDef } from "../../packages/sdk/src/generated/country-ship-of-size-limit.ts";
import type { EventKindKey } from "../../packages/sdk/src/generated/events.ts";
import { refId, type TypedRef } from "../../packages/sdk/src/generated/refs.ts";
import type { ScopeName } from "../../packages/sdk/src/generated/scopes.ts";
import type { SituationTypeDef } from "../../packages/sdk/src/generated/situation-type.ts";
import type { TechnologyDef } from "../../packages/sdk/src/generated/technology.ts";
import type { OnActionRef } from "../../packages/sdk/src/on-actions.ts";
import {
  patchTechnology as transformTechnology,
  type TechnologyPatch,
} from "../../packages/sdk/src/stellaris/vanilla/patch.ts";
import type { ParsedTechnology } from "../../packages/sdk/src/stellaris/vanilla/view.ts";
import {
  assertFileStem,
  assertNamespace,
  type Collection,
  type ContentItem,
  type ContributionItem,
  type EventItemBase,
  type ModItem,
  type OnActionBindingItem,
  type TechnologyPatchItem,
} from "./items.ts";

function makeCollection<T extends ModItem>(
  file: string | undefined
): { collection: Collection<T>; items: T[] } {
  if (file !== undefined) {
    assertFileStem(file);
  }
  const items: T[] = [];
  return { collection: { itemKind: "collection", file, items }, items };
}

/** What a technology collection can contain: its definitions and patches. */
export type TechnologyItem = ContentItem<"technology", TechnologyDef> | TechnologyPatchItem;

export interface TechnologyCollection extends Collection<TechnologyItem> {
  defineTechnology<const Id extends string>(
    def: TechnologyDef<Id>
  ): ContentItem<"technology", TechnologyDef<Id>>;
  /** The transform runs here (pure); duplicate-key and one-view checks stay
   * in `buildMod`, which sees all patches together. The emitted filename is
   * always resolver-computed — the collection's file stem names only the
   * mod's own definitions file. */
  patchTechnology<T extends ParsedTechnology>(
    tech: T,
    patch: (tech: T) => TechnologyPatch
  ): TechnologyPatchItem;
}

export function createTechnologies(file?: string): TechnologyCollection {
  const { collection, items } = makeCollection<TechnologyItem>(file);
  return {
    ...collection,
    defineTechnology(def) {
      const item = { itemKind: "content" as const, type: "technology" as const, id: def.id, def };
      items.push(item);
      return item;
    },
    patchTechnology(tech, patch) {
      const item = { itemKind: "patch" as const, patched: transformTechnology(tech, patch) };
      items.push(item);
      return item;
    },
  };
}

export type SituationTypeItem = ContentItem<"situation_type", SituationTypeDef>;

export interface SituationTypeCollection extends Collection<SituationTypeItem> {
  /** The `targetScope` graft as a plain function — no method override. The
   * `Omit`/intersection around `id` works around the generated Def types
   * reusing `Id` for nested `stages` keys (migration finding: split them). */
  defineSituationType<const Id extends string, T extends ScopeName | undefined = undefined>(
    def: Omit<SituationTypeDef, "id"> & { readonly id: Id; readonly targetScope?: T }
  ): ContentItem<"situation_type", SituationTypeDef> & { readonly id: Id; readonly targetScope: T };
}

export function createSituationTypes(file?: string): SituationTypeCollection {
  const { collection, items } = makeCollection<SituationTypeItem>(file);
  return {
    ...collection,
    defineSituationType(def) {
      const { targetScope, ...rest } = def;
      const item = {
        itemKind: "content" as const,
        type: "situation_type" as const,
        id: def.id,
        def: rest as SituationTypeDef,
      };
      items.push(item);
      return { ...item, targetScope: targetScope as never };
    },
  };
}

export type CountryShipOfSizeLimitItem =
  ContentItem<"country_ship_of_size_limit", CountryShipOfSizeLimitDef> | ContributionItem;

export interface CountryShipOfSizeLimitCollection extends Collection<CountryShipOfSizeLimitItem> {
  defineCountryShipOfSizeLimit<const Id extends string>(
    def: CountryShipOfSizeLimitDef<Id>
  ): ContentItem<"country_ship_of_size_limit", CountryShipOfSizeLimitDef<Id>>;
  /** The contribution sink: no id this mod owns, merged into one additive
   * `default = { ... }` file whose path is fixed, not stem-named. */
  addShipOfSizeLimits(limits: readonly (TypedRef<"country_ship_of_size_limit"> | string)[]): void;
}

export function createCountryShipOfSizeLimits(file?: string): CountryShipOfSizeLimitCollection {
  const { collection, items } = makeCollection<CountryShipOfSizeLimitItem>(file);
  return {
    ...collection,
    defineCountryShipOfSizeLimit(def) {
      const item = {
        itemKind: "content" as const,
        type: "country_ship_of_size_limit" as const,
        id: def.id,
        def,
      };
      items.push(item);
      return item;
    },
    addShipOfSizeLimits(limits) {
      items.push({
        itemKind: "contribution",
        registry: "ship_of_size_limits",
        ids: limits.map((limit) => String(refId(limit))),
      });
    },
  };
}

/** A defined event with its scope and FROM contract intact for fire sites
 * and `on()`; structurally a `DefinedEvent` — finished data, nothing
 * deferred. */
export type EventItem<
  S extends ScopeName = ScopeName,
  From extends ScopeName | undefined = ScopeName | undefined,
> = DefinedEvent<S, From> & {
  readonly itemKind: "event";
  readonly namespace: string;
  readonly locEntries: ReadonlyArray<readonly [string, string]>;
};

export interface EventCollection extends Collection<EventItemBase> {
  readonly namespace: string;
  defineCountryEvent<From extends ScopeName | undefined = undefined>(
    def: EventDef<"country", From>
  ): EventItem<"country", From>;
  definePlanetEvent<From extends ScopeName | undefined = undefined>(
    def: EventDef<"planet", From>
  ): EventItem<"planet", From>;
}

/**
 * File and namespace, co-declared: one namespace per event file by
 * construction. The namespace is identity (saves persist pending fires by
 * full id) and is written in full — prefix compliance is a build warning,
 * the same policy as content ids. Closures run here, eagerly, exactly like
 * the class API: the namespace is known, so nothing needs deferring — the
 * full id is a plain string from birth.
 */
export function createEvents(file: string, namespace: string): EventCollection {
  assertNamespace(namespace);
  const { collection, items } = makeCollection<EventItemBase>(file);
  const used = new Set<number>();
  const definerOf =
    <S extends ScopeName>(kind: EventKindKey, scope: S) =>
    <From extends ScopeName | undefined = undefined>(
      def: EventDef<S, From>
    ): EventItem<S, From> => {
      if (used.has(def.id)) {
        throw new Error(`Duplicate event id "${namespace}.${def.id}"`);
      }
      used.add(def.id);
      const locEntries: (readonly [string, string])[] = [];
      const built = buildEvent(kind, scope, namespace, def, {
        register: (key, text) => locEntries.push([key, text]),
      });
      const item = { ...built, itemKind: "event" as const, namespace, locEntries };
      items.push(item as EventItemBase);
      return item as EventItem<S, From>;
    };
  return {
    ...collection,
    namespace,
    defineCountryEvent: definerOf("country_event", "country"),
    definePlanetEvent: definerOf("planet_event", "planet"),
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

export function createOnActions(): OnActionCollection {
  const { collection, items } = makeCollection<OnActionBindingItem>(undefined);
  return {
    ...collection,
    on(hook, event) {
      items.push({ itemKind: "on-action", hook, event: event as EventItemBase });
    },
  };
}
