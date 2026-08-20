import { EffectReferenceTable } from "@/components/EffectReferenceTable";
import type { ScriptMethodRow } from "@/src/scope-reference";

export function ScopeEffects({
  universal,
  scopeSpecific,
}: {
  universal: readonly ScriptMethodRow[];
  scopeSpecific: readonly ScriptMethodRow[];
}) {
  return (
    <>
      <p>
        These are the ordinary effect methods that the SDK exposes on this generated interface. This
        is not a list of every effect Stellaris supports.
      </p>

      <details>
        <summary>{universal.length} universal effects</summary>
        <p>These generated methods are available on every scope interface.</p>
        <EffectReferenceTable rows={universal} />
      </details>

      {scopeSpecific.length === 0 ? (
        <p>This scope adds no scope-specific ordinary effects beyond the universal set.</p>
      ) : (
        <EffectReferenceTable rows={scopeSpecific} />
      )}
    </>
  );
}
