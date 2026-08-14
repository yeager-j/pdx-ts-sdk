/**
 * The complete supported-field reference.
 *
 * Complete is the requirement, so the table carries all 85 rows including the
 * nested ones — and then has to stay readable, which is what the filter box and
 * the level toggle are for. Two columns exist purely to keep the projection
 * honest: `declaredIn` says when a key's declaration lives in a shared clause
 * rather than in the situations rules, and the evidence column says how many
 * shipped definitions write the key, marked when that is below the floor at
 * which this repo treats a field as load-bearing.
 */

import { useMemo, useState } from "react";

import type { FieldRow } from "../../build.ts";
import { Badge, Input, Toggle } from "./ui/primitives.tsx";

/**
 * The key inside a member's block, when the row names one.
 *
 * `monthly_progress.modifier` and `stages.end.modifier` are both authored
 * through the member above them — you write modifier rows, not a member called
 * `modifier` — so both rows would otherwise print the same member name as their
 * parent and read as duplicates. Eleven rows do this. Showing the interior key
 * beside the member is the accurate version: one authoring member, two rule
 * keys underneath it.
 */
function interiorKey(field: FieldRow): string | null {
  const segments = field.key.split(".");
  return segments.length > field.member.split(".").length ? (segments.at(-1) ?? null) : null;
}

function Docs({ docs }: { docs: readonly string[] }) {
  if (docs.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return <span className="text-muted-foreground">{docs.join(" ")}</span>;
}

export function FieldTable({ fields }: { fields: readonly FieldRow[] }) {
  const [query, setQuery] = useState("");
  const [topOnly, setTopOnly] = useState(false);
  const [requiredOnly, setRequiredOnly] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return fields.filter((field) => {
      if (topOnly && field.level !== "top") {
        return false;
      }
      if (requiredOnly && !field.required) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return (
        field.key.toLowerCase().includes(needle) ||
        field.member.toLowerCase().includes(needle) ||
        field.shape.toLowerCase().includes(needle) ||
        (field.scope ?? "").toLowerCase().includes(needle)
      );
    });
  }, [fields, query, topOnly, requiredOnly]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-64"
          placeholder="Filter fields…"
          aria-label="Filter fields"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Toggle active={topOnly} onClick={() => setTopOnly((value) => !value)}>
          Top level only
        </Toggle>
        <Toggle active={requiredOnly} onClick={() => setRequiredOnly((value) => !value)}>
          Required only
        </Toggle>
        <span className="text-xs text-muted-foreground" data-testid="field-count">
          {rows.length} of {fields.length} fields
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Game key</th>
              <th className="px-3 py-2 font-medium">Shape</th>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Shipped</th>
              <th className="px-3 py-2 font-medium">Rules say</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((field) => (
              <tr key={field.key} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs">
                  {field.member}
                  {interiorKey(field) !== null && (
                    <span className="text-muted-foreground"> → {interiorKey(field)}</span>
                  )}
                  {field.required && (
                    <Badge tone="contract" className="ml-2">
                      required
                    </Badge>
                  )}
                  {field.repeated && <Badge className="ml-2">repeats</Badge>}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {field.key}
                  {field.declaredIn === "alias-clause" && (
                    <span
                      className="ml-2 opacity-70"
                      title="Declared in a shared clause, not in the situations rules"
                    >
                      (clause)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {field.shape}
                  {field.literals !== null && (
                    <div className="text-muted-foreground">{field.literals.join(" | ")}</div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {field.scope === null ? (
                    <span className="text-muted-foreground/50">—</span>
                  ) : field.scope === "any" ? (
                    <Badge tone="unresolved">any</Badge>
                  ) : (
                    field.scope
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {field.evidence === null ? (
                    <span className="text-muted-foreground/50">not observed</span>
                  ) : (
                    <span className={field.evidence.belowPresenceFloor ? "text-omission" : ""}>
                      {field.evidence.definitions}
                      {field.evidence.belowPresenceFloor && " ·  below floor"}
                    </span>
                  )}
                </td>
                <td className="max-w-md px-3 py-2 text-xs">
                  <Docs docs={field.docs} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
