import { TypeTable, type TypeNode } from "@/src/components/type-table";
import { renderInlineMarkdown } from "@/src/inline-markdown";
import type { ScriptMethodRow } from "@/src/scope-reference";
import { summarizeSignature } from "@/src/signature-summary";

/**
 * Script methods rendered in the site's extended `TypeTable`, the same
 * component the field tables use: the trigger row shows the method and a
 * compact `(value) => void` form of the signature, and the detail holds the
 * full signature, the game key, the availability, and the notes. Signatures
 * can be hundreds of characters of union type, which no fixed-column table
 * lays out well.
 */
export async function EffectReferenceTable({
  rows,
  showAvailability = false,
}: {
  rows: readonly ScriptMethodRow[];
  showAvailability?: boolean;
}) {
  const entries = await Promise.all(
    rows.map(async (row): Promise<[string, TypeNode]> => {
      const summaryHtml = await renderInlineMarkdown(row.summary);
      return [
        row.method,
        {
          // `required` suppresses the optional-member `?` suffix, which has
          // no meaning for a method row.
          required: true,
          type: <code>{summarizeSignature(row.signature) ?? "function"}</code>,
          typeDescription: (
            <code className="whitespace-pre-wrap [overflow-wrap:anywhere]">{row.signature}</code>
          ),
          gameKey: row.key === undefined ? undefined : <code>{row.key}</code>,
          ...(showAvailability
            ? {
                availability:
                  row.availability.kind === "universal"
                    ? "All generated scopes"
                    : row.availability.scopes.join(", "),
              }
            : {}),
          description: <span dangerouslySetInnerHTML={{ __html: summaryHtml }} />,
        },
      ];
    })
  );

  return (
    <TypeTable type={Object.fromEntries(entries)} nameHeader="Method" typeHeader="Signature" />
  );
}
