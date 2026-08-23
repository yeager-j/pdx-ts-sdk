import type { RuleSet } from "../cwt/rules.ts";
import { eventKinds } from "../lower/event-kinds.ts";
import { camelCase } from "../naming.ts";

/** The implementation surface that owns an effect key and its public method. */
export type EffectOwner = "generated" | "structural" | "fire";

/** The ownership decision for one CWT effect key. */
export interface EffectPolicyEntry {
  /** The normalized CWT effect key. */
  readonly key: string;
  /** The public SDK method, or `null` when the key has no direct method. */
  readonly method: string | null;
  /** The implementation surface responsible for the effect. */
  readonly owner: EffectOwner;
  /** Why a non-generated surface owns the effect. */
  readonly reason?: string;
}

const STRUCTURAL_EFFECTS = {
  if: { method: "if", reason: "control flow" },
  else: { method: null, reason: "recorded by the if-chain returned from if" },
  else_if: { method: null, reason: "recorded by the if-chain returned from if" },
  while: { method: "whileLoop", reason: "control flow" },
  switch: { method: null, reason: "unsupported control-flow surface" },
  inverted_switch: { method: null, reason: "unsupported control-flow surface" },
  random: { method: "random", reason: "weighted control flow" },
  random_list: { method: "randomList", reason: "weighted control flow" },
  locked_random_list: { method: "lockedRandomList", reason: "weighted control flow" },
  save_event_target_as: { method: "saveEventTargetAs", reason: "scope-branded target" },
  save_global_event_target_as: {
    method: "saveGlobalEventTargetAs",
    reason: "scope-branded target",
  },
  add_resource: { method: "addResource", reason: "resource-keyed block" },
  hidden_effect: { method: "hiddenEffect", reason: "composable effect path" },
  add_event_chain_counter: {
    method: "addEventChainCounter",
    reason: "event-chain reference contract",
  },
  reset_event_chain_counter: {
    method: "resetEventChainCounter",
    reason: "event-chain reference contract",
  },
} as const satisfies Record<string, { readonly method: string | null; readonly reason: string }>;

/** SDK-only methods with no CWT effect key. */
export const SYNTHETIC_STRUCTURAL_EFFECT_METHODS = ["previewModifier", "target", "run"] as const;

/** Indexed effect ownership and the method sets consumed by generator validation. */
export interface EffectPolicy {
  /** Ownership entries keyed by normalized CWT effect key. */
  readonly byKey: ReadonlyMap<string, EffectPolicyEntry>;
  /** Methods implemented by the hand-written structural effects surface. */
  readonly structuralMethods: ReadonlySet<string>;
  /** CWT keys implemented as typed event-fire methods. */
  readonly fireKeys: ReadonlySet<string>;
  /** Every public method name across generated and hand-written effects. */
  readonly publicMethods: ReadonlySet<string>;
}

/**
 * Assigns every declared effect to generated, structural, or event-fire ownership.
 * Event-fire ownership is limited to event kinds with a receiving scope.
 */
export function createEffectPolicy(rules: RuleSet): EffectPolicy {
  const byKey = new Map<string, EffectPolicyEntry>();
  for (const [key, spec] of Object.entries(STRUCTURAL_EFFECTS)) {
    byKey.set(key, { key, method: spec.method, owner: "structural", reason: spec.reason });
  }

  for (const kind of eventKinds(rules)) {
    const declarations = rules.effects.get(kind.key);
    const hasReceivingScopes = declarations?.some(
      (declaration) => (declaration.supportedScopes?.length ?? 0) > 0
    );
    if (kind.scope === null || hasReceivingScopes !== true) {
      continue;
    }
    if (byKey.has(kind.key)) {
      throw new Error(`effect ${kind.key} is owned by both the event and structural policies`);
    }
    byKey.set(kind.key, { key: kind.key, method: camelCase(kind.key), owner: "fire" });
  }

  for (const key of rules.effects.keys()) {
    const normalized = key.toLowerCase();
    if (!byKey.has(normalized)) {
      byKey.set(normalized, {
        key,
        method: camelCase(key),
        owner: "generated",
      });
    }
  }

  const structuralMethods = new Set([
    ...Object.values(STRUCTURAL_EFFECTS).flatMap((entry) =>
      entry.method === null ? [] : [entry.method]
    ),
    ...SYNTHETIC_STRUCTURAL_EFFECT_METHODS,
  ]);
  const fireKeys = new Set(
    [...byKey.values()].flatMap((entry) => (entry.owner === "fire" ? [entry.key] : []))
  );
  const publicMethods = new Set([
    ...structuralMethods,
    ...[...byKey.values()].flatMap((entry) => (entry.method === null ? [] : [entry.method])),
  ]);
  return { byKey, structuralMethods, fireKeys, publicMethods };
}

/** Emits the generated constants and union types that expose effect ownership to the SDK. */
export function emitEffectPolicyProtocol(policy: EffectPolicy): string {
  const structural = [...policy.structuralMethods].sort();
  const structuralKeys = [...policy.byKey.values()]
    .flatMap((entry) => (entry.owner === "structural" ? [entry.key] : []))
    .sort();
  const fireKeys = [...policy.fireKeys].sort();
  const nonGeneratedEntries = [...policy.byKey.values()]
    .filter((entry) => entry.owner !== "generated")
    .sort((left, right) => left.key.localeCompare(right.key));
  return (
    `export const EFFECT_OWNERSHIP = ${JSON.stringify(nonGeneratedEntries)} as const;\n\n` +
    `export const STRUCTURAL_EFFECT_METHODS = ${JSON.stringify(structural)} as const;\n\n` +
    `export const STRUCTURAL_EFFECT_KEYS = ${JSON.stringify(structuralKeys)} as const;\n\n` +
    `export const FIRE_EFFECT_KEYS = ${JSON.stringify(fireKeys)} as const;\n\n` +
    "export type StructuralEffectMethod = (typeof STRUCTURAL_EFFECT_METHODS)[number];\n" +
    "export type StructuralEffectKey = (typeof STRUCTURAL_EFFECT_KEYS)[number];\n"
  );
}
