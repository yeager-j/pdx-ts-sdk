import type { RuleSet } from "../cwt/rules.ts";
import { docComment } from "../naming.ts";

/** The reviewed SDK disposition for one CWT complex-maths operation. */
export interface ModifierOperationPolicyEntry {
  /** The operation key written to PDXScript. */
  readonly scriptKey: string;
  /** The authored SDK member, or `null` when the operation is unsupported. */
  readonly member: string | null;
  /** The operand form declared by the operation's CWT enum. */
  readonly operandKind: "value" | "boolean";
  /** Consumer-facing documentation for a supported member. */
  readonly memberDocs: string | null;
  /** Whether SDK authoring admits the operation. */
  readonly disposition: "supported" | "unsupported";
  /** The evidence or limitation behind the disposition. */
  readonly reason: string;
}

const MODIFIER_OPERATION_POLICY: readonly ModifierOperationPolicyEntry[] = [
  {
    scriptKey: "factor",
    member: "factor",
    operandKind: "value",
    memberDocs: "Multiplies the current value by this operand.",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "add",
    member: "add",
    operandKind: "value",
    memberDocs: "Adds this operand to the current value.",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "weight",
    member: "weight",
    operandKind: "value",
    memberDocs: "Applies the distinct `weight` operation with this operand.",
    disposition: "supported",
    reason: "authored and emitted by existing weight-block consumers",
  },
  {
    scriptKey: "subtract",
    member: "subtract",
    operandKind: "value",
    memberDocs: "Subtracts this operand from the current value.",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "mult",
    member: "mult",
    operandKind: "value",
    memberDocs: "Multiplies the current value by this operand with `mult`.",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "multiply",
    member: "multiplier",
    operandKind: "value",
    memberDocs: "Multiplies the current value by this operand with `multiply`.",
    disposition: "supported",
    reason: "measured; the authored alias distinguishes it from mult",
  },
  {
    scriptKey: "divide",
    member: "divide",
    operandKind: "value",
    memberDocs: "Divides the current value by this operand.",
    disposition: "supported",
    reason: "measured across weight-block consumers",
  },
  {
    scriptKey: "round",
    member: "round",
    operandKind: "boolean",
    memberDocs: "Set to true to round the current value to the nearest integer.",
    disposition: "supported",
    reason: "measured in 7 of 37 crisis-objective reward blocks",
  },
  {
    scriptKey: "round_to",
    member: "roundTo",
    operandKind: "value",
    memberDocs: "Rounds the current value to the nearest multiple of this operand.",
    disposition: "supported",
    reason: "measured in 24 of 37 crisis-objective reward blocks",
  },
  {
    scriptKey: "min",
    member: "minValue",
    operandKind: "value",
    memberDocs: "Clamps the current value to at least this operand.",
    disposition: "supported",
    reason: "measured; the authored alias reads as an assignment",
  },
  {
    scriptKey: "max",
    member: "maxValue",
    operandKind: "value",
    memberDocs: "Clamps the current value to at most this operand.",
    disposition: "supported",
    reason: "measured; the authored alias reads as an assignment",
  },
  ...["set", "modulo", "pow"].map((scriptKey): ModifierOperationPolicyEntry => ({
    scriptKey,
    member: null,
    operandKind: "value",
    memberDocs: null,
    disposition: "unsupported",
    reason: "declared by complex_maths_enum but unmeasured in the supported corpus",
  })),
  ...["ceiling", "floor", "abs", "square_root", "square"].map(
    (scriptKey): ModifierOperationPolicyEntry => ({
      scriptKey,
      member: null,
      operandKind: "boolean",
      memberDocs: null,
      disposition: "unsupported",
      reason: "declared by simple_maths_enum but unmeasured in the supported corpus",
    })
  ),
];

/**
 * Returns the reviewed modifier-operation policy after reconciling it with both maths enums.
 * Generation fails when either vendored enum adds or removes an operation without a policy decision.
 */
export function createModifierOperationPolicy(
  rules: RuleSet
): readonly ModifierOperationPolicyEntry[] {
  for (const [enumName, operandKind] of [
    ["complex_maths_enum", "value"],
    ["simple_maths_enum", "boolean"],
  ] as const) {
    const declared = new Set(rules.enums.get(enumName) ?? []);
    if (declared.size === 0) {
      throw new Error(`modifier_rule.cwt declares no ${enumName} members`);
    }
    const owned = new Set(
      MODIFIER_OPERATION_POLICY.filter((entry) => entry.operandKind === operandKind).map(
        (entry) => entry.scriptKey
      )
    );
    const missing = [...declared].filter((key) => !owned.has(key));
    const stale = [...owned].filter((key) => !declared.has(key));
    if (missing.length > 0 || stale.length > 0) {
      throw new Error(
        `modifier operation policy disagrees with ${enumName}` +
          (missing.length === 0 ? "" : `; unowned: ${missing.join(", ")}`) +
          (stale.length === 0 ? "" : `; no longer declared: ${stale.join(", ")}`)
      );
    }
  }
  return MODIFIER_OPERATION_POLICY;
}

/** Emits the supported authoring fields and complete modifier-operation policy for the SDK. */
export function emitModifierOperationProtocol(
  policy: readonly ModifierOperationPolicyEntry[]
): string {
  const incomplete = policy.find(
    (entry) =>
      entry.disposition === "supported" && (entry.member === null || entry.memberDocs === null)
  );
  if (incomplete !== undefined) {
    throw new Error(`supported modifier operation ${incomplete.scriptKey} has no member contract`);
  }
  const supported = policy.filter(
    (
      entry
    ): entry is ModifierOperationPolicyEntry & {
      readonly member: string;
      readonly memberDocs: string;
    } => entry.disposition === "supported"
  );
  return (
    docComment([
      "The authored fields admitted by modifier_rule's supported maths operations.",
      "Value-field operands remain generic so SDK authoring can supply ScriptValue without a cycle.",
    ]) +
    "export interface ModifierOperationFields<Value> {\n" +
    supported
      .map(
        (entry) =>
          docComment([entry.memberDocs], "  ") +
          `  readonly ${entry.member}?: ${entry.operandKind === "boolean" ? "boolean" : "Value"};\n`
      )
      .join("") +
    "}\n\n" +
    docComment([
      "Supported modifier operations in deterministic emission order.",
      "SDK lowering and sdk-testing operation detection consume this projection.",
    ]) +
    "export const MODIFIER_OPERATIONS = [\n" +
    supported
      .map(
        (entry) =>
          `  { member: ${JSON.stringify(entry.member)}, scriptKey: ${JSON.stringify(entry.scriptKey)}, operandKind: ${JSON.stringify(entry.operandKind)} },\n`
      )
      .join("") +
    "] as const;\n\n" +
    docComment(["The authoring name of one modifier arithmetic operation."]) +
    'export type ModifierOperationMember = (typeof MODIFIER_OPERATIONS)[number]["member"];\n\n' +
    docComment(["Every modifier maths-enum member and the SDK's reviewed disposition."]) +
    "export const MODIFIER_OPERATION_POLICY = [\n" +
    policy
      .map(
        (entry) =>
          `  { scriptKey: ${JSON.stringify(entry.scriptKey)}, member: ${entry.member === null ? "null" : JSON.stringify(entry.member)}, operandKind: ${JSON.stringify(entry.operandKind)}, memberDocs: ${entry.memberDocs === null ? "null" : JSON.stringify(entry.memberDocs)}, disposition: ${JSON.stringify(entry.disposition)}, reason: ${JSON.stringify(entry.reason)} },\n`
      )
      .join("") +
    "] as const;\n"
  );
}
