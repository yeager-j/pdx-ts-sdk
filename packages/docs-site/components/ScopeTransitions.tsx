import { renderInlineMarkdown } from "@/src/inline-markdown";
import type { ScopeTransitionRow } from "@/src/scope-reference";

export async function ScopeTransitions({ rows }: { rows: readonly ScopeTransitionRow[] }) {
  const renderedRows = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      summaryHtml: await renderInlineMarkdown(row.summary),
    }))
  );

  return (
    <>
      <p>
        Scope-link properties open a nested effect path in another scope. They are navigation, not
        effects, so they do not appear in the effect tables above.
      </p>

      {renderedRows.length === 0 ? (
        <p>The generated interface exposes no outgoing scope-link property.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Landing scope</th>
                <th>Generated interface</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {renderedRows.map((row) => (
                <tr key={row.member}>
                  <td>
                    <code>{row.member}</code>
                  </td>
                  <td>
                    <code>{row.toScope}</code>
                  </td>
                  <td>
                    <code>{row.toInterface}</code>
                  </td>
                  <td>
                    <span dangerouslySetInnerHTML={{ __html: row.summaryHtml }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
