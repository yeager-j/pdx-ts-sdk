export type { PdxEntry, PdxOp, PdxScalar, PdxValue } from "@pdx-ts/pdxscript";
export { block, cmp, kv, list, quoted, scalar } from "@pdx-ts/pdxscript";
export { serialize } from "@pdx-ts/pdxscript";
export {
  absoluteOrbits,
  asteroidBelt,
  type AbsoluteMoonOrbit,
  type AbsolutePlanetOrbit,
  type AsteroidBelt,
  type AsteroidBeltInput,
} from "./solar-system-layout.ts";
export type { ScopeName } from "./generated/scopes.ts";
export * from "./generated/enums.ts";
export { refId, type TypedRef } from "./script/scalar.ts";
export * from "./generated/refs.ts";
export * from "./generated/value-sets.ts";
export {
  MODIFIER_OPERATIONS,
  MODIFIER_OPERATION_POLICY,
  type ModifierOperationFields,
  type ModifierOperationMember,
} from "./generated/modifier-policy.ts";
export { STRUCTURAL_EFFECT_KEYS, type StructuralEffectKey } from "./generated/effect-policy.ts";
export * from "./script/triggers.ts";
export { scopeLinkOutput } from "./script/links.ts";
export {
  eventTarget,
  isEffectKey,
  isEventFireKey,
  makeScope,
  recordEffects,
} from "./script/effects/recorder.ts";
export type {
  ComplexTriggerModifier,
  ComplexTriggerModifierMode,
  ComplexTriggerModifierWithLoc,
  EffectPath,
  IfChain,
  Modifier,
  ModifierWithLoc,
  RandomListArm,
  EventTarget,
  ScopeRef,
  ScopeValue,
  ScriptCtx,
  StructuralEffects,
  UndeclaredFrom,
  UndeclaredRoot,
} from "./script/effects/types.ts";
export type {
  EffectPathMap,
  EffectPathOf,
  FleetAction,
  ScopeMap,
  ScopeObjOf,
} from "./generated/effects.ts";
export type { SituationTargetContract } from "./script/effects/situations.ts";
export type { SpecialProjectLocationContract } from "./script/effects/special-projects.ts";
export type { StaticModifierHostContract } from "./script/effects/static-modifiers.ts";
export { EVENT_KINDS, type EventKindKey } from "./generated/events.ts";
export {
  EVENT_FIELD_SUPPORT,
  EVENT_OPTION_FIELD_SUPPORT,
  type GeneratedEventFields,
  type GeneratedEventOptionFields,
} from "./generated/event-fields.ts";
export { onActions } from "./generated/on-actions.ts";
export type { OnActionRef } from "./events/on-actions.ts";
// Every content type an author can name. Derived from the generation tables;
// `codegen-cwt/src/policy/public-surface.ts` is the only door for the rest.
export type * from "./generated/content-public.ts";
export type { EventChainCounterOf } from "./content/event-chains.ts";
export type {
  DefinedEvent,
  EventDef,
  EventOption,
  EventRef,
  EventTriggeredDescription,
  FireEventArgs,
  WitnessedFireEventArgs,
} from "./events/types.ts";
export type {
  CustomModifiers,
  EconomicCategoryWitness,
  EconomicResourceBlock,
  EconomicResourceBlockNoProduce,
  EconomicResourceOperation,
  EffectBlock,
  ModifierBlock,
  ModifierClosure,
  ScaledModifier,
  ScaledModifierCalc,
  TriggeredDescription,
  TriggeredModifier,
  WeightBlock,
  WeightBlockOperations,
  WeightBlockRow,
  WeightBlockWithLoc,
  WeightBlockWithLocOperations,
  WithFrom,
} from "./content/types.ts";
export type { EconomicCategoryItem, ScriptedModifierItem } from "./generated/content-definers.ts";
export type { DefinedContent } from "./content/authoring.ts";
export type {
  ModifierBlockByScope,
  ModifierRecorderByScope,
  ModifierSetter,
  ScopedModifierBlock,
  ScopedModifierRecorder,
  UniversalModifiers,
  UnscopedModifierRecorder,
} from "./generated/modifiers.ts";
export type { BuildOptions, ModConfig } from "./compiler/config.ts";
export type { EmittedFile, LocalizationFile, PureMod } from "./compiler/model.ts";
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
export type { AssetFileInput, AssetFileItem, AssetTreeInput } from "./authoring/assets.ts";
export {
  LOCALIZATION_LANGUAGES,
  type LocalizationItem,
  type LocalizationLanguage,
  type LocalizationText,
  type LocalizationTranslations,
  type MintedLocalizationKey,
  type ReplacementLocalizationItem,
} from "./authoring/localization.ts";
export { install, replaceInstallation, type InstallOptions } from "./output/install.ts";
export { render } from "./output/render.ts";
export { renderLauncherDescriptor } from "./output/render.ts";
export type { RenderedFile, RenderedMod } from "./output/rendered.ts";
export type { MaterializationReceipt } from "./output/receipt.ts";
export {
  replaceMaterialization,
  write,
  type CleanupWarning,
  type ForeignReportEntry,
  type InstallReport,
  type MaterializationReport,
  type WriteReport,
} from "./output/write.ts";
export {
  recoverInstallation,
  recoverMaterialization,
  type RecoverInstallationOptions,
  type RecoveryAction,
  type RecoveryReport,
} from "./output/recover.ts";
export type { MaterializationPhase } from "./output/journal.ts";
export {
  DEFAULT_CONTENT_PATTERN,
  discoverFeatures,
  type DiscoverOptions,
} from "./authoring/discover.ts";
// Generated item unions remain public; their raw constructors are internal
// lowering machinery used by capability methods.
export type * from "./generated/content-definers.ts";
export type { Feature, ModItem, ModItemInput, PlacedItem } from "./authoring/feature.ts";
export type { ContentItem, ContributionItem, MintProvenance } from "./content/types.ts";
export type { ModWarning } from "./diagnostics.ts";
export type {
  OnActionEvents,
  OnActionHookItem,
  OnActionRandomEvent,
  ScopelessOnActionEvents,
} from "./events/on-actions.ts";
export type { EventItem, EventItemBase } from "./events/types.ts";
export * as stellaris from "./stellaris/index.ts";
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
export type { PathClaim, PathProducer } from "./compiler/paths.ts";
export {
  compareLogicalPaths,
  compareUtf8,
  normalizeLogicalPath,
  type LogicalPath,
} from "./ordering.ts";
export {
  REGISTRY_RULES,
  SUPPORTED_STELLARIS_BUILD,
  type ManifestRegistryRow,
  type RegistryRow,
  type ResolvedRegistryRow,
  type StandaloneRegistry,
  type StandaloneRegistryRow,
} from "./stellaris/vanilla/override-rules.ts";
export type { PatchPlan, WinAssertion } from "./stellaris/vanilla/override-plan.ts";
export {
  anyOf,
  ParsedDefinition,
  ParsedTechnology,
  type AnyOf,
  type ParsedBuilding,
  type ParsedMegastructure,
  type ParsedNumber,
  type ParsedRegistries,
  type ParsedRegistryName,
  type Prerequisite,
  type VanillaFile,
} from "./stellaris/vanilla/parsed-definitions.ts";
export { VanillaView, viewFromFiles } from "./stellaris/vanilla/view.ts";
export type {
  CheckedVanillaId,
  InvalidVanillaId,
  VanillaEnumMember,
  VanillaId,
  VanillaRegistry,
  VanillaTrie,
} from "./identifiers/contracts.ts";
export {
  stampedVanillaPackageVersion,
  vanillaPackageGameVersion,
  vanillaPackageInstallRange,
} from "./identifiers/version-scheme.ts";
export {
  scriptedEffect,
  scriptedTrigger,
  scriptedTriggerModifier,
  type AssertedScope,
  type ScopeAssertion,
  type ScopeClaim,
  type ScriptedArgs,
  type ScriptedEffectBinding,
  type ScriptedEffectCall,
  type ScriptedEffectName,
  type ScriptedParams,
  type ScriptedParamValue,
  type ScriptedTriggerArgs,
  type ScriptedTriggerBinding,
  type ScriptedTriggerName,
} from "./script/scripted.ts";
export * as vanilla from "./generated/vanilla-refs.ts";
