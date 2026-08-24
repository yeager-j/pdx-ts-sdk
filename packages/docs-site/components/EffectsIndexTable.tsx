"use client";

import type { EffectCategory, EffectsIndexEntry } from "@/src/effects-index";
import type { ScopeLinkTarget } from "@/src/reference-index";

import { ReferenceIndexTable, type ReferenceIndexRow } from "./ReferenceIndexTable";

/** An effect-index row after server-only Markdown and signature rendering. */
export interface EffectsIndexRow extends EffectsIndexEntry {
  /** Server-rendered description markup. */
  readonly summaryHtml: string;
  /** Compact signature shown in the table column. */
  readonly signatureSummary: string;
}

const CATEGORY_LABELS: Record<EffectCategory, string> = {
  effect: "Effect",
  structural: "Structural",
  "event-fire": "Event fire",
};

export { matchesScopeFilter, UNIVERSAL_SCOPE_FILTER } from "./ReferenceIndexTable";

/** Renders the effects inventory through the shared script-reference table. */
export function EffectsIndexTable({
  rows,
  scopeOptions,
  scopePages,
}: {
  /** Complete server-rendered effect rows. */
  readonly rows: readonly EffectsIndexRow[];
  /** Canonical scopes offered by the legal-scope filter. */
  readonly scopeOptions: readonly string[];
  /** Published scope pages used for universal availability links. */
  readonly scopePages: readonly ScopeLinkTarget[];
}) {
  const referenceRows: ReferenceIndexRow[] = rows.map((row) => ({
    ...row,
    badge: CATEGORY_LABELS[row.category],
  }));
  return (
    <ReferenceIndexTable
      id="effects"
      nameHeader="Method"
      itemName="methods"
      rows={referenceRows}
      scopeOptions={scopeOptions}
      scopePages={scopePages}
      searchPlaceholder="addResource, add_resource"
      categoryFilter={{
        label: "Category",
        allLabel: "Every category",
        labels: CATEGORY_LABELS,
      }}
    />
  );
}
