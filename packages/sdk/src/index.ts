export type { PdxEntry, PdxOp, PdxScalar, PdxValue } from "@pdx-ts/pdxscript";
export { block, cmp, kv, list, quoted, scalar } from "@pdx-ts/pdxscript";
export { serialize } from "@pdx-ts/pdxscript";
export type { ScopeName } from "./generated/scopes.ts";
export * from "./generated/enums.ts";
export { refId, type TypedRef } from "./generated/refs.ts";
export * from "./generated/refs.ts";
export * from "./generated/value-sets.ts";
export * from "./triggers.ts";
export {
  eventTarget,
  makeScope,
  type EventTarget,
  type IfChain,
  type Modifier,
  type ModifierWithLoc,
  type RandomListArm,
  type ScopeRef,
  type StructuralEffects,
} from "./effect-core.ts";
export type { ScopeMap, ScopeObjOf } from "./generated/effects.ts";
export type { SituationTargetContract } from "./situations.ts";
export { EVENT_KINDS, type EventKindKey } from "./generated/events.ts";
export { onActions } from "./generated/on-actions.ts";
export type { OnActionRef } from "./on-actions.ts";
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
  EventCtx,
  EventDef,
  EventOption,
  EventRef,
  FireEventArgs,
  UndeclaredFrom,
  WitnessedFireEventArgs,
} from "./events.ts";
export type {
  CustomModifiers,
  DefinedContent,
  EconomicResourceBlock,
  EconomicResourceOperation,
  EffectBlock,
  ModifierBlock,
  ModifierClosure,
  TriggeredModifier,
  WeightBlock,
  WeightBlockWithLoc,
} from "./content.ts";
export type {
  ModifierBlockByScope,
  ModifierRecorderByScope,
  ModifierSetter,
  ScopedModifierBlock,
  ScopedModifierRecorder,
  UniversalModifiers,
  UnscopedModifierRecorder,
} from "./generated/modifiers.ts";
export {
  buildMod,
  type BuildOptions,
  type EmittedFile,
  type ModConfig,
  type PureMod,
} from "./build.ts";
export {
  install,
  render,
  renderLauncherDescriptor,
  write,
  type InstallOptions,
  type InstallResult,
} from "./render.ts";
export { DEFAULT_CONTENT_PATTERN, discoverContent, type DiscoverOptions } from "./discover.ts";
// One free definer per content registry — `defineTechnology`,
// `defineAscensionPerk`, ... — plus `patchTechnology`, `addShipOfSizeLimits`,
// and every registry's `XItem` union.
export * from "./generated/content-definers.ts";
export { namespace, type EventNamespace } from "./generated/event-definers.ts";
export { on } from "./definers.ts";
export {
  assertFileStem,
  assertNamespace,
  collection,
  flattenItems,
  FILE_STEM_PATTERN,
  type Collection,
  type ContentItem,
  type ContributionItem,
  type EventItem,
  type EventItemBase,
  type ModItem,
  type ModItemInput,
  type ModWarning,
  type OnActionBindingItem,
  type PlacedItem,
  type TechnologyPatchItem,
} from "./items.ts";
export * as stellaris from "./stellaris/index.ts";
export {
  InstallNotFoundError,
  LogicalPathError,
  NoWinningFilenameError,
  PdxSdkError,
  StaleRuleTableError,
  SwapPatchError,
  UnverifiedRegistryError,
  VanillaPackageMismatchError,
  VanillaPathCollisionError,
} from "./errors.ts";
export {
  compareLogicalPaths,
  normalizeLogicalPath,
  type LogicalPath,
} from "./resolver/path-order.ts";
export { REGISTRY_RULES, SUPPORTED_STELLARIS_BUILD, type RegistryRow } from "./resolver/rules.ts";
export type { PatchPlan, WinAssertion } from "./resolver/plan.ts";
export {
  anyOf,
  ParsedTechnology,
  VanillaView,
  viewFromFiles,
  type AnyOf,
  type ParsedNumber,
  type Prerequisite,
  type VanillaFile,
} from "./vanilla/surface.ts";
export type { PatchedTechnology, TechnologyPatch } from "./vanilla/patch.ts";
export type {
  CheckedVanillaId,
  InvalidVanillaId,
  VanillaId,
  VanillaIds,
  VanillaScriptedEffects,
  VanillaScriptedTriggers,
  VanillaTrie,
  VanillaTries,
} from "./vanilla-ids.ts";
export * as vanilla from "./generated/vanilla-refs.ts";
