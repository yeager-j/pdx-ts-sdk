import {
  buildMod,
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type PureMod,
  type ResolvedModConfig,
} from "./build.ts";
import { on } from "./definers.ts";
import { buildEvent, type EventDef } from "./events.ts";
import {
  contentCapabilityMethods,
  DEFAULT_ID_PROFILE,
  type ContentCapabilityMethods,
  type ContentIdMinter,
  type IdProfile as GeneratedIdProfile,
  type MintedContentId as GeneratedMintedContentId,
} from "./generated/content-definers.ts";
import {
  capabilityEvents,
  type CapabilityEventBuilder,
  type CapabilityEventHandle as GeneratedCapabilityEventHandle,
  type CapabilityEventItem as GeneratedCapabilityEventItem,
  type CapabilityEvents as GeneratedCapabilityEvents,
  type MintedEventId,
  type MintedNamespace,
} from "./generated/event-definers.ts";
import type { EventKindKey } from "./generated/events.ts";
import type { ScopeName } from "./generated/scopes.ts";
import {
  assertNamespace,
  collection,
  FILE_STEM_PATTERN,
  type Collection,
  type ModItem,
} from "./items.ts";

const capabilityFeatureOwner: unique symbol = Symbol("mod capability feature owner");

interface CapabilityFeatureOwner<P extends string> {
  readonly prefix: P;
}

/** A complete set of conventional content-id segments for one mod capability. */
export type IdProfile = GeneratedIdProfile;

/** The literal own-content id minted from a mod prefix, profile segment, and logical name. */
export type MintedContentId<
  P extends string,
  I extends IdProfile,
  K extends keyof I,
  Name extends string,
> = GeneratedMintedContentId<P, I, K, Name>;

/** A feature placed by one particular mod capability. */
export type CapabilityFeature<P extends string, T extends ModItem = ModItem> = Collection<T> & {
  readonly [capabilityFeatureOwner]: CapabilityFeatureOwner<P>;
};

/** A mod-bound event namespace whose ids are minted from the capability prefix. */
export type CapabilityEvents<P extends string, N extends string> = GeneratedCapabilityEvents<P, N>;

/** An immutable event reference that can be defined after it is first referenced. */
export type CapabilityEventHandle<
  P extends string,
  N extends string,
  Id extends number,
  S extends ScopeName,
  From extends ScopeName | undefined,
  Kind extends string = S,
> = GeneratedCapabilityEventHandle<P, N, Id, S, From, Kind>;

/**
 * Immutable, mod-bound authoring functions. The capability owns its config,
 * id profile, and feature placement while definitions remain pure values.
 */
export type ModCapability<P extends string, I extends IdProfile> = {
  readonly config: ResolvedModConfig<P>;
  readonly ids: Readonly<I>;
  readonly namespace: {
    (): CapabilityEvents<P, "">;
    <const N extends string>(name: N): CapabilityEvents<P, N>;
  };
  feature<T extends ModItem>(
    file: string | undefined,
    items: readonly T[]
  ): CapabilityFeature<P, T>;
  compile(features: readonly CapabilityFeature<P>[], options?: BuildOptions): PureMod;
  readonly on: typeof on;
} & ContentCapabilityMethods<P, I>;

function assertLogicalName(name: string): void {
  if (!FILE_STEM_PATTERN.test(name)) {
    throw new Error(
      `Logical content name "${name}" must be lowercase snake_case ([a-z][a-z0-9_]*)`
    );
  }
}

function mintContentId<P extends string, I extends IdProfile>(
  prefix: P,
  ids: I
): ContentIdMinter<P, I> {
  return <const K extends keyof I, const Name extends string>(
    registry: K,
    name: Name
  ): MintedContentId<P, I, K, Name> => {
    assertLogicalName(name);
    return `${prefix}_${ids[registry]}_${name}` as MintedContentId<P, I, K, Name>;
  };
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
  kind: EventKindKey,
  scope: S,
  subtype: Kind,
  from: From
): CapabilityEventHandle<P, N, Id, S, From, Kind> {
  const fullId = `${namespace}.${id}` as MintedEventId<P, N, Id>;
  const define = (
    def: Omit<EventDef<S, From>, "id" | "from">
  ): GeneratedCapabilityEventItem<P, N, Id, S, From, Kind> => {
    const locEntries: (readonly [string, string])[] = [];
    const built = buildEvent(kind, scope, namespace, { ...def, id, from } as EventDef<S, From>, {
      register: (key, text) => locEntries.push([key, text]),
    });
    return {
      ...built,
      id: fullId,
      itemKind: "event",
      namespace,
      locEntries,
    } as GeneratedCapabilityEventItem<P, N, Id, S, From, Kind>;
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
  const builder: CapabilityEventBuilder<P, N> = {
    namespace,
    handle: (id, kind, scope, subtype, from) =>
      makeEventHandle(namespace, id, kind, scope, subtype, from),
  };
  return capabilityEvents(builder);
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
  owner: CapabilityFeatureOwner<P>,
  prefix: P
): void {
  if (feature[capabilityFeatureOwner] !== owner) {
    throw new Error(`Feature does not belong to mod prefix "${prefix}"`);
  }
  feature.items.forEach((item) => assertCapabilityItem(item, prefix));
}

function resolveIdProfile<I extends IdProfile>(profile: I): Readonly<I> {
  const expected = Object.keys(DEFAULT_ID_PROFILE);
  const actual = Object.keys(profile);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !(key in profile)) ||
    actual.some((key) => !(key in DEFAULT_ID_PROFILE))
  ) {
    throw new Error(
      "Id profile must provide exactly one lowercase snake_case segment for every registry"
    );
  }
  for (const key of expected) {
    const segment = profile[key as keyof I];
    if (typeof segment !== "string" || !FILE_STEM_PATTERN.test(segment)) {
      throw new Error(
        `Id profile segment "${key}: ${String(segment)}" must be lowercase snake_case`
      );
    }
  }
  return Object.freeze({ ...profile });
}

/** Creates an immutable capability using the reviewed default id profile. */
export function createMod<const P extends string>(
  config: ModConfig<P>
): ModCapability<P, typeof DEFAULT_ID_PROFILE>;
/** Creates an immutable capability using one complete custom id profile. */
export function createMod<const P extends string, const I extends IdProfile>(
  config: ModConfig<P>,
  options: { readonly ids: I }
): ModCapability<P, I>;
export function createMod<const P extends string, const I extends IdProfile>(
  configInput: ModConfig<P>,
  options?: { readonly ids: I }
): ModCapability<P, I | typeof DEFAULT_ID_PROFILE> {
  const config = resolveConfig(configInput);
  const ids = resolveIdProfile(options?.ids ?? DEFAULT_ID_PROFILE);
  const owner: CapabilityFeatureOwner<P> = Object.freeze({ prefix: config.prefix });
  const content = contentCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(
    mintContentId(config.prefix, ids)
  );

  return Object.freeze({
    config,
    ids,
    ...content,
    namespace: <const N extends string>(name: N = "" as N) => eventsFor(config.prefix, name),
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
    on,
  }) as ModCapability<P, I | typeof DEFAULT_ID_PROFILE>;
}
