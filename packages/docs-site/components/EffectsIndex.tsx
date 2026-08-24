import { SCRIPT_REFERENCE_SCOPES } from "@pdx-ts/sdk/reference";

import { scopePages } from "@/lib/scope-pages";
import { buildEffectsIndex } from "@/src/effects-index";
import { renderInlineMarkdown } from "@/src/inline-markdown";
import { summarizeSignature } from "@/src/signature-summary";

import { EffectsIndexTable, type EffectsIndexRow } from "./EffectsIndexTable";

/**
 * The whole effect inventory, one row per generated method.
 *
 * The model and the Markdown rendering of each summary are server work: the
 * generated reference is more than 1000 rows and the Markdown pipeline has no business
 * in a browser bundle. The client component receives plain rows and owns only
 * the filtering, paging, and anchor behavior.
 */
export async function EffectsIndex() {
  const model = buildEffectsIndex(scopePages());
  const rows: EffectsIndexRow[] = await Promise.all(
    model.entries.map(async (entry) => ({
      ...entry,
      summaryHtml: await renderInlineMarkdown(entry.summary),
      signatureSummary: summarizeSignature(entry.signature) ?? "function",
    }))
  );

  return (
    <>
      <p>
        {model.counts.effect} ordinary effects, {model.counts.structural} structural methods, and{" "}
        {model.counts.eventFire} event-fire methods.
      </p>
      <EffectsIndexTable
        rows={rows}
        scopeOptions={SCRIPT_REFERENCE_SCOPES}
        scopePages={model.scopePages}
      />
    </>
  );
}
