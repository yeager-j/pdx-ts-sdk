import { EffectReferenceTable } from "@/components/EffectReferenceTable";
import type { ScriptMethodRow } from "@/src/scope-reference";

export function ScopeEffects({
  universalCount,
  scopeSpecific,
}: {
  universalCount: number;
  scopeSpecific: readonly ScriptMethodRow[];
}) {
  return (
    <>
      <p>
        These are the ordinary effect methods that the SDK exposes on this generated interface. This
        is not a list of every effect Stellaris supports.
      </p>

      <p>
        <a href="/scopes-and-effects/effects/">{universalCount} universal effects</a> are available
        on every scope interface and listed once in List of Effects.
      </p>

      {scopeSpecific.length === 0 ? (
        <p>This scope adds no scope-specific ordinary effects beyond the universal set.</p>
      ) : (
        <EffectReferenceTable rows={scopeSpecific} />
      )}
    </>
  );
}
