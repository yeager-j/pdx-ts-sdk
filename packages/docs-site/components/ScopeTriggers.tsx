import { TriggerReferenceTable } from "@/components/TriggerReferenceTable";
import type { ScriptMethodRow } from "@/src/scope-reference";

/** Renders generated trigger availability for one scope page. */
export function ScopeTriggers({
  universalCount,
  scopeSpecific,
}: {
  /** Number of generated trigger builders available on every scope. */
  readonly universalCount: number;
  /** Generated trigger builders available on this exact scope set. */
  readonly scopeSpecific: readonly ScriptMethodRow[];
}) {
  return (
    <>
      <p>
        These are generated trigger builders whose PDXScript keys are legal in this scope. A
        wrapper's signature separately shows the scope used by its nested condition.
      </p>

      <p>
        <a href="/scopes-and-effects/triggers/">{universalCount} universal triggers</a> are
        available on every scope and listed once in List of Triggers.
      </p>

      {scopeSpecific.length === 0 ? (
        <p>This scope adds no scope-specific generated triggers beyond the universal set.</p>
      ) : (
        <TriggerReferenceTable rows={scopeSpecific} />
      )}
    </>
  );
}
