import type { RuleSet } from "../cwt/rules.ts";
import { docComment } from "../naming.ts";

export interface ModifierOperationPolicyEntry {
  readonly scriptKey: string;
  readonly member: string | null;
  readonly disposition: "supported" | "unsupported";
  readonly reason: string;
}

const POLICY: readonly ModifierOperationPolicyEntry[] = [
  {
    scriptKey: "factor",
    member: "factor",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "add",
    member: "add",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "weight",
    member: "weight",
    disposition: "supported",
    reason: "authored and emitted by existing weight-block consumers",
  },
  {
    scriptKey: "subtract",
    member: "subtract",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "mult",
    member: "mult",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "multiply",
    member: "multiplier",
    disposition: "supported",
    reason: "measured; the authored alias distinguishes it from mult",
  },
  {
    scriptKey: "divide",
    member: "divide",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "min",
    member: "minValue",
    disposition: "supported",
    reason: "measured; the authored alias reads as an assignment",
  },
  {
    scriptKey: "max",
    member: "maxValue",
    disposition: "supported",
    reason: "measured; the authored alias reads as an assignment",
  },
  ...["set", "modulo", "round_to", "pow"].map((scriptKey): ModifierOperationPolicyEntry => ({
    scriptKey,
    member: null,
    disposition: "unsupported",
    reason: "declared by complex_maths_enum but unmeasured in the supported corpus",
  })),
];

export function createModifierOperationPolicy(
  rules: RuleSet
): readonly ModifierOperationPolicyEntry[] {
  const declared = new Set(rules.enums.get("complex_maths_enum") ?? []);
  if (declared.size === 0) {
    throw new Error("modifier_rule.cwt declares no complex_maths_enum members");
  }
  const owned = new Set(POLICY.map((entry) => entry.scriptKey));
  const missing = [...declared].filter((key) => !owned.has(key));
  const stale = [...owned].filter((key) => !declared.has(key));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      "modifier operation policy disagrees with complex_maths_enum" +
        (missing.length === 0 ? "" : `; unowned: ${missing.join(", ")}`) +
        (stale.length === 0 ? "" : `; no longer declared: ${stale.join(", ")}`)
    );
  }
  return POLICY;
}

export function emitModifierOperationProtocol(
  policy: readonly ModifierOperationPolicyEntry[]
): string {
  const supported = policy.filter(
    (entry): entry is ModifierOperationPolicyEntry & { readonly member: string } =>
      entry.disposition === "supported" && entry.member !== null
  );
  return (
    docComment([
      "The authored fields admitted by modifier_rule's supported complex-maths operations.",
      "The value remains generic so SDK authoring can supply ScriptValue without a cycle.",
    ]) +
    "export interface ModifierOperationFields<Value> {\n" +
    supported.map((entry) => `  readonly ${entry.member}?: Value;\n`).join("") +
    "}\n\n" +
    docComment([
      "Supported modifier operations in deterministic emission order.",
      "SDK lowering and sdk-testing operation detection consume this projection.",
    ]) +
    "export const MODIFIER_OPERATIONS = [\n" +
    supported
      .map(
        (entry) =>
          `  { member: ${JSON.stringify(entry.member)}, scriptKey: ${JSON.stringify(entry.scriptKey)} },\n`
      )
      .join("") +
    "] as const;\n\n" +
    'export type ModifierOperationMember = (typeof MODIFIER_OPERATIONS)[number]["member"];\n\n' +
    docComment(["Every complex_maths_enum member and the SDK's reviewed disposition."]) +
    "export const MODIFIER_OPERATION_POLICY = [\n" +
    policy
      .map(
        (entry) =>
          `  { scriptKey: ${JSON.stringify(entry.scriptKey)}, member: ${entry.member === null ? "null" : JSON.stringify(entry.member)}, disposition: ${JSON.stringify(entry.disposition)}, reason: ${JSON.stringify(entry.reason)} },\n`
      )
      .join("") +
    "] as const;\n"
  );
}
