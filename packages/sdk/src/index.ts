/**
 * The pipeline — configure, build, materialize.
 *
 * This entry point carries what a build script calls: `createModProject`,
 * `createMod`, `render`, `write`, `install`, the terminal
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
  type FeaturesInput,
  type FeaturesModule,
  type IdProfile,
  type MintedContentId,
  type ModCapability,
} from "./authoring/mod.ts";
export type { FeatureItemsInput, ItemBag } from "./authoring/bag.ts";
export {
  createModProject,
  type CreateModProjectOptions,
  type ModProject,
  type ModProjectManifest,
  type ProjectModConfig,
} from "./project.ts";
export type { Feature, ModItem, ModItemInput, PlacedItem } from "./authoring/feature.ts";
export type { AssetFileInput, AssetFileItem, AssetTreeInput } from "./authoring/assets.ts";
export type { ComponentTagItem } from "./authoring/component-tags.ts";
export {
  literalText,
  loc,
  LOCALIZATION_LANGUAGES,
  type LiteralText,
  type LocalizationInput,
  type LocalizationItem,
  type LocalizationLanguage,
  type LocalizationRef,
  type LocalizationRefs,
  type LocalizationReplacementText,
  type LocalizationReplacements,
  type LocalizationText,
  type LocalizationTranslations,
  type LocalizedText,
  type LocalizedTextRecord,
  type LocInterpolation,
  type MintedLocalizationKey,
  type NoLocalizationRefs,
  type ReplacementLocalizationItem,
} from "./authoring/localization.ts";
export { external, type ExternalReference } from "./authoring/external.ts";
export {
  DESCRIPTOR_VALUE_PATTERN,
  MOD_PREFIX_PATTERN,
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type ResolvedModConfig,
} from "./compiler/config.ts";
export type {
  CompiledFeatureInput,
  CompiledVanillaInput,
  CompileInputs,
  ComponentTagFile,
  EmittedFile,
  LocalizationFile,
  PureMod,
} from "./compiler/model.ts";
export type { ContentHandle, ContentHandleBase } from "./content/handle.ts";
export type {
  CrisisCurrencyLocalization,
  CrisisCurrencyRole,
} from "./content/localization-families.ts";
export type {
  ContentItem,
  ContributionItem,
  DistributiveOmit,
  MintProvenance,
} from "./content/types.ts";
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
export { runInspect, type RunInspectOptions } from "./inspect.ts";
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
  ProjectManifestError,
  StaleRuleTableError,
  SwapPatchError,
  UnverifiedRegistryError,
  VanillaPackageMismatchError,
  VanillaPackageUnreadableError,
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
