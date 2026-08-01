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
  type RandomListArm,
  type ScopeRef,
  type StructuralEffects,
} from "./effect-core.ts";
export type { ScopeMap, ScopeObjOf } from "./generated/effects.ts";
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
export type { DecisionDef, DecisionFields, DefinedDecision } from "./generated/decision.ts";
export type { DefinedEdict, EdictDef, EdictFields } from "./generated/edict.ts";
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
  DefinedScriptedModifier,
  ScriptedModifierDef,
  ScriptedModifierFields,
} from "./generated/scripted-modifier.ts";
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
export type { ModConfig, PrefixedId } from "./mod.ts";
export { Mod } from "./mod.ts";
export * as stellaris from "./stellaris/index.ts";
export {
  InstallNotFoundError,
  LogicalPathError,
  NoWinningFilenameError,
  PdxSdkError,
  StaleRuleTableError,
  SwapPatchError,
  UnverifiedRegistryError,
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
