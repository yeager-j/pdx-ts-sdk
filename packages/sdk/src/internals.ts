/**
 * Unstable machinery behind the authoring surface.
 *
 * Nothing here carries a semver guarantee: any release may change or remove
 * these exports without notice. They exist for tools that operate on the
 * SDK's recorded data — `@pdx-ts/sdk-testing`'s interpreter, the generators,
 * and repair tooling — not for mod code. If a mod build imports from this
 * module, that usually means a name is missing from the public surface;
 * please file an issue instead of depending on this one.
 */
export {
  isEffectKey,
  isEventFireKey,
  makeScope,
  recordEffects,
} from "./script/effects/recorder.ts";
export { AMBIENT_SCOPE_KEYS } from "./script/effects/types.ts";
export { scopeLinkOutput } from "./script/links.ts";
export {
  MODIFIER_OPERATIONS,
  type ModifierOperationFields,
  type ModifierOperationMember,
} from "./generated/modifier-policy.ts";
export { STRUCTURAL_EFFECT_KEYS, type StructuralEffectKey } from "./generated/effect-policy.ts";
export {
  EVENT_FIELD_SUPPORT,
  EVENT_OPTION_FIELD_SUPPORT,
  type GeneratedEventFields,
  type GeneratedEventOptionFields,
} from "./generated/event-fields.ts";
export {
  recoverInstallation,
  recoverMaterialization,
  type RecoverInstallationOptions,
  type RecoveryAction,
  type RecoveryReport,
} from "./output/recover.ts";
export { replaceMaterialization } from "./output/write.ts";
export { replaceInstallation } from "./output/install.ts";
export type { MaterializationPhase } from "./output/journal.ts";
export type { PathClaim, PathProducer } from "./compiler/paths.ts";
export {
  compareLogicalPaths,
  compareUtf8,
  normalizeLogicalPath,
  type LogicalPath,
} from "./ordering.ts";
export { isWindowsDeviceName } from "./windows-names.ts";
export type {
  CheckedVanillaId,
  InvalidVanillaId,
  VanillaEnumMember,
  VanillaRegistry,
  VanillaTrie,
} from "./identifiers/contracts.ts";
export {
  stampedVanillaPackageVersion,
  vanillaPackageGameVersion,
  vanillaPackageInstallRange,
} from "./identifiers/version-scheme.ts";
export { block, cmp, kv, list, quoted, scalar, serialize } from "@pdx-ts/pdxscript";
