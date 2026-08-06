import { buildMod } from "../compiler/compile.ts";
import {
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type ResolvedModConfig,
} from "../compiler/config.ts";
import type { PureMod } from "../compiler/model.ts";
import { buildEvent } from "../events/lower.ts";
import { on } from "../events/on-actions.ts";
import type { EventDef } from "../events/types.ts";
import {
  contentCapabilityMethods,
  DEFAULT_ID_PROFILE,
  type ContentCapabilityMethods,
  type ContentIdMinter,
  type IdProfile as GeneratedIdProfile,
  type MintedContentId as GeneratedMintedContentId,
} from "../generated/content-capability.ts";
import {
  capabilityEvents,
  type CapabilityEventMinter,
  type CapabilityEventHandle as GeneratedCapabilityEventHandle,
  type CapabilityEventItem as GeneratedCapabilityEventItem,
  type CapabilityEvents as GeneratedCapabilityEvents,
  type MintedEventId,
  type MintedNamespace,
} from "../generated/event-definers.ts";
import type { EventKindKey } from "../generated/events.ts";
import type { ScopeName } from "../generated/scopes.ts";
import {
  assertNamespace,
  createFeature,
  FILE_STEM_PATTERN,
  type Feature,
  type ModItem,
} from "./feature.ts";

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
export type CapabilityFeature<P extends string, T extends ModItem = ModItem> = Feature<T> & {
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
 * A defined capability event with its exact prefix, namespace, numeric id,
 * scope, and FROM contract preserved for public return values and fire sites.
 */
export type { CapabilityEventItem } from "../generated/event-definers.ts";

/**
 * Immutable, mod-bound authoring functions. The capability owns its config,
 * id profile, and feature placement while definitions remain pure values.
 */
export type ModCapability<P extends string, I extends IdProfile> = {
  /** The resolved descriptor this capability will compile with. */
  readonly config: ResolvedModConfig<P>;
  /** The id segments used by this capability's content methods. */
  readonly ids: Readonly<I>;
  /**
   * Opens a capability-owned event namespace. With no argument it selects the
   * root namespace (exactly the mod prefix); a name adds a suffix to that prefix.
   */
  readonly namespace: {
    (): CapabilityEvents<P, "">;
    <const N extends string>(name: N): CapabilityEvents<P, N>;
  };
  /** Places pure items in one capability-owned feature file. */
  feature<T extends ModItem>(
    stem: string | undefined,
    items: readonly T[]
  ): CapabilityFeature<P, T>;
  /** Compiles only features placed by this capability into a pure mod value. */
  compile(features: readonly CapabilityFeature<P>[], options?: BuildOptions): PureMod;
  /** Creates a pure on-action contribution; place its returned value in a feature. */
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

function assertNestedDefinitionId(prefix: string): (id: string) => void {
  return (id) => {
    if (!FILE_STEM_PATTERN.test(id)) {
      throw new Error(
        `Nested definition id "${id}" must be lowercase snake_case ([a-z][a-z0-9_]*)`
      );
    }
    if (!belongsToPrefix(id, prefix)) {
      throw new Error(`Nested definition id "${id}" does not belong to mod prefix "${prefix}"`);
    }
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
  const minter: CapabilityEventMinter<P, N> = {
    namespace,
    handle: (id, kind, scope, subtype, from) =>
      makeEventHandle(namespace, id, kind, scope, subtype, from),
  };
  return capabilityEvents(minter);
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
      // A patch keeps vanilla's id, so there is no id to hold to the prefix —
      // that half of the old blanket exemption still stands. The other half
      // does not: the capability binds its prefix into `patchX`, and every
      // localisation key the patch mints is built from it, so an item minted
      // by one capability and placed in another's feature would write the
      // first's keys into the second's output. The baked prefix is what makes
      // that ownership checkable at all.
      if (item.patched.prefix !== prefix) {
        throw new Error(
          `The ${item.patched.registry} patch of "${item.patched.id}" was created by the ` +
            `capability for mod prefix "${item.patched.prefix}", not "${prefix}", so it mints ` +
            `localisation keys belonging to a different mod. Create the patch with the same ` +
            "capability that places it."
        );
      }
      return;
    case "contribution":
      // Nothing prefix-bound: `addShipOfSizeLimits` is a free function that
      // binds no prefix, and the ids it lists are held to the fold's own
      // dangling-reference guard against the definitions this build actually
      // contains. There is no capability identity baked in to disagree with.
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
    mintContentId(config.prefix, ids),
    assertNestedDefinitionId(config.prefix),
    config.prefix
  );

  return Object.freeze({
    config,
    ids,
    ...content,
    namespace: <const N extends string>(name: N = "" as N) => eventsFor(config.prefix, name),
    feature: <T extends ModItem>(stem: string | undefined, items: readonly T[]) => {
      items.forEach((item) => assertCapabilityItem(item, config.prefix));
      return Object.freeze({
        ...createFeature(stem, items),
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
