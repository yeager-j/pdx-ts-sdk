/**
 * The game vocabulary — everything an author types inside defs, trigger
 * expressions, and effect closures: combinators, generated triggers and
 * scope links, value-set factories, branded refs and enums, content types,
 * event types, and the `vanilla` reference builders.
 *
 * The root entry point carries the pipeline (`createMod`, `discoverFeatures`,
 * `render`, `write`, `install`); this module carries the language those
 * builds are written in. See docs/adr/0007.
 */
export type { PdxEntry, PdxOp, PdxScalar, PdxValue } from "@pdx-ts/pdxscript";
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
export * from "./script/triggers.ts";
export { eventTarget } from "./script/effects/recorder.ts";
export type {
  AmbientScopeAt,
  AmbientScopeContext,
  AmbientScopeKey,
  ComplexTriggerModifier,
  ComplexTriggerModifierMode,
  ComplexTriggerModifierWithLoc,
  EffectPath,
  EventTarget,
  IfChain,
  Modifier,
  ModifierWithLoc,
  RandomListArm,
  ScopeRef,
  ScopeValue,
  ScriptCtx,
  StructuralEffects,
  UndeclaredAmbientScope,
} from "./script/effects/types.ts";
export type {
  EffectPathMap,
  EffectPathOf,
  FleetAction,
  ScopeMap,
  ScopeObjOf,
} from "./generated/effects.ts";
export type { SituationTargetContract } from "./script/effects/situations.ts";
export type { MissionLocationContract } from "./script/effects/missions.ts";
export type { SpecialProjectLocationContract } from "./script/effects/special-projects.ts";
export type { StaticModifierHostContract } from "./script/effects/static-modifiers.ts";
export { onActions } from "./generated/on-actions.ts";
export type {
  OnActionEvents,
  OnActionHookItem,
  OnActionRandomEvent,
  OnActionRef,
  ScopelessOnActionEvents,
} from "./events/on-actions.ts";
// Every content type an author can name. Derived from the generation tables;
// `codegen-cwt/src/policy/public-surface.ts` is the only door for the rest.
export type * from "./generated/content-public.ts";
export type { EventChainCounterOf } from "./content/event-chains.ts";
export type {
  SituationApproach,
  SituationDefinitionContext,
  SituationStage,
  SituationTypeContextDef,
  SituationTypeDefinition,
} from "./content/situations.ts";
export type {
  DefinedEvent,
  EventDef,
  EventItem,
  EventItemBase,
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
// Generated item unions remain public; their raw constructors are internal
// lowering machinery used by capability methods.
export type * from "./generated/content-definers.ts";
export type { VanillaId } from "./identifiers/contracts.ts";
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
