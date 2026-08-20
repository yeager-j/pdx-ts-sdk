import { EffectReferenceTable } from "@/components/EffectReferenceTable";
import type { ScriptMethodRow } from "@/src/scope-reference";

export function StructuralMethods({ rows }: { rows: readonly ScriptMethodRow[] }) {
  return (
    <>
      <p>
        These handwritten SDK methods record branching, iteration, saved targets, and other script
        structure. They are listed separately from ordinary generated effects.
      </p>

      <EffectReferenceTable rows={rows} />
    </>
  );
}
