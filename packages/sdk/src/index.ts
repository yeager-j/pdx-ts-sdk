/**
 * The pipeline — configure, discover, build, materialize.
 *
 * This entry point carries what a build script calls: `createModProject`,
 * `createMod`, `discoverFeatures`, `render`, `write`, `install`, the terminal
 * helpers, and the error classes those steps throw. The game vocabulary an
 * author types inside defs and expressions lives at `@pdx-ts/sdk/stellaris`;
 * the installed game at `@pdx-ts/sdk/installation`; machine-readable SDK facts
 * at `@pdx-ts/sdk/reference`; unstable machinery at `@pdx-ts/sdk/internals`.
 * See docs/adr/0007.
 */
export {
  createMod,
  type CapabilityEventHandle,
  type CapabilityEventItem,
  type CapabilityEvents,
  type CapabilityFeature,
  type IdProfile,
  type MintedContentId,
  type ModCapability,
} from "./authoring/mod.ts";
export {
  DEFAULT_CONTENT_PATTERN,
  discoverFeatures,
  type DiscoverOptions,
} from "./authoring/discover.ts";
export {
  createModProject,
  type CreateModProjectOptions,
  type ModProject,
  type ModProjectBuildOptions,
  type ModProjectManifest,
  type ProjectModConfig,
} from "./project.ts";
export type { Feature, ModItem, ModItemInput, PlacedItem } from "./authoring/feature.ts";
export type { AssetFileInput, AssetFileItem, AssetTreeInput } from "./authoring/assets.ts";
export type { ComponentTagItem } from "./authoring/component-tags.ts";
export {
  LOCALIZATION_LANGUAGES,
  type LocalizationItem,
  type LocalizationLanguage,
  type LocalizationText,
  type LocalizationTranslations,
  type MintedLocalizationKey,
  type ReplacementLocalizationItem,
} from "./authoring/localization.ts";
export type { BuildOptions, ModConfig } from "./compiler/config.ts";
export type { ComponentTagFile, EmittedFile, LocalizationFile, PureMod } from "./compiler/model.ts";
export type { ContentItem, ContributionItem, MintProvenance } from "./content/types.ts";
export type { ModWarning } from "./diagnostics.ts";
export { render } from "./output/render.ts";
export type { RenderedFile, RenderedMod } from "./output/rendered.ts";
export {
  write,
  type CleanupWarning,
  type ForeignReportEntry,
  type InstallReport,
  type MaterializationReport,
  type WriteReport,
} from "./output/write.ts";
export { install, type InstallOptions } from "./output/install.ts";
export type { MaterializationReceipt } from "./output/receipt.ts";
export {
  runBuild,
  runInstall,
  type RunBuildOptions,
  type RunInstallOptions,
  type TerminalRunOptions,
} from "./terminal.ts";
export {
  inspectSolarSystem,
  type InspectSolarSystemOptions,
  type SolarSystemDiagnostic,
  type SolarSystemDiagnosticCode,
  type SolarSystemInspection,
} from "./solar-system-inspect/inspect.ts";
export { inspectSolarSystems } from "./solar-system-inspect/inspect-mod.ts";
export {
  writeSystemPreviews,
  type SystemPreview,
  type SystemPreviewReport,
} from "./output/system-previews.ts";
export {
  GameVersionError,
  InstallNotFoundError,
  LogicalPathError,
  MaterializationError,
  NoWinningFilenameError,
  PathOwnershipError,
  PdxSdkError,
  StaleRuleTableError,
  SwapPatchError,
  UnverifiedRegistryError,
  VanillaPackageMismatchError,
  VanillaPathCollisionError,
  VanillaPathInventoryError,
  type ForeignClaimConflict,
  type ForeignRefusedEntry,
  type MaterializationDrift,
  type MaterializationDriftKind,
  type MaterializationEvidence,
  type MaterializationFailure,
  type MaterializationLockHolder,
  type PathClaimant,
  type PathConflictReason,
  type PathOwnershipConflict,
  type PathProducerKind,
} from "./errors.ts";
