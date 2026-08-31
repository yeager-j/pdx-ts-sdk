import type { AssetFileItem } from "../authoring/assets.ts";
import type { ComponentTagItem } from "../authoring/component-tags.ts";
import {
  flattenItems,
  refuseUnknownItemKind,
  type Feature,
  type ModItem,
  type ModItemInput,
  type PlacedItem,
} from "../authoring/feature.ts";
import type { LocalizationItem, ReplacementLocalizationItem } from "../authoring/localization.ts";
import type { LocalizationRoleUse } from "../content/localization-families.ts";
import type { ContentItem, ContributionItem } from "../content/types.ts";
import type { ModWarning } from "../diagnostics.ts";
import type { OnActionHookItem } from "../events/on-actions.ts";
import type { EventItemBase } from "../events/types.ts";
import type { ContentPatchItem } from "../installation/vanilla/patch.ts";
import type { VanillaView } from "../installation/vanilla/view.ts";
import { compareUtf8, type LogicalPath } from "../ordering.ts";
import type { AssetPathUse } from "../references.ts";
import {
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type ResolvedModConfig,
} from "./config.ts";
import { createLocalizationAccumulator, type LocalizationAccumulator } from "./localization.ts";
import type { CompiledFeatureInput, CompileInputs } from "./model.ts";
import type { ReferenceUse } from "./references.ts";

/** The two authored layers that share the `localization` item kind. */
type PlacedLocalization = LocalizationItem<string, string, boolean> | ReplacementLocalizationItem;

/**
 * Every placed item, split once by the `itemKind` that decides which compiler
 * phase compiles it (SDK-326).
 *
 * The fold reads its input through these buckets rather than re-filtering the
 * flat list per phase, so the choice of phase is made in one place. That is
 * also what makes an unclaimed kind visible: filtering per phase drops it from
 * every phase in turn and ships a mod quietly missing it, while the partition
 * has nowhere to put it and says so.
 */
export interface PlacedItems {
  readonly content: readonly PlacedItem<ContentItem>[];
  readonly event: readonly PlacedItem<EventItemBase>[];
  readonly onAction: readonly PlacedItem<OnActionHookItem>[];
  readonly patch: readonly PlacedItem<ContentPatchItem>[];
  readonly contribution: readonly PlacedItem<ContributionItem>[];
  readonly localization: readonly PlacedItem<PlacedLocalization>[];
  readonly asset: readonly PlacedItem<AssetFileItem>[];
  readonly componentTag: readonly PlacedItem<ComponentTagItem>[];
}

/** The mutable form the partition is filled in, before it is handed out. */
type PlacedItemBuckets = { -readonly [K in keyof PlacedItems]: PlacedItems[K][number][] };

/** Splits placed items by kind, refusing any kind no phase claims. */
function partitionPlacedItems(flat: readonly PlacedItem[]): PlacedItems {
  const buckets: PlacedItemBuckets = {
    content: [],
    event: [],
    onAction: [],
    patch: [],
    contribution: [],
    localization: [],
    asset: [],
    componentTag: [],
  };
  for (const { item, stem } of flat) {
    switch (item.itemKind) {
      case "content":
        buckets.content.push({ item, stem });
        break;
      case "event":
        buckets.event.push({ item, stem });
        break;
      case "on-action":
        buckets.onAction.push({ item, stem });
        break;
      case "patch":
        buckets.patch.push({ item, stem });
        break;
      case "contribution":
        buckets.contribution.push({ item, stem });
        break;
      case "localization":
        buckets.localization.push({ item, stem });
        break;
      case "asset":
        buckets.asset.push({ item, stem });
        break;
      case "component-tag":
        buckets.componentTag.push({ item, stem });
        break;
      default:
        refuseUnknownItemKind(item);
    }
  }
  return buckets;
}

/** An asset path reference recorded while compiling an emitted file. */
export interface AssetPathReference {
  /** The emitted file that owns the reference. */
  readonly owner: string;
  /** The referenced asset path and its use site. */
  readonly use: AssetPathUse;
}

/** Mutable state whose lifetime is one private `buildMod` fold. */
export interface BuildSession {
  /** The fully resolved mod configuration. */
  readonly config: ResolvedModConfig;
  /** Options that control this build. */
  readonly options: BuildOptions;
  /** Canonical input provenance retained on the compiled mod. */
  readonly compileInputs: CompileInputs;
  /** All input items, with their placement metadata, split once by kind. */
  readonly items: PlacedItems;
  /** Asset items, ordered by their logical paths. */
  readonly assets: readonly PlacedItem<AssetFileItem>[];
  /** Diagnostics collected during the build. */
  readonly warnings: ModWarning[];
  /** Localization entries collected during the build. */
  readonly localization: LocalizationAccumulator;
  /** Content references collected during the build. */
  readonly refUses: ReferenceUse[];
  /** Localization roles collected during the build, checked against defined ids. */
  readonly roleUses: LocalizationRoleUse[];
  /** Asset path references collected during the build. */
  readonly pathUses: AssetPathReference[];
  /** Source Feature stems grouped by emitted file path. */
  readonly stemsByPath: Map<LogicalPath, Set<string>>;
}

/** Creates the build-local state shared by the explicit compiler phases. */
export function createBuildSession(
  callerConfig: ModConfig | ResolvedModConfig,
  features: readonly ModItemInput[],
  options: BuildOptions
): BuildSession {
  const config = resolveConfig(callerConfig);
  const items = partitionPlacedItems(flattenItems(features));
  const assets = [...items.asset].sort((a, b) => compareUtf8(a.item.path, b.item.path));
  const warnings: ModWarning[] = [];

  return {
    config,
    options,
    compileInputs: summarizeCompileInputs(features, options, items.patch),
    items,
    assets,
    warnings,
    localization: createLocalizationAccumulator(warnings),
    refUses: [],
    roleUses: [],
    pathUses: [],
    stemsByPath: new Map(),
  };
}

function summarizeCompileInputs(
  features: readonly ModItemInput[],
  options: BuildOptions,
  patches: readonly PlacedItem<ContentPatchItem>[]
): CompileInputs {
  const compiledFeatures: CompiledFeatureInput[] = [];
  const vanillaOrigins = new Set<VanillaView>();
  if (options.vanilla !== undefined) {
    vanillaOrigins.add(options.vanilla);
  }
  for (const { item } of patches) {
    vanillaOrigins.add(item.patched.source.origin);
  }
  collectFeatureInputs(features, compiledFeatures);
  compiledFeatures.sort(compareCompiledFeatures);
  const knownGameVersions = [
    ...new Set(
      [...vanillaOrigins].flatMap((origin) =>
        origin.gameVersion === undefined ? [] : [origin.gameVersion]
      )
    ),
  ].sort(compareUtf8);
  return Object.freeze({
    features: Object.freeze(
      compiledFeatures.map((feature) =>
        Object.freeze({ ...feature, itemIds: Object.freeze(feature.itemIds) })
      )
    ),
    vanilla: Object.freeze({
      loadedView: vanillaOrigins.size > 0,
      gameVersion: knownGameVersions.length === 1 ? knownGameVersions[0] : undefined,
      pathInventory: [...vanillaOrigins].some((origin) => origin.pathInventory !== undefined),
    }),
  });
}

function collectFeatureInputs(
  inputs: readonly ModItemInput[],
  compiledFeatures: CompiledFeatureInput[]
): void {
  for (const input of inputs) {
    if (Array.isArray(input)) {
      collectFeatureInputs(input, compiledFeatures);
      continue;
    }
    const feature = input as Feature;
    compiledFeatures.push({
      stem: feature.stem,
      itemCount: feature.items.length,
      itemIds: feature.items
        .flatMap((item) => {
          const id = authoredItemId(item);
          return id === undefined ? [] : [id];
        })
        .sort(compareUtf8),
    });
  }
}

function compareCompiledFeatures(left: CompiledFeatureInput, right: CompiledFeatureInput): number {
  if (left.stem === undefined && right.stem !== undefined) return -1;
  if (left.stem !== undefined && right.stem === undefined) return 1;
  const stemOrder = compareUtf8(left.stem ?? "", right.stem ?? "");
  if (stemOrder !== 0) return stemOrder;

  const sharedIds = Math.min(left.itemIds.length, right.itemIds.length);
  for (let index = 0; index < sharedIds; index++) {
    const idOrder = compareUtf8(left.itemIds[index]!, right.itemIds[index]!);
    if (idOrder !== 0) return idOrder;
  }
  return left.itemIds.length - right.itemIds.length || left.itemCount - right.itemCount;
}

function authoredItemId(item: ModItem): string | undefined {
  switch (item.itemKind) {
    case "content":
    case "event":
    case "component-tag":
      return item.id;
    case "asset":
    case "contribution":
    case "localization":
    case "on-action":
    case "patch":
      return undefined;
  }
}

/** Records a named Feature that placed an item into an emitted file. */
export function noteStem(
  session: BuildSession,
  relPath: LogicalPath,
  stem: string | undefined
): void {
  const stems = session.stemsByPath.get(relPath) ?? new Set<string>();
  if (stem !== undefined) {
    stems.add(stem);
  }
  session.stemsByPath.set(relPath, stems);
}

/** Returns the sorted source Feature stems for an emitted file. */
export function stemsOf(session: BuildSession, relPath: LogicalPath): readonly string[] {
  return [...(session.stemsByPath.get(relPath) ?? [])].sort(compareUtf8);
}
