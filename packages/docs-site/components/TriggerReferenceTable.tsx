import { TypeTable, type TypeNode } from "@/src/components/type-table";
import { renderInlineMarkdown } from "@/src/inline-markdown";
import type { ScriptMethodRow } from "@/src/scope-reference";
import { summarizeSignature } from "@/src/signature-summary";
import { triggerAnchor } from "@/src/triggers-index";

/** Renders scope-specific trigger builders linked to their canonical inventory rows. */
export async function TriggerReferenceTable({ rows }: { rows: readonly ScriptMethodRow[] }) {
  const entries = await Promise.all(
    rows.map(async (row): Promise<[string, TypeNode]> => {
      const summaryHtml = await renderInlineMarkdown(row.summary);
      return [
        row.method,
        {
          required: true,
          referenceLink: `/scopes-and-effects/triggers/#${triggerAnchor(row.method)}`,
          type: <code>{summarizeSignature(row.signature) ?? "function"}</code>,
          typeDescription: (
            <code className="whitespace-pre-wrap [overflow-wrap:anywhere]">{row.signature}</code>
          ),
          gameKey: <code>{row.key}</code>,
          description: <span dangerouslySetInnerHTML={{ __html: summaryHtml }} />,
        },
      ];
    })
  );

  return (
    <TypeTable type={Object.fromEntries(entries)} nameHeader="Builder" typeHeader="Signature" />
  );
}
