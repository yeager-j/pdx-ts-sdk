import type { RuleSet } from "../cwt/rules.ts";
import { eventKinds } from "../lower/event-kinds.ts";
import { camelCase } from "../naming.ts";

export type EffectOwner = "generated" | "structural" | "fire";

export interface EffectPolicyEntry {
  readonly key: string;
  readonly method: string | null;
  readonly owner: EffectOwner;
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
export const SYNTHETIC_STRUCTURAL_EFFECT_METHODS = ["target", "run"] as const;

export interface EffectPolicy {
  readonly byKey: ReadonlyMap<string, EffectPolicyEntry>;
  readonly structuralMethods: ReadonlySet<string>;
  readonly fireKeys: ReadonlySet<string>;
  readonly publicMethods: ReadonlySet<string>;
}

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

export function emitEffectPolicyProtocol(policy: EffectPolicy): string {
  const structural = [...policy.structuralMethods].sort();
  const structuralKeys = [...policy.byKey.values()]
    .flatMap((entry) => (entry.owner === "structural" ? [entry.key] : []))
    .sort();
  const fireKeys = [...policy.fireKeys].sort();
  const owned = [...policy.byKey.values()]
    .filter((entry) => entry.owner !== "generated")
    .sort((left, right) => left.key.localeCompare(right.key));
  return (
    `export const EFFECT_OWNERSHIP = ${JSON.stringify(owned)} as const;\n\n` +
    `export const STRUCTURAL_EFFECT_METHODS = ${JSON.stringify(structural)} as const;\n\n` +
    `export const STRUCTURAL_EFFECT_KEYS = ${JSON.stringify(structuralKeys)} as const;\n\n` +
    `export const FIRE_EFFECT_KEYS = ${JSON.stringify(fireKeys)} as const;\n\n` +
    "export type StructuralEffectMethod = (typeof STRUCTURAL_EFFECT_METHODS)[number];\n" +
    "export type StructuralEffectKey = (typeof STRUCTURAL_EFFECT_KEYS)[number];\n"
  );
}
