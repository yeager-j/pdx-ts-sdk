import assert from "node:assert/strict";

import type { Binding, Command, Evidence, Invocation, Outcome, Snapshot } from "./contract.ts";
import { scripts } from "./scenario.ts";

/** A failed shared comparison is behavioral evidence, distinct from transport loss. */
export function check(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
}
/** Validate observation shape without inferring an atomic snapshot from date brackets. */
export function checkSnapshot(snapshot: Snapshot, world?: string): void {
  check(snapshot && Number.isSafeInteger(snapshot.day), "integral observed game day");
  check(snapshot.paused === true && snapshot.ai === "off", "paused with AI off");
  check(
    typeof snapshot.player === "string" && snapshot.player.length > 0,
    "actual player identity"
  );
  check(typeof snapshot.world === "string" && snapshot.world.length > 0, "world identity");
  if (world !== undefined) check(snapshot.world === world, "current world");
}
/** Common correlation, date and fixed-script checks; no adapter metadata enters this function. */
export function checkOutcome(
  outcome: Outcome,
  command: Command,
  invocation: Invocation,
  previous: Snapshot,
  hashes: Readonly<Record<string, string>>
): Evidence {
  check(outcome.kind !== "incomplete", `incomplete operation: ${JSON.stringify(outcome)}`);
  const evidence = outcome.evidence;
  assert.deepEqual(evidence.invocation, invocation, "native invocation correlation");
  checkSnapshot(evidence.before, invocation.world);
  checkSnapshot(evidence.after, invocation.world);
  check(evidence.before.day === previous.day, "no unrequested time between operations");
  check(
    evidence.before.player === previous.player && evidence.after.player === previous.player,
    "player unchanged"
  );
  const elapsed = command.kind === "advance" && outcome.kind === "completed" ? command.days : 0;
  check(
    evidence.after.day - evidence.before.day === elapsed,
    "only explicit advancement changes date"
  );
  check(
    Array.isArray(evidence.raw) && evidence.raw.length > 0,
    "retained native evidence references"
  );
  if (outcome.kind !== "completed") {
    check(outcome.mutation === "none", "rejection has no requested mutation");
    return evidence;
  }
  check(evidence.nativeCompleted === true, "native completion, not acceptance only");
  if (command.kind === "invoke") {
    const script = evidence.script;
    check(
      script && script.id === command.script && script.sha256 === hashes[command.script],
      "fixed script identity"
    );
    check(script.correlatedAtNativeBoundary === true, "invocation-associated marker sink");
    check(
      (typeof outcome.value === "boolean") === (scripts[command.script]?.kind === "condition"),
      "script result kind"
    );
    const markers =
      scripts[command.script]?.kind === "condition"
        ? ["start", `result:${outcome.value}`, "end"]
        : ["start", "end"];
    assert.deepEqual(script.markers, markers, "complete ordered markers");
  }
  return evidence;
}
/** A successful locator must issue a current, correctly typed token. */
export function bindingValue(outcome: Outcome, scope: Binding["scope"], world: string): Binding {
  check(
    outcome.kind === "completed" && typeof outcome.value === "object",
    "completed binding acquisition"
  );
  const binding = outcome.value as Binding;
  check(typeof binding.token === "string" && binding.token.length > 0, "opaque issued token");
  check(binding.scope === scope && binding.world === world, "binding kind and world");
  return binding;
}
/** Conditions return captured booleans; a false result is not an operation rejection. */
export function checkCondition(outcome: Outcome, expected: boolean): void {
  check(
    outcome.kind === "completed" && typeof outcome.value === "boolean",
    "native boolean observation"
  );
  check(outcome.value === expected, `condition expected ${expected}, captured ${outcome.value}`);
}
/** Expected rejections cannot absorb timeout, contract misuse or uncertain mutation. */
export function checkRejected(outcome: Outcome, reason: string): void {
  check(outcome.kind === "rejected" && outcome.reason === reason, `expected rejection ${reason}`);
}
/** Validation reports the bound object lifetime identity, not its locator's present target. */
export function subjectValue(outcome: Outcome): string {
  check(
    outcome.kind === "completed" && typeof outcome.value === "object" && "subject" in outcome.value,
    "live bound subject"
  );
  check(
    typeof outcome.value.subject === "string" && outcome.value.subject.length > 0,
    "subject lifetime identity"
  );
  return outcome.value.subject;
}
