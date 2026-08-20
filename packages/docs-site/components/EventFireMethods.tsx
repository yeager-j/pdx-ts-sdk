import { EffectReferenceTable } from "@/components/EffectReferenceTable";
import type { ScriptMethodRow } from "@/src/scope-reference";

export function EventFireMethods({ rows }: { rows: readonly ScriptMethodRow[] }) {
  return (
    <>
      <p>
        These methods fire typed event references. Their availability follows the generated
        receiving scopes, which is separate from the scope in which an event body runs.
      </p>

      {rows.length === 0 ? (
        <p>The generated interface has no legal event-fire method.</p>
      ) : (
        <EffectReferenceTable rows={rows} />
      )}
    </>
  );
}
