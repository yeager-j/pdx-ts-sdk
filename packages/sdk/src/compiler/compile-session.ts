import type { AssetFileItem } from "../authoring/assets.ts";
import { flattenItems, type ModItemInput, type PlacedItem } from "../authoring/feature.ts";
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
import type { ReferenceUse } from "./references.ts";

export interface PlacedAsset {
  readonly item: AssetFileItem;
  readonly stem: string | undefined;
}

export interface AssetPathReference {
  readonly owner: string;
  readonly use: AssetPathUse;
}

/** Mutable state whose lifetime is one private `buildMod` fold. */
export interface BuildSession {
  readonly config: ResolvedModConfig;
  readonly options: BuildOptions;
  readonly flat: readonly PlacedItem[];
  readonly assets: readonly PlacedAsset[];
  readonly warnings: ModWarning[];
  readonly localization: LocalizationAccumulator;
  readonly refUses: ReferenceUse[];
  readonly pathUses: AssetPathReference[];
  readonly stemsByPath: Map<LogicalPath, Set<string>>;
}

/** Creates the build-local accumulators shared by the explicit compiler phases. */
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
    flat,
    assets,
    warnings,
    localization: createLocalizationAccumulator(warnings),
    refUses: [],
    pathUses: [],
    stemsByPath: new Map(),
  };
}

/** Records which named Features placed items into an emitted file. */
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

/** Returns the canonical Feature stem list for an emitted file. */
export function stemsOf(session: BuildSession, relPath: LogicalPath): readonly string[] {
  return [...(session.stemsByPath.get(relPath) ?? [])].sort(compareUtf8);
}
