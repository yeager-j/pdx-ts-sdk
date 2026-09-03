import type { RuleSet } from "../cwt/rules.ts";
import { eventKinds } from "../lower/event-kinds.ts";
import { camelCase, compareStrings, docComment } from "../naming.ts";

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
  /**
   * How a structural key with no method of its own is written: the public
   * method whose returned chain records it, or `null` when no author can
   * write it. Absent on every key that has a method.
   */
  readonly recordedBy?: string | null;
}

/**
 * One structural key's authoring: a public method, or no method and then a
 * statement of what records the key instead. A null-method row must say
 * `recordedBy`, so "unsupported" is written down rather than implied.
 */
type StructuralEffectSpec =
  | { readonly method: string; readonly reason: string }
  | { readonly method: null; readonly recordedBy: string | null; readonly reason: string };

const STRUCTURAL_EFFECTS = {
  if: { method: "if", reason: "control flow" },
  else: { method: null, recordedBy: "if", reason: "recorded by the if-chain returned from if" },
  else_if: {
    method: null,
    recordedBy: "if",
    reason: "recorded by the if-chain returned from if",
  },
  while: { method: "whileLoop", reason: "control flow" },
  switch: { method: null, recordedBy: null, reason: "unsupported control-flow surface" },
  inverted_switch: {
    method: null,
    recordedBy: null,
    reason: "unsupported control-flow surface",
  },
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
} as const satisfies Record<string, StructuralEffectSpec>;

/** The fixed key an SDK-only structural method records, and whether a generated method records it too. */
interface SyntheticStructuralEffect {
  /** The fixed PDXScript key the method always records, or `null` when it records none. */
  readonly key: string | null;
  /** Present when a generated effect method records the same fixed key on purpose. */
  readonly sharesKeyWithGenerated?: { readonly reason: string };
}

/**
 * SDK-only structural methods the CWT rules never declare, with the fixed PDXScript
 * key each records. `target` writes a real `target = { ... }` block even though the
 * rules contain no `alias[effect:target]`, and `previewModifier` writes the `tooltip`
 * block the generated `tooltip()` effect also writes.
 */
const SYNTHETIC_STRUCTURAL_EFFECTS = {
  previewModifier: {
    key: "tooltip",
    sharesKeyWithGenerated: {
      reason:
        "previewModifier renders a non-executing tooltip through the same `tooltip` block the generated tooltip() effect records; the two methods deliberately share the key",
    },
  },
  target: { key: "target" },
  run: { key: null },
} as const satisfies Record<string, SyntheticStructuralEffect>;

/** One public structural method and the fixed PDXScript key it records. */
export interface StructuralEffectIdentity {
  /** The public SDK method name. */
  readonly method: string;
  /** The fixed PDXScript key the method always records, or `null` when it records none. */
  readonly key: string | null;
  /** Present when a generated effect method records the same fixed key on purpose. */
  readonly sharesKeyWithGenerated?: { readonly reason: string };
}

/** Indexed effect ownership and the method sets consumed by generator validation. */
export interface EffectPolicy {
  /** Ownership entries keyed by normalized CWT effect key. */
  readonly byKey: ReadonlyMap<string, EffectPolicyEntry>;
  /** Method-to-key identity of every public structural method, sorted by method. */
  readonly structuralIdentity: readonly StructuralEffectIdentity[];
  /** Methods implemented by the hand-written structural effects surface. */
  readonly structuralMethods: ReadonlySet<string>;
  /** CWT effect keys owned by the structural surface, including keys with no public method. */
  readonly structuralKeys: ReadonlySet<string>;
  /** Structural keys with no method and nothing that records them: no author can write these. */
  readonly unsupportedStructuralKeys: ReadonlySet<string>;
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
  for (const [key, spec] of Object.entries(STRUCTURAL_EFFECTS) as [
    string,
    StructuralEffectSpec,
  ][]) {
    byKey.set(key, {
      key,
      method: spec.method,
      owner: "structural",
      reason: spec.reason,
      ...(spec.method === null ? { recordedBy: spec.recordedBy } : {}),
    });
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

  const structuralIdentity = [
    ...Object.entries(STRUCTURAL_EFFECTS).flatMap(([key, spec]) =>
      spec.method === null ? [] : [{ method: spec.method, key }]
    ),
    ...Object.entries(SYNTHETIC_STRUCTURAL_EFFECTS).map(([method, spec]) => ({
      method,
      ...spec,
    })),
  ].sort((left, right) => compareStrings(left.method, right.method));
  const structuralMethods = new Set(structuralIdentity.map((identity) => identity.method));
  const structuralKeys = new Set(
    [...byKey.values()].flatMap((entry) => (entry.owner === "structural" ? [entry.key] : []))
  );
  const unsupportedStructuralKeys = new Set(
    [...byKey.values()].flatMap((entry) =>
      entry.owner === "structural" && entry.method === null && entry.recordedBy === null
        ? [entry.key]
        : []
    )
  );
  const fireKeys = new Set(
    [...byKey.values()].flatMap((entry) => (entry.owner === "fire" ? [entry.key] : []))
  );
  const publicMethods = new Set([
    ...structuralMethods,
    ...[...byKey.values()].flatMap((entry) => (entry.method === null ? [] : [entry.method])),
  ]);
  return {
    byKey,
    structuralIdentity,
    structuralMethods,
    structuralKeys,
    unsupportedStructuralKeys,
    fireKeys,
    publicMethods,
  };
}

/** Emits the generated constants and union types that expose effect ownership to the SDK. */
export function emitEffectPolicyProtocol(policy: EffectPolicy): string {
  const structural = [...policy.structuralMethods].sort();
  const structuralKeys = [...policy.structuralKeys].sort();
  const fireKeys = [...policy.fireKeys].sort();
  // The generated ledger carries the public ownership facts only; how a
  // null-method key is recorded is a generator-side fact the SDK does not read.
  const nonGeneratedEntries = [...policy.byKey.values()]
    .filter((entry) => entry.owner !== "generated")
    .sort((left, right) => compareStrings(left.key, right.key))
    .map(({ key, method, owner, reason }) => ({
      key,
      method,
      owner,
      ...(reason === undefined ? {} : { reason }),
    }));
  return (
    docComment([
      "Every CWT effect key a hand-written surface owns instead of a generated builder,",
      "with the public method that records it. `owner` names the surface: `structural`",
      "for control flow and contracts, `fire` for the event-firing effects. A `null`",
      "method has no public builder of its own.",
    ]) +
    `export const EFFECT_OWNERSHIP = ${JSON.stringify(nonGeneratedEntries)} as const;\n\n` +
    docComment(["Every public method the hand-written structural effect surface provides."]) +
    `export const STRUCTURAL_EFFECT_METHODS = ${JSON.stringify(structural)} as const;\n\n` +
    docComment([
      "The fixed PDXScript key each public structural method records, or `null` when",
      "the method records no fixed key. The sole authority for structural",
      "method-to-key identity; the hand-written reference ledger reads its keys from here.",
      "",
      "A row carrying `sharesKeyWithGenerated` records a key that a generated effect",
      "method also records, deliberately: both methods write the same block, so the",
      "key identifies the block rather than the method that produced it.",
    ]) +
    `export const STRUCTURAL_EFFECT_IDENTITY = ${JSON.stringify(policy.structuralIdentity)} as const;\n\n` +
    docComment([
      "Every CWT effect key the structural surface owns, including the keys it records",
      "without a public method of their own.",
    ]) +
    `export const STRUCTURAL_EFFECT_KEYS = ${JSON.stringify(structuralKeys)} as const;\n\n` +
    docComment(["Every CWT effect key that fires an event."]) +
    `export const FIRE_EFFECT_KEYS = ${JSON.stringify(fireKeys)} as const;\n\n` +
    docComment(["One public structural effect method name."]) +
    "export type StructuralEffectMethod = (typeof STRUCTURAL_EFFECT_METHODS)[number];\n" +
    docComment(["One CWT effect key the structural surface owns."]) +
    "export type StructuralEffectKey = (typeof STRUCTURAL_EFFECT_KEYS)[number];\n"
  );
}
