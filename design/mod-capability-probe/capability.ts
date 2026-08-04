import {
  buildMod,
  type BuildOptions,
  type ModConfig,
  type PureMod,
} from "../../packages/sdk/src/build.ts";
import { on } from "../../packages/sdk/src/definers.ts";
import { buildEvent, type EventDef, type EventRef } from "../../packages/sdk/src/events.ts";
import type { AgendaDef } from "../../packages/sdk/src/generated/agenda.ts";
import type { BuildingDef } from "../../packages/sdk/src/generated/building.ts";
import {
  defineAgenda,
  defineBuilding,
  defineEdict,
  defineTechnology,
  defineTradition,
  defineTraditionCategory,
  patchTechnology,
} from "../../packages/sdk/src/generated/content-definers.ts";
import type { EdictDef } from "../../packages/sdk/src/generated/edict.ts";
import type { ScopeName } from "../../packages/sdk/src/generated/scopes.ts";
import type { TechnologyDef } from "../../packages/sdk/src/generated/technology.ts";
import type { TraditionCategoryDef } from "../../packages/sdk/src/generated/tradition-category.ts";
import type { TraditionDef } from "../../packages/sdk/src/generated/tradition.ts";
import {
  assertNamespace,
  collection,
  FILE_STEM_PATTERN,
  type Collection,
  type ContentItem,
  type EventItem,
  type ModItem,
} from "../../packages/sdk/src/items.ts";

export interface ProbeIdProfile {
  readonly technology: string;
  readonly building: string;
  readonly agenda: string;
  readonly tradition: string;
  readonly traditionCategory: string;
  readonly edict: string;
}

export type CapabilityConfig<P extends string> = Readonly<Omit<ModConfig<P>, "tags">> & {
  readonly tags?: readonly string[];
};

export const stellarisIds = {
  technology: "tech",
  building: "building",
  agenda: "agenda",
  tradition: "tradition",
  traditionCategory: "tradition_category",
  edict: "edict",
} as const satisfies ProbeIdProfile;

type ProfileSegment<I extends ProbeIdProfile, K extends keyof ProbeIdProfile> = I[K] & string;

export type MintedContentId<
  P extends string,
  I extends ProbeIdProfile,
  K extends keyof ProbeIdProfile,
  N extends string,
> = `${P}_${ProfileSegment<I, K>}_${N}`;

export type MintedNamespace<P extends string, N extends string> = N extends "" ? P : `${P}_${N}`;

export type MintedEventId<
  P extends string,
  N extends string,
  Id extends number,
> = `${MintedNamespace<P, N>}.${Id}`;

type CapabilityEventItem<
  P extends string,
  N extends string,
  Id extends number,
  S extends ScopeName,
  From extends ScopeName | undefined,
  Kind extends string = S,
> = EventItem<S, From, Kind> & {
  readonly id: MintedEventId<P, N, Id>;
};

export type CapabilityEventHandle<
  P extends string,
  N extends string,
  Id extends number,
  S extends ScopeName,
  From extends ScopeName | undefined,
  Kind extends string = S,
> = EventRef<S, From, Kind> & {
  readonly id: MintedEventId<P, N, Id>;
  define(def: Omit<EventDef<S, From>, "id" | "from">): CapabilityEventItem<P, N, Id, S, From, Kind>;
};

const capabilityFeatureOwner: unique symbol = Symbol("capability feature owner");

/** A feature placed by one particular mod capability. */
export type CapabilityFeature<P extends string, T extends ModItem = ModItem> = Collection<T> & {
  readonly [capabilityFeatureOwner]: P;
};

export interface CapabilityEvents<P extends string, N extends string> {
  readonly namespace: MintedNamespace<P, N>;
  country<const Id extends number, From extends ScopeName | undefined = undefined>(
    id: Id,
    def: Omit<EventDef<"country", From>, "id">
  ): CapabilityEventItem<P, N, Id, "country", From>;
  planet<const Id extends number, From extends ScopeName | undefined = undefined>(
    id: Id,
    def: Omit<EventDef<"planet", From>, "id">
  ): CapabilityEventItem<P, N, Id, "planet", From>;
  countryHandle<const Id extends number, From extends ScopeName | undefined = undefined>(
    id: Id,
    contract?: { readonly from?: From }
  ): CapabilityEventHandle<P, N, Id, "country", From>;
  planetHandle<const Id extends number, From extends ScopeName | undefined = undefined>(
    id: Id,
    contract?: { readonly from?: From }
  ): CapabilityEventHandle<P, N, Id, "planet", From>;
}

export interface ModCapability<P extends string, I extends ProbeIdProfile> {
  readonly config: CapabilityConfig<P>;
  readonly ids: Readonly<I>;
  technology<const N extends string>(
    name: N,
    def: Omit<TechnologyDef<MintedContentId<P, I, "technology", N>>, "id">
  ): ContentItem<"technology", TechnologyDef<MintedContentId<P, I, "technology", N>>>;
  building<const N extends string>(
    name: N,
    def: Omit<BuildingDef<MintedContentId<P, I, "building", N>>, "id">
  ): ContentItem<"building", BuildingDef<MintedContentId<P, I, "building", N>>>;
  agenda<const N extends string>(
    name: N,
    def: Omit<AgendaDef<MintedContentId<P, I, "agenda", N>>, "id">
  ): ContentItem<"agenda", AgendaDef<MintedContentId<P, I, "agenda", N>>>;
  tradition<const N extends string>(
    name: N,
    def: Omit<TraditionDef<MintedContentId<P, I, "tradition", N>>, "id">
  ): ContentItem<"tradition", TraditionDef<MintedContentId<P, I, "tradition", N>>>;
  traditionCategory<const N extends string>(
    name: N,
    def: Omit<TraditionCategoryDef<MintedContentId<P, I, "traditionCategory", N>>, "id">
  ): ContentItem<
    "tradition_category",
    TraditionCategoryDef<MintedContentId<P, I, "traditionCategory", N>>
  >;
  edict<const N extends string>(
    name: N,
    def: Omit<EdictDef<MintedContentId<P, I, "edict", N>>, "id">
  ): ContentItem<"edict", EdictDef<MintedContentId<P, I, "edict", N>>>;
  namespace<const N extends string>(name: N): CapabilityEvents<P, N>;
  feature<T extends ModItem>(
    file: string | undefined,
    items: readonly T[]
  ): CapabilityFeature<P, T>;
  compile(features: readonly CapabilityFeature<P>[], options?: BuildOptions): PureMod;
  readonly patchTechnology: typeof patchTechnology;
  readonly on: typeof on;
}

function mintContentId<
  P extends string,
  I extends ProbeIdProfile,
  K extends keyof ProbeIdProfile,
  N extends string,
>(prefix: P, ids: I, registry: K, name: N): MintedContentId<P, I, K, N> {
  if (!FILE_STEM_PATTERN.test(name)) {
    throw new Error(
      `Logical content name "${name}" must be lowercase snake_case ([a-z][a-z0-9_]*)`
    );
  }
  return `${prefix}_${ids[registry]}_${name}` as MintedContentId<P, I, K, N>;
}

function mintNamespace<P extends string, N extends string>(
  prefix: P,
  name: N
): MintedNamespace<P, N> {
  return (name === "" ? prefix : `${prefix}_${name}`) as MintedNamespace<P, N>;
}

function makeEventHandle<
  P extends string,
  N extends string,
  Id extends number,
  S extends ScopeName,
  From extends ScopeName | undefined,
  Kind extends string,
>(
  namespace: MintedNamespace<P, N>,
  id: Id,
  eventKind: Parameters<typeof buildEvent>[0],
  scope: S,
  kind: Kind,
  from: From
): CapabilityEventHandle<P, N, Id, S, From, Kind> {
  const fullId = `${namespace}.${id}` as MintedEventId<P, N, Id>;
  const define = (
    def: Omit<EventDef<S, From>, "id" | "from">
  ): CapabilityEventItem<P, N, Id, S, From, Kind> => {
    const locEntries: (readonly [string, string])[] = [];
    const built = buildEvent(
      eventKind,
      scope,
      namespace,
      { ...def, id, from } as EventDef<S, From>,
      { register: (key, text) => locEntries.push([key, text]) }
    );
    return {
      ...built,
      id: fullId,
      itemKind: "event",
      namespace,
      locEntries,
    } as CapabilityEventItem<P, N, Id, S, From, Kind>;
  };
  return Object.freeze({
    kind: "event-ref",
    scope,
    from,
    id: fullId,
    define,
  }) as CapabilityEventHandle<P, N, Id, S, From, Kind>;
}

function eventsFor<P extends string, N extends string>(prefix: P, name: N): CapabilityEvents<P, N> {
  const namespace = mintNamespace(prefix, name);
  assertNamespace(namespace);
  const countryHandle = <const Id extends number, From extends ScopeName | undefined = undefined>(
    id: Id,
    contract: { readonly from?: From } = {}
  ): CapabilityEventHandle<P, N, Id, "country", From> =>
    makeEventHandle(namespace, id, "country_event", "country", "country", contract.from as From);
  const planetHandle = <const Id extends number, From extends ScopeName | undefined = undefined>(
    id: Id,
    contract: { readonly from?: From } = {}
  ): CapabilityEventHandle<P, N, Id, "planet", From> =>
    makeEventHandle(namespace, id, "planet_event", "planet", "planet", contract.from as From);

  return Object.freeze({
    namespace,
    countryHandle,
    planetHandle,
    country: <const Id extends number, From extends ScopeName | undefined = undefined>(
      id: Id,
      def: Omit<EventDef<"country", From>, "id">
    ) => countryHandle(id, { from: def.from }).define(def),
    planet: <const Id extends number, From extends ScopeName | undefined = undefined>(
      id: Id,
      def: Omit<EventDef<"planet", From>, "id">
    ) => planetHandle(id, { from: def.from }).define(def),
  });
}

function snapshotConfig<P extends string>(config: ModConfig<P>): ModConfig<P> {
  const tags = config.tags === undefined ? undefined : Object.freeze([...config.tags]);
  return Object.freeze({ ...config, tags }) as ModConfig<P>;
}

function validateAuthoringInputs<P extends string, I extends ProbeIdProfile>(
  config: ModConfig<P>,
  ids: I
): void {
  if (!FILE_STEM_PATTERN.test(config.prefix)) {
    throw new Error(`Mod prefix "${config.prefix}" must be lowercase snake_case ([a-z][a-z0-9_]*)`);
  }
  for (const [registry, segment] of Object.entries(ids)) {
    if (!FILE_STEM_PATTERN.test(segment)) {
      throw new Error(`Id profile segment "${registry}: ${segment}" must be lowercase snake_case`);
    }
  }
}

function belongsToPrefix(value: string, prefix: string): boolean {
  return value.startsWith(`${prefix}_`);
}

function namespaceBelongsToPrefix(namespace: string, prefix: string): boolean {
  return namespace === prefix || belongsToPrefix(namespace, prefix);
}

function assertEventNamespace(namespace: string, prefix: string, where: string): void {
  if (!namespaceBelongsToPrefix(namespace, prefix)) {
    throw new Error(`${where} namespace "${namespace}" does not belong to mod prefix "${prefix}"`);
  }
}

function assertCapabilityItem(item: ModItem, prefix: string): void {
  switch (item.itemKind) {
    case "content":
      if (!belongsToPrefix(item.id, prefix)) {
        throw new Error(`Content id "${item.id}" does not belong to mod prefix "${prefix}"`);
      }
      return;
    case "event":
      assertEventNamespace(item.namespace, prefix, "Event");
      return;
    case "on-action":
      item.events.forEach((event) =>
        assertEventNamespace(event.namespace, prefix, "On-action event")
      );
      return;
    case "patch":
    case "contribution":
      return;
  }
}

function assertCapabilityFeature<P extends string>(
  feature: CapabilityFeature<P>,
  owner: object,
  prefix: P
): void {
  if (
    (feature as { readonly [capabilityFeatureOwner]: unknown })[capabilityFeatureOwner] !== owner
  ) {
    throw new Error(`Feature does not belong to mod prefix "${prefix}"`);
  }
  feature.items.forEach((item) => assertCapabilityItem(item, prefix));
}

export function createMod<const P extends string, const I extends ProbeIdProfile>(
  configInput: ModConfig<P>,
  options: { readonly ids: I }
): ModCapability<P, I> {
  validateAuthoringInputs(configInput, options.ids);
  const config = snapshotConfig(configInput);
  const ids = Object.freeze({ ...options.ids }) as I;
  const owner = Object.freeze({});

  return Object.freeze({
    config,
    ids,
    technology: <const N extends string>(
      name: N,
      def: Omit<TechnologyDef<MintedContentId<P, I, "technology", N>>, "id">
    ) =>
      defineTechnology({
        ...def,
        id: mintContentId(config.prefix, ids, "technology", name),
      } as TechnologyDef<MintedContentId<P, I, "technology", N>>),
    building: <const N extends string>(
      name: N,
      def: Omit<BuildingDef<MintedContentId<P, I, "building", N>>, "id">
    ) =>
      defineBuilding({
        ...def,
        id: mintContentId(config.prefix, ids, "building", name),
      } as BuildingDef<MintedContentId<P, I, "building", N>>),
    agenda: <const N extends string>(
      name: N,
      def: Omit<AgendaDef<MintedContentId<P, I, "agenda", N>>, "id">
    ) =>
      defineAgenda({
        ...def,
        id: mintContentId(config.prefix, ids, "agenda", name),
      } as AgendaDef<MintedContentId<P, I, "agenda", N>>),
    tradition: <const N extends string>(
      name: N,
      def: Omit<TraditionDef<MintedContentId<P, I, "tradition", N>>, "id">
    ) =>
      defineTradition({
        ...def,
        id: mintContentId(config.prefix, ids, "tradition", name),
      } as TraditionDef<MintedContentId<P, I, "tradition", N>>),
    traditionCategory: <const N extends string>(
      name: N,
      def: Omit<TraditionCategoryDef<MintedContentId<P, I, "traditionCategory", N>>, "id">
    ) =>
      defineTraditionCategory({
        ...def,
        id: mintContentId(config.prefix, ids, "traditionCategory", name),
      } as TraditionCategoryDef<MintedContentId<P, I, "traditionCategory", N>>),
    edict: <const N extends string>(
      name: N,
      def: Omit<EdictDef<MintedContentId<P, I, "edict", N>>, "id">
    ) =>
      defineEdict({
        ...def,
        id: mintContentId(config.prefix, ids, "edict", name),
      } as EdictDef<MintedContentId<P, I, "edict", N>>),
    namespace: <const N extends string>(name: N) => eventsFor(config.prefix, name),
    feature: <T extends ModItem>(file: string | undefined, items: readonly T[]) => {
      items.forEach((item) => assertCapabilityItem(item, config.prefix));
      return Object.freeze({
        ...collection(file, items),
        [capabilityFeatureOwner]: owner,
      }) as CapabilityFeature<P, T>;
    },
    compile: (features: readonly CapabilityFeature<P>[], buildOptions: BuildOptions = {}) => {
      features.forEach((feature) => assertCapabilityFeature(feature, owner, config.prefix));
      return buildMod(config, features, buildOptions);
    },
    patchTechnology,
    on,
  });
}
