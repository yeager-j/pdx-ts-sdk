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
export type { TechnologyFields } from "./generated/technology.ts";
export type { TechRef, TechnologyDef } from "./tech.ts";
export { Technology } from "./tech.ts";
export type { ModConfig, PrefixedId } from "./mod.ts";
export { Mod } from "./mod.ts";
