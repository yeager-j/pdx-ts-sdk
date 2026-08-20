import type { ReactNode } from "react";

import { LocalisationSlots } from "@/components/LocalisationSlots";
import { TypeTable, type TypeNode } from "@/src/components/type-table";
import { buildFieldTable, type FieldRow } from "@/src/field-table";
import { renderInlineMarkdown } from "@/src/inline-markdown";

/**
 * A registry's generated field tables: the top-level members, every nested
 * table they reach, the localisation slots, and — marked, never hidden — the
 * fields the authoring surface leaves out.
 *
 * All structure and prose come from `buildFieldTable`, which joins the SDK's
 * runtime descriptors with the generated field-docs ledger and throws on any
 * gap. Rendering this component is therefore part of the drift gate: a stale
 * ledger fails `next build` on the first page that carries a field table.
 *
 * The rows render in the site's extended `TypeTable` (vendored from
 * fumadocs-ui and given a game-key column), fed from the same model the old
 * four-column table used.
 */

const OMISSION_LABELS = {
  declined: "not supported deliberately",
  unsupported: "not supported yet",
  collapsed: "collapsed",
} as const;

const anchor = (id: string): string => `fields-${id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;

function rowDescription(row: FieldRow): ReactNode {
  const hasContent =
    row.docs.length > 0 || row.literals !== undefined || row.refTypes !== undefined;
  if (!hasContent) return undefined;
  return (
    <>
      {row.docs.join(" ")}
      {row.literals && (
        <>
          {row.docs.length > 0 && " "}
          One of:{" "}
          {row.literals.map((literal, index) => (
            <span key={literal}>
              {index > 0 && ", "}
              <code>{literal}</code>
            </span>
          ))}
          .
        </>
      )}
      {row.refTypes && (
        <>
          {" References "}
          {row.refTypes.map((ref, index) => (
            <span key={ref}>
              {index > 0 && ", "}
              <code>{ref}</code>
            </span>
          ))}
          {" ids."}
        </>
      )}
    </>
  );
}

function typeNodesOf(rows: readonly FieldRow[]): Record<string, TypeNode> {
  return Object.fromEntries(
    rows.map((row) => [
      row.member,
      {
        type: <code>{row.type}</code>,
        required: !row.optional,
        description: rowDescription(row),
        gameKey: row.key === undefined ? undefined : <code>{row.key}</code>,
        ...(row.subTable === undefined ? {} : { typeDescriptionLink: `#${anchor(row.subTable)}` }),
      } satisfies TypeNode,
    ])
  );
}

export async function FieldTable({ registry }: { registry: string }) {
  const model = buildFieldTable(registry);
  const omissions = await Promise.all(
    model.omissions.map(async (row) => ({
      ...row,
      reasonHtml: await renderInlineMarkdown(row.reason),
    }))
  );

  return (
    <>
      <TypeTable type={typeNodesOf(model.rows)} />

      {model.localisation.length > 0 && (
        <>
          <h3 id={anchor(`${registry}-localisation`)}>Localization slots</h3>
          <p>
            Text members emitted to localization rather than into the definition body. The pattern's{" "}
            <code>$</code> is the definition's id.
          </p>
          <LocalisationSlots slots={model.localisation} />
        </>
      )}

      {model.subTables.map((table) => (
        <div key={table.id}>
          <h3 id={anchor(table.id)}>
            <code>{table.title}</code> fields
          </h3>
          <TypeTable type={typeNodesOf(table.rows)} />
          {table.localisation && (
            <>
              <p>
                Each entry also has localization members; the pattern's <code>$</code> is the
                entry's own key.
              </p>
              <LocalisationSlots slots={table.localisation} />
            </>
          )}
        </div>
      ))}

      {omissions.length > 0 && (
        <>
          <h3 id={anchor(`${registry}-not-authorable`)}>Fields the SDK does not author</h3>
          <p>
            The game's rules declare these, and the SDK's authoring surface leaves them out — each
            one knowingly, for the reason given. A field missing from the tables above and from this
            list is a bug; please report it.
          </p>
          <ul>
            {omissions.map((row) => (
              <li key={row.path}>
                <code>{row.path}</code> — <em>{OMISSION_LABELS[row.kind]}</em>:{" "}
                <span dangerouslySetInnerHTML={{ __html: row.reasonHtml }} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
