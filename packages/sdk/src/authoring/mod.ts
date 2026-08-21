import { buildMod } from "../compiler/compile.ts";
import {
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type ResolvedModConfig,
} from "../compiler/config.ts";
import type { PureMod } from "../compiler/model.ts";
import { acceptsExactNames, mintHeadOf } from "../content/descriptors.ts";
import {
  eventChainCapabilityMethods,
  type EventChainCapabilityMethods,
} from "../content/event-chains.ts";
import { exactNameMintOf, shapeMintOf } from "../content/mint-provenance.ts";
import { carriesPrefixSegment } from "../content/schema.ts";
import {
  situationTypeCapabilityMethods,
  type SituationTypeCapabilityMethods,
} from "../content/situations.ts";
import { assertEventNumber, buildEvent } from "../events/lower.ts";
import { on } from "../events/on-actions.ts";
import type { EventDef } from "../events/types.ts";
import {
  contentCapabilityMethods,
  DEFAULT_ID_PROFILE,
  EXACT_NAME_MINTS,
  MINT_SHAPES,
  type ContentCapabilityMethods,
  type ContentIdMinter,
  type ExactNameRegistry,
  type IdProfile as GeneratedIdProfile,
  type MintedContentId as GeneratedMintedContentId,
  type MintedIdOf,
  type MintNameOptions,
  type MintShapedRegistry,
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
  assertAssetOwner,
  captureAssetFile,
  captureAssetTree,
  type AssetCapabilityOwner,
  type AssetFileInput,
  type AssetFileItem,
  type AssetTreeInput,
} from "./assets.ts";
import {
  assertNamespace,
  createFeature,
  FILE_STEM_PATTERN,
  type Feature,
  type ModItem,
} from "./feature.ts";
import {
  createLocalizationItem,
  createReplacementLocalizationItem,
  type LocalizationItem,
  type LocalizationText,
  type ReplacementLocalizationItem,
} from "./localization.ts";

const capabilityFeatureOwner: unique symbol = Symbol("mod capability feature owner");

interface CapabilityFeatureOwner<P extends string> extends AssetCapabilityOwner {
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
  /** Captures one regular source file into SDK-owned Asset bytes. */
  assetFile(input: AssetFileInput): AssetFileItem;
  /** Captures every regular file in one source directory into SDK-owned Asset bytes. */
  assetTree(input: AssetTreeInput): readonly AssetFileItem[];
  /** Compiles only features placed by this capability into a pure mod value. */
  compile(features: readonly CapabilityFeature<P>[], options?: BuildOptions): PureMod;
  /** Creates a pure on-action contribution; place its returned value in a feature. */
  readonly on: typeof on;
  /**
   * Creates standalone localization under a key owned by this mod.
   *
   * Keys include the mod prefix by default. Pass `{ prefix: false }` only when
   * Stellaris requires an exact key in the ordinary localization layer.
   *
   * Place the returned item in a feature and use its exact `.key` wherever
   * Stellaris expects a localization key.
   */
  localization<const Key extends string, const ShouldPrefix extends boolean = true>(
    key: Key,
    text: LocalizationText,
    options?: { readonly prefix?: ShouldPrefix }
  ): LocalizationItem<P, Key, ShouldPrefix>;
  /**
   * Deliberately replaces an existing localization key without adding the mod prefix.
   *
   * Use this for free-standing keys that a typed content patch cannot reach,
   * such as event option text. The returned item always emits through the
   * feature's `localisation/replace/` files.
   */
  replaceLocalization<const Key extends string>(
    key: Key,
    text: LocalizationText
  ): ReplacementLocalizationItem<P, Key>;
} & ContentCapabilityMethods<P, I> &
  SituationTypeCapabilityMethods<P, I> &
  EventChainCapabilityMethods<P, I>;

function assertLogicalName(name: string): void {
  if (!FILE_STEM_PATTERN.test(name)) {
    throw new Error(
      `Logical content name "${name}" must be lowercase snake_case ([a-z][a-z0-9_]*)`
    );
  }
}

type ExactNameRules = (typeof EXACT_NAME_MINTS)[ExactNameRegistry];

/**
 * The logical-name rule for one registry: the global lowercase stem rule,
 * unless the generated `EXACT_NAME_MINTS` table widens it. The table, not the
 * registry name, is what decides — a new exact-name registry is a codegen
 * change alone.
 */
function assertMintedName(registry: string, name: string): void {
  const rules = EXACT_NAME_MINTS[registry as ExactNameRegistry] as ExactNameRules | undefined;
  if (rules === undefined) {
    assertLogicalName(name);
    return;
  }
  if (!rules.name.test(name)) {
    throw new Error(
      `Logical ${registry} name "${name}" must be snake_case led by a lowercase letter; ` +
        "interior uppercase is allowed ([a-z][A-Za-z0-9_]*)"
    );
  }
}

/**
 * The `prefix: false` rule: the name is the complete definition id, one bare
 * word, and the mod prefix must appear in it as a `_`-delimited segment. The
 * generated method overloads already enforce both, so these are the runtime
 * halves of the same contract for values that reach the mint another way.
 */
function assertExactName(registry: string, name: string, prefix: string): void {
  const rules = EXACT_NAME_MINTS[registry as ExactNameRegistry] as ExactNameRules | undefined;
  if (rules === undefined) {
    throw new Error(
      `Registry "${registry}" mints its names from a logical name and has no exact-name ` +
        "opt-out; remove `prefix: false`"
    );
  }
  const segment = `"${prefix}_...", "..._${prefix}", or "..._${prefix}_..."`;
  if (!rules.exact.test(name)) {
    throw new Error(
      `Exact ${registry} name "${name}" must be one bare word ([A-Za-z][A-Za-z0-9_]*) that ` +
        `carries the mod prefix "${prefix}" as a "_"-delimited segment (${segment})`
    );
  }
  if (!carriesPrefixSegment(name, prefix)) {
    throw new Error(
      `Exact ${registry} name "${name}" must carry the mod prefix "${prefix}" as a ` +
        `"_"-delimited segment (${segment}), and must be one bare word ` +
        "([A-Za-z][A-Za-z0-9_]*) — `prefix: false` only means the capability does not " +
        "prepend the prefix, never that the prefix may be absent"
    );
  }
}

/**
 * A registry either carries an id segment an author may override, or a fixed
 * mint head the game requires — never both, and the generated `MINT_SHAPES`
 * table says which. Reading the table here rather than branching on registry
 * names is what keeps a new segmentless registry a codegen change alone. The
 * generated `EXACT_NAME_MINTS` table is read the same way for the per-registry
 * name charset and the `prefix: false` opt-out.
 */
function mintContentId<P extends string, I extends IdProfile>(
  prefix: P,
  ids: I
): ContentIdMinter<P, I> {
  return <const K extends keyof I | MintShapedRegistry, const Name extends string>(
    registry: K,
    name: Name,
    options?: MintNameOptions
  ): MintedIdOf<P, I, K, Name> => {
    if (options?.prefix === false) {
      assertExactName(registry as string, name, prefix);
      // The name is the complete id: the option opted out of the prepend, and
      // the assertion above held it to the prefix-segment rule instead.
      return name as string as MintedIdOf<P, I, K, Name>;
    }
    assertMintedName(registry as string, name);
    const head = MINT_SHAPES[registry as MintShapedRegistry] as string | undefined;
    const id =
      head === undefined
        ? `${prefix}_${ids[registry as keyof I]}_${name}`
        : `${head}${prefix}_${name}`;
    return id as MintedIdOf<P, I, K, Name>;
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
  assertEventNumber(id);
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

function assertCapabilityItem(
  item: ModItem,
  owner: CapabilityFeatureOwner<string>,
  prefix: string
): void {
  switch (item.itemKind) {
    case "content": {
      // A shape-minted name is built from another definition's id and may carry
      // no prefix at all, so ownership was recorded when it was minted. The
      // record is read from the module-private table, never from `item.minted`
      // — that property is a public object any caller can attach to any item,
      // so trusting it would let a foreign definition place itself here. Where
      // there is no record the name itself is the evidence, measured against
      // the registry's own mint head.
      const shapeMint = shapeMintOf(item);
      if (shapeMint !== undefined) {
        if (shapeMint.owner !== owner) {
          throw new Error(
            `The ${shapeMint.shape} sprite "${item.id}" was minted by a different capability — ` +
              `the one for mod prefix "${shapeMint.owner.prefix}", not this one for "${prefix}". ` +
              "Mint it with the same capability that places it."
          );
        }
        return;
      }
      // An exact-name mint (`prefix: false`, SDK-183) recorded its capability
      // the way a shape mint does, and the record is the ownership evidence:
      // a name can carry two mods' prefixes as segments, so containment alone
      // would let either capability claim the item.
      const exactMint = exactNameMintOf(item);
      if (exactMint !== undefined) {
        if (exactMint !== owner) {
          throw new Error(
            `The exact-name ${item.type} "${item.id}" was minted by a different capability — ` +
              `the one for mod prefix "${exactMint.prefix}", not this one for "${prefix}". ` +
              "Mint it with the same capability that places it."
          );
        }
        return;
      }
      // An exact-name registry's own names may carry the prefix at the head,
      // the tail, or inside, so `startsWith` would refuse legitimate names.
      // Segment containment is the string evidence for an item that carries
      // no record — one built outside the capability mint, or a spread copy.
      if (acceptsExactNames(item.type)) {
        if (!carriesPrefixSegment(item.id, prefix)) {
          throw new Error(
            `Content id "${item.id}" does not belong to mod prefix "${prefix}" ` +
              `(a ${item.type} name carries the prefix as a "_"-delimited segment)`
          );
        }
        return;
      }
      const head = mintHeadOf(item.type);
      if (!item.id.startsWith(`${head}${prefix}_`)) {
        throw new Error(
          `Content id "${item.id}" does not belong to mod prefix "${prefix}"` +
            (head === "" ? "" : ` (a ${item.type} name is "${head}${prefix}_"-led)`)
        );
      }
      return;
    }
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
    case "localization":
      if (item.prefix !== prefix) {
        throw new Error(
          `Localization key "${item.key}" belongs to mod prefix "${item.prefix}", not "${prefix}"`
        );
      }
      return;
    case "asset":
      assertAssetOwner(item, owner);
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
  feature.items.forEach((item) => assertCapabilityItem(item, owner, prefix));
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
  const owner: CapabilityFeatureOwner<P> = Object.freeze({
    prefix: config.prefix,
    assetCapability: Symbol("asset capability"),
  });
  const content = contentCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(
    mintContentId(config.prefix, ids),
    assertNestedDefinitionId(config.prefix),
    config.prefix,
    assertLogicalName,
    // The identity a shape mint is recorded against, so a mint can be traced to
    // one capability rather than merely to a prefix string.
    owner
  );
  const situationTypes = situationTypeCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(
    mintContentId(config.prefix, ids),
    assertNestedDefinitionId(config.prefix)
  );
  const eventChains = eventChainCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(
    mintContentId(config.prefix, ids)
  );

  return Object.freeze({
    config,
    ids,
    ...content,
    ...situationTypes,
    ...eventChains,
    namespace: <const N extends string>(name: N = "" as N) => eventsFor(config.prefix, name),
    assetFile: (input: AssetFileInput) => captureAssetFile(owner, input),
    assetTree: (input: AssetTreeInput) => captureAssetTree(owner, input),
    feature: <T extends ModItem>(stem: string | undefined, items: readonly T[]) => {
      items.forEach((item) => assertCapabilityItem(item, owner, config.prefix));
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
    localization: <const Key extends string, const ShouldPrefix extends boolean = true>(
      key: Key,
      text: LocalizationText,
      localizationOptions?: { readonly prefix?: ShouldPrefix }
    ) => createLocalizationItem(config.prefix, key, text, localizationOptions),
    replaceLocalization: <const Key extends string>(key: Key, text: LocalizationText) =>
      createReplacementLocalizationItem(config.prefix, key, text),
  }) as ModCapability<P, I | typeof DEFAULT_ID_PROFILE>;
}
