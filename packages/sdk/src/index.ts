export type { PdxEntry, PdxOp, PdxScalar, PdxValue } from "@pdx-ts/pdxscript";
export { block, cmp, kv, list, quoted, scalar } from "@pdx-ts/pdxscript";
export { serialize } from "@pdx-ts/pdxscript";
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
export type { EffectPathMap, EffectPathOf, ScopeMap, ScopeObjOf } from "./generated/effects.ts";
export type { SituationTargetContract } from "./script/effects/situations.ts";
export type { SpecialProjectLocationContract } from "./script/effects/special-projects.ts";
export { EVENT_KINDS, type EventKindKey } from "./generated/events.ts";
export {
  EVENT_FIELD_SUPPORT,
  EVENT_OPTION_FIELD_SUPPORT,
  type GeneratedEventFields,
  type GeneratedEventOptionFields,
} from "./generated/event-fields.ts";
export { onActions } from "./generated/on-actions.ts";
export type { OnActionRef } from "./events/on-actions.ts";
export type { AgendaDef, AgendaFields, DefinedAgenda } from "./generated/agenda.ts";
export type {
  AgreementPresetDef,
  AgreementPresetFields,
  DefinedAgreementPreset,
} from "./generated/agreement-preset.ts";
export type {
  AmbientObjectDef,
  AmbientObjectFields,
  DefinedAmbientObject,
} from "./generated/ambient-object.ts";
export type {
  ArchaeologicalSiteTypeDef,
  ArchaeologicalSiteTypeFields,
  DefinedArchaeologicalSiteType,
} from "./generated/archaeological-site-type.ts";
export type {
  AscensionPerkDef,
  AscensionPerkFields,
  AscensionPerkSwapFields,
  DefinedAscensionPerk,
} from "./generated/ascension-perk.ts";
export type {
  BombardmentStanceDef,
  BombardmentStanceFields,
  DefinedBombardmentStance,
} from "./generated/bombardment-stance.ts";
export type { BuildingDef, BuildingFields, DefinedBuilding } from "./generated/building.ts";
export type {
  CasusBelliDef,
  CasusBelliFields,
  DefinedCasusBelli,
} from "./generated/casus-belli.ts";
export type {
  CivicOrOriginDef,
  CivicOrOriginFields,
  DefinedCivicOrOrigin,
} from "./generated/civic-or-origin.ts";
export type {
  ComponentSetDef,
  ComponentSetFields,
  DefinedComponentSet,
} from "./generated/component-set.ts";
export type { CouncilorDef, CouncilorFields, DefinedCouncilor } from "./generated/councilor.ts";
export type {
  CountryShipOfSizeLimitDef,
  CountryShipOfSizeLimitFields,
  DefinedCountryShipOfSizeLimit,
} from "./generated/country-ship-of-size-limit.ts";
export type {
  DecisionDef,
  DecisionFields,
  DecisionScope,
  DefinedDecision,
} from "./generated/decision.ts";
export type { DefinedEdict, EdictDef, EdictFields } from "./generated/edict.ts";
export type {
  DefinedEventChain,
  EventChainCounterDefinition,
  EventChainDef,
  EventChainFields,
} from "./generated/event-chain.ts";
export type { EventChainCounterOf } from "./content/event-chains.ts";
export type {
  DefinedEconomicCategory,
  EconomicCategoryDef,
  EconomicCategoryFields,
} from "./generated/economic-category.ts";
export type {
  GovernmentTriggerBlock,
  GovernmentTriggerClause,
  GovernmentTriggerClauseGroup,
} from "./generated/government-trigger.ts";
export type {
  DefinedGraphicalCulture,
  GraphicalCultureDef,
  GraphicalCultureFields,
} from "./generated/graphical-culture.ts";
export type {
  DefinedGlobalShipDesign,
  GlobalShipDesignDef,
  GlobalShipDesignFields,
} from "./generated/global-ship-design.ts";
export type { DefinedJob, JobDef, JobFields } from "./generated/job.ts";
export type {
  DefinedMegastructure,
  MegastructureDef,
  MegastructureFields,
} from "./generated/megastructure.ts";
export type {
  DefinedOpinionModifier,
  OpinionModifierDef,
  OpinionModifierFields,
} from "./generated/opinion-modifier.ts";
export type {
  DefinedScriptedLoc,
  ScriptedLocDef,
  ScriptedLocFields,
} from "./generated/scripted-loc.ts";
export type {
  DefinedShipSize,
  ShipSizeDef,
  ShipSizeFields,
  ShipSizeSectionSlots,
} from "./generated/ship-size.ts";
export type {
  DefinedScriptedModifier,
  ScriptedModifierDef,
  ScriptedModifierFields,
} from "./generated/scripted-modifier.ts";
export type {
  DefinedSectionTemplate,
  SectionTemplateDef,
  SectionTemplateFields,
} from "./generated/section-template.ts";
export type {
  DefinedSituationType,
  SituationApproachFields,
  SituationStageFields,
  SituationTypeDef,
  SituationTypeFields,
} from "./generated/situation-type.ts";
// The planet/moon grammar a solar system initializer splices into itself. Both
// interfaces are mutually recursive and neither has a definer of its own: they
// are authored as arrays inside `defineSolarSystemInitializer`.
export type { MoonInitializerFields } from "./generated/moon-initializer.ts";
export type { PlanetInitializerFields } from "./generated/planet-initializer.ts";
export type {
  DefinedSolarSystemInitializer,
  SolarSystemInitializerDef,
  SolarSystemInitializerFields,
} from "./generated/solar-system-initializer.ts";
export type {
  DefinedSpecialProject,
  SpecialProjectDef,
  SpecialProjectFields,
  SpecialProjectLocationScope,
  SpecialProjectRequirements,
  SpecialProjectScope,
  SpecialProjectTriggeredRequirement,
} from "./generated/special-project.ts";
export type {
  DefinedSpeciesClass,
  SpeciesClassDef,
  SpeciesClassFields,
} from "./generated/species-class.ts";
export type {
  DefinedStrikeCraftComponentTemplate,
  StrikeCraftComponentTemplateDef,
  StrikeCraftComponentTemplateFields,
} from "./generated/strike-craft-component-template.ts";
export type {
  DefinedUtilityComponentTemplate,
  UtilityComponentTemplateDef,
  UtilityComponentTemplateFields,
} from "./generated/utility-component-template.ts";
export type {
  DefinedWeaponComponentTemplate,
  WeaponComponentTemplateDef,
  WeaponComponentTemplateFields,
} from "./generated/weapon-component-template.ts";
export type {
  DefinedStarbaseLevel,
  StarbaseLevelDef,
  StarbaseLevelFields,
} from "./generated/starbase-level.ts";
export type {
  DefinedStaticModifier,
  StaticModifierDef,
  StaticModifierFields,
} from "./generated/static-modifier.ts";
export type { DefinedTechnology, TechnologyDef, TechnologyFields } from "./generated/technology.ts";
export type {
  DefinedTraditionCategory,
  TraditionCategoryDef,
  TraditionCategoryFields,
} from "./generated/tradition-category.ts";
export type {
  DefinedTradition,
  TraditionDef,
  TraditionFields,
  TraditionSwapFields,
} from "./generated/tradition.ts";
export type { DefinedWarGoal, WarGoalDef, WarGoalFields } from "./generated/war-goal.ts";
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
  DEFAULT_CONTENT_PATTERN,
  discoverFeatures,
  type DiscoverOptions,
} from "./authoring/discover.ts";
// Generated item unions remain public; their raw constructors are internal
// lowering machinery used by capability methods.
export type * from "./generated/content-definers.ts";
export type { Feature, ModItem, ModItemInput, PlacedItem } from "./authoring/feature.ts";
export type { ContentItem, ContributionItem } from "./content/types.ts";
export type { ModWarning } from "./diagnostics.ts";
export type { OnActionHookItem } from "./events/on-actions.ts";
export type { EventItem, EventItemBase } from "./events/types.ts";
export type { BuildingPatchItem } from "./generated/building.ts";
export type { MegastructurePatchItem } from "./generated/megastructure.ts";
export type { TechnologyPatchItem } from "./generated/technology.ts";
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
  type MaterializationFailure,
  type PathClaimant,
  type PathConflictReason,
  type PathOwnershipConflict,
  type PathProducerKind,
} from "./errors.ts";
export type { PathClaim, PathProducer } from "./compiler/paths.ts";
export { compareLogicalPaths, normalizeLogicalPath, type LogicalPath } from "./ordering.ts";
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
  VanillaView,
  viewFromFiles,
  type AnyOf,
  type ParsedBuilding,
  type ParsedMegastructure,
  type ParsedNumber,
  type ParsedRegistries,
  type ParsedRegistryName,
  type Prerequisite,
  type VanillaFile,
} from "./stellaris/vanilla/view.ts";
export type { BuildingPatch, PatchedBuilding } from "./generated/building.ts";
export type { MegastructurePatch, PatchedMegastructure } from "./generated/megastructure.ts";
export type { PatchedTechnology, TechnologyPatch } from "./generated/technology.ts";
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
