import type { EventKindRow } from "@/src/scope-reference";

export function EventKinds({ rows }: { rows: readonly EventKindRow[] }) {
  if (rows.length === 0) {
    return (
      <p>
        The SDK generates no event kind whose body runs in this scope. Enter it through another
        legal callback or scope transition instead.
      </p>
    );
  }

  return (
    <>
      <p>The following table contains generated event kinds for this body scope.</p>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Event kind</th>
              <th>Generated subtype</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <code>{row.key}</code>
                </td>
                <td>
                  <code>{row.subtype}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
