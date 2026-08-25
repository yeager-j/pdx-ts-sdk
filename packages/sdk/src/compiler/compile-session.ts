import type { AssetFileItem } from "../authoring/assets.ts";
import {
  flattenItems,
  type Feature,
  type ModItem,
  type ModItemInput,
  type PlacedItem,
} from "../authoring/feature.ts";
import type { ModWarning } from "../diagnostics.ts";
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

/** An asset item together with its optional source Feature stem. */
export interface PlacedAsset {
  /** The asset definition to emit. */
  readonly item: AssetFileItem;
  /** The source Feature stem, when the asset came from a named Feature. */
  readonly stem: string | undefined;
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
  /** All input items, with their placement metadata. */
  readonly flat: readonly PlacedItem[];
  /** Asset items, ordered by their logical paths. */
  readonly assets: readonly PlacedAsset[];
  /** Diagnostics collected during the build. */
  readonly warnings: ModWarning[];
  /** Localization entries collected during the build. */
  readonly localization: LocalizationAccumulator;
  /** Content references collected during the build. */
  readonly refUses: ReferenceUse[];
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
  const flat = flattenItems(features);
  const assets = flat
    .filter((placed): placed is PlacedAsset => placed.item.itemKind === "asset")
    .sort((a, b) => compareUtf8(a.item.path, b.item.path));
  const warnings: ModWarning[] = [];

  return {
    config,
    options,
    compileInputs: summarizeCompileInputs(features, options),
    flat,
    assets,
    warnings,
    localization: createLocalizationAccumulator(warnings),
    refUses: [],
    pathUses: [],
    stemsByPath: new Map(),
  };
}

function summarizeCompileInputs(
  features: readonly ModItemInput[],
  options: BuildOptions
): CompileInputs {
  const compiledFeatures: CompiledFeatureInput[] = [];
  const vanillaOrigins = new Set<VanillaView>();
  if (options.vanilla !== undefined) {
    vanillaOrigins.add(options.vanilla);
  }
  collectFeatureInputs(features, compiledFeatures, vanillaOrigins);
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
  compiledFeatures: CompiledFeatureInput[],
  vanillaOrigins: Set<VanillaView>
): void {
  for (const input of inputs) {
    if (Array.isArray(input)) {
      collectFeatureInputs(input, compiledFeatures, vanillaOrigins);
      continue;
    }
    const feature = input as Feature;
    for (const item of feature.items) {
      if (item.itemKind === "patch") {
        vanillaOrigins.add(item.patched.source.origin);
      }
    }
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
