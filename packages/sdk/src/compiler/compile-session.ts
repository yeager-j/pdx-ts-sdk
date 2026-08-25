import type { AssetFileItem } from "../authoring/assets.ts";
import {
  flattenItems,
  type Feature,
  type ModItem,
  type ModItemInput,
  type PlacedItem,
} from "../authoring/feature.ts";
import type { ModWarning } from "../diagnostics.ts";
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
  collectFeatureInputs(features, compiledFeatures);
  compiledFeatures.sort((left, right) => {
    if (left.stem === undefined) return right.stem === undefined ? 0 : -1;
    if (right.stem === undefined) return 1;
    return compareUtf8(left.stem, right.stem);
  });
  const vanilla = options.vanilla;
  return Object.freeze({
    features: Object.freeze(
      compiledFeatures.map((feature) =>
        Object.freeze({ ...feature, itemIds: Object.freeze(feature.itemIds) })
      )
    ),
    vanilla: Object.freeze({
      loadedView: vanilla !== undefined,
      gameVersion: vanilla?.gameVersion,
      pathInventory: vanilla?.pathInventory !== undefined,
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
      itemIds: feature.items.flatMap((item) => {
        const id = authoredItemId(item);
        return id === undefined ? [] : [id];
      }),
    });
  }
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
