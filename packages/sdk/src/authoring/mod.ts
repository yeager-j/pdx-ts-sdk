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
import { missionCapabilityMethods, type MissionCapabilityMethods } from "../content/missions.ts";
import { carriesPrefixSegment } from "../content/schema.ts";
import {
  situationTypeCapabilityMethods,
  type SituationTypeCapabilityMethods,
} from "../content/situations.ts";
import { assertEventNumber, buildEvent } from "../events/lower.ts";
import { on } from "../events/on-actions.ts";
import { isAuthoredEvent, type EventDef } from "../events/types.ts";
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
import { LOWERCASE_SNAKE_CASE } from "../identity.ts";
import type { AmbientScopeContext } from "../script/effects/types.ts";
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
  assertComponentTagOwner,
  createComponentTagItem,
  type ComponentTagItem,
} from "./component-tags.ts";
import { assertNamespace, createFeature, type Feature, type ModItem } from "./feature.ts";
import {
  createReplacementLocalizationItem,
  localizationFor,
  type KeyedLocalization,
  type LocalizationMethod,
  type LocalizationReplacementText,
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
  Context extends AmbientScopeContext,
  Kind extends string = S,
> = GeneratedCapabilityEventHandle<P, N, Id, S, Context, Kind>;

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
   * Declares a component tag owned by this mod.
   *
   * Place the returned item in a Feature before compiling content that uses it.
   *
   * Generated modifiers using this tag need matching `mod_<modifier_key>` localization and
   * `gfx/interface/icons/modifiers/<modifier_key>.dds`; add both through the existing APIs.
   *
   * @example
   * const artillery = mod.componentTag("artillery");
   * const tags = mod.feature("component_tags", [artillery]);
   * const weapon = mod.weaponComponentTemplate("artillery_laser", {
   *   icon: "GFX_weapon_artillery_laser",
   *   tags: [artillery],
   * });
   * mod.compile([tags, mod.feature("components", [weapon])]);
   */
  componentTag<const Name extends string>(name: Name): ComponentTagItem<P, Name>;
  /**
   * Creates standalone localization under a key owned by this mod.
   *
   * Keys include the mod prefix by default. Pass `{ prefix: false }` only when
   * Stellaris requires an exact key in the ordinary localization layer.
   *
   * Place the returned item in a feature and use its exact `.key` wherever
   * Stellaris expects a localization key.
   */
  readonly localization: LocalizationMethod<P>;
  /**
   * Deliberately replaces an existing localization key without adding the mod prefix.
   *
   * Use this for free-standing keys that a typed content patch cannot reach,
   * such as event option text. The returned item always emits through the
   * feature's `localisation/replace/` files.
   *
   * A bare string replaces English only. A language record may be partial, so
   * languages it omits keep Vanilla's existing text.
   */
  replaceLocalization<const Key extends string>(
    key: Key,
    text: LocalizationReplacementText
  ): ReplacementLocalizationItem<P, Key>;
} & ContentCapabilityMethods<P, I> &
  MissionCapabilityMethods<P, I> &
  SituationTypeCapabilityMethods<P, I> &
  EventChainCapabilityMethods<P, I>;

function assertLogicalName(name: string): void {
  if (!LOWERCASE_SNAKE_CASE.pattern.test(name)) {
    throw new Error(`Logical content name "${name}" must be ${LOWERCASE_SNAKE_CASE.diagnostic}`);
  }
}

type ExactNameRules = (typeof EXACT_NAME_MINTS)[ExactNameRegistry];

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

/** Generated tables keep registry-specific mint policy out of the shared authoring layer. */
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

function createNestedDefinitionIdAssertion(prefix: string): (id: string) => void {
  return (id) => {
    if (!LOWERCASE_SNAKE_CASE.pattern.test(id)) {
      throw new Error(`Nested definition id "${id}" must be ${LOWERCASE_SNAKE_CASE.diagnostic}`);
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

function createEventHandle<
  P extends string,
  N extends string,
  Id extends number,
  S extends ScopeName,
  Context extends AmbientScopeContext,
  Kind extends string,
>(
  namespace: MintedNamespace<P, N>,
  id: Id,
  kind: EventKindKey,
  scope: S,
  subtype: Kind,
  scopes: Context
): CapabilityEventHandle<P, N, Id, S, Context, Kind> {
  assertEventNumber(id);
  const eventId = `${namespace}.${id}` as MintedEventId<P, N, Id>;
  const define = (
    definition: Omit<EventDef<S, Context>, "id" | "scopes">
  ): GeneratedCapabilityEventItem<P, N, Id, S, Context, Kind> => {
    const localizationEntries: KeyedLocalization[] = [];
    const event = buildEvent(
      kind,
      scope,
      namespace,
      { ...definition, id, scopes } as EventDef<S, Context>,
      { register: (key, translations) => localizationEntries.push({ key, translations }) }
    );
    return {
      ...event,
      id: eventId,
      itemKind: "event",
      namespace,
      locEntries: localizationEntries,
    } as GeneratedCapabilityEventItem<P, N, Id, S, Context, Kind>;
  };
  return Object.freeze({
    kind: "event-ref",
    scope,
    scopes,
    id: eventId,
    define,
  }) as CapabilityEventHandle<P, N, Id, S, Context, Kind>;
}

function createCapabilityEvents<P extends string, N extends string>(
  prefix: P,
  name: N
): CapabilityEvents<P, N> {
  const namespace = mintNamespace(prefix, name);
  assertNamespace(namespace);
  const eventMinter: CapabilityEventMinter<P, N> = {
    namespace,
    handle: (id, kind, scope, subtype, scopes) =>
      createEventHandle(namespace, id, kind, scope, subtype, scopes),
  };
  return capabilityEvents(eventMinter);
}

function belongsToPrefix(value: string, prefix: string): boolean {
  return value.startsWith(`${prefix}_`);
}

function namespaceBelongsToPrefix(namespace: string, prefix: string): boolean {
  return namespace === prefix || belongsToPrefix(namespace, prefix);
}

function assertEventNamespace(namespace: string, prefix: string, itemDescription: string): void {
  if (!namespaceBelongsToPrefix(namespace, prefix)) {
    throw new Error(
      `${itemDescription} namespace "${namespace}" does not belong to mod prefix "${prefix}"`
    );
  }
}

function assertContentOwner(
  item: Extract<ModItem, { readonly itemKind: "content" }>,
  capabilityOwner: CapabilityFeatureOwner<string>
): void {
  const { prefix } = capabilityOwner;
  const shapeMintProvenance = shapeMintOf(item);

  // Shape-minted ids may not contain the prefix, so module-private provenance
  // is the ownership evidence. Public item properties are forgeable.
  if (shapeMintProvenance !== undefined) {
    if (shapeMintProvenance.owner !== capabilityOwner) {
      throw new Error(
        `The ${shapeMintProvenance.shape} sprite "${item.id}" was minted by a different ` +
          `capability — the one for mod prefix "${shapeMintProvenance.owner.prefix}", not ` +
          `this one for "${prefix}". Mint it with the same capability that places it.`
      );
    }
    return;
  }

  // Prefix containment is ambiguous when a name contains several mod prefixes.
  const exactNameOwner = exactNameMintOf(item);
  if (exactNameOwner !== undefined) {
    if (exactNameOwner !== capabilityOwner) {
      throw new Error(
        `The exact-name ${item.type} "${item.id}" was minted by a different capability — ` +
          `the one for mod prefix "${exactNameOwner.prefix}", not this one for "${prefix}". ` +
          "Mint it with the same capability that places it."
      );
    }
    return;
  }

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
}

function assertCapabilityItem(
  item: ModItem,
  capabilityOwner: CapabilityFeatureOwner<string>
): void {
  const { prefix } = capabilityOwner;
  switch (item.itemKind) {
    case "content":
      assertContentOwner(item, capabilityOwner);
      return;
    case "event":
      assertEventNamespace(item.namespace, prefix, "Event");
      return;
    case "on-action":
      item.events?.forEach((event) =>
        assertEventNamespace(event.namespace, prefix, "On-action event")
      );
      item.randomEvents?.forEach(({ event }) => {
        if (isAuthoredEvent(event)) {
          assertEventNamespace(event.namespace, prefix, "On-action random event");
        }
      });
      return;
    case "patch":
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
      // Contributions bind no capability; the fold checks their referenced definitions.
      return;
    case "localization":
      if (item.prefix !== prefix) {
        throw new Error(
          `Localization key "${item.key}" belongs to mod prefix "${item.prefix}", not "${prefix}"`
        );
      }
      return;
    case "asset":
      assertAssetOwner(item, capabilityOwner);
      return;
    case "component-tag":
      assertComponentTagOwner(item, capabilityOwner, prefix);
      return;
  }
}

function assertCapabilityFeature<P extends string>(
  feature: CapabilityFeature<P>,
  capabilityOwner: CapabilityFeatureOwner<P>
): void {
  if (feature[capabilityFeatureOwner] !== capabilityOwner) {
    throw new Error(`Feature does not belong to mod prefix "${capabilityOwner.prefix}"`);
  }
  feature.items.forEach((item) => assertCapabilityItem(item, capabilityOwner));
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
    if (typeof segment !== "string" || !LOWERCASE_SNAKE_CASE.pattern.test(segment)) {
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
  const capabilityOwner: CapabilityFeatureOwner<P> = Object.freeze({
    prefix: config.prefix,
    assetCapability: Symbol("asset capability"),
  });
  const mintId = mintContentId(config.prefix, ids);
  const assertNestedDefinitionId = createNestedDefinitionIdAssertion(config.prefix);
  const contentMethods = contentCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(
    mintId,
    assertNestedDefinitionId,
    config.prefix,
    assertLogicalName,
    capabilityOwner
  );
  const situationTypeMethods = situationTypeCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(
    mintId,
    assertNestedDefinitionId,
    assertLogicalName
  );
  const missionMethods = missionCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(mintId);
  const eventChainMethods = eventChainCapabilityMethods<P, I | typeof DEFAULT_ID_PROFILE>(mintId);

  return Object.freeze({
    config,
    ids,
    ...contentMethods,
    ...missionMethods,
    ...situationTypeMethods,
    ...eventChainMethods,
    namespace: <const N extends string>(name: N = "" as N) =>
      createCapabilityEvents(config.prefix, name),
    assetFile: (input: AssetFileInput) => captureAssetFile(capabilityOwner, input),
    assetTree: (input: AssetTreeInput) => captureAssetTree(capabilityOwner, input),
    feature: <T extends ModItem>(stem: string | undefined, items: readonly T[]) => {
      items.forEach((item) => assertCapabilityItem(item, capabilityOwner));
      return Object.freeze({
        ...createFeature(stem, items),
        [capabilityFeatureOwner]: capabilityOwner,
      }) as CapabilityFeature<P, T>;
    },
    compile: (features: readonly CapabilityFeature<P>[], buildOptions: BuildOptions = {}) => {
      features.forEach((feature) => assertCapabilityFeature(feature, capabilityOwner));
      return buildMod(config, features, buildOptions);
    },
    on,
    componentTag: <const Name extends string>(name: Name) => {
      assertLogicalName(name);
      return createComponentTagItem(capabilityOwner, config.prefix, name);
    },
    localization: localizationFor(config.prefix),
    replaceLocalization: <const Key extends string>(key: Key, text: LocalizationReplacementText) =>
      createReplacementLocalizationItem(config.prefix, key, text),
  }) as ModCapability<P, I | typeof DEFAULT_ID_PROFILE>;
}
