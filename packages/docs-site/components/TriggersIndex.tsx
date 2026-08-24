import { SCRIPT_REFERENCE_SCOPES } from "@pdx-ts/sdk/reference";

import { scopePages } from "@/lib/scope-pages";
import { renderInlineMarkdown } from "@/src/inline-markdown";
import { summarizeSignature } from "@/src/signature-summary";
import { buildTriggersIndex } from "@/src/triggers-index";

import { TriggersIndexTable, type TriggersIndexRow } from "./TriggersIndexTable";

/** Renders the complete generated trigger-builder inventory. */
export async function TriggersIndex() {
  const model = buildTriggersIndex(scopePages());
  const rows: TriggersIndexRow[] = await Promise.all(
    model.entries.map(async (entry) => ({
      ...entry,
      summaryHtml: await renderInlineMarkdown(entry.summary),
      signatureSummary: summarizeSignature(entry.signature) ?? "function",
    }))
  );

  return (
    <>
      <p>{model.entries.length} generated trigger builders.</p>
      <TriggersIndexTable
        rows={rows}
        scopeOptions={SCRIPT_REFERENCE_SCOPES}
        scopePages={model.scopePages}
      />
    </>
  );
}
