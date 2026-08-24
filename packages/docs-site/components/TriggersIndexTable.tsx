"use client";

import type { ScopeLinkTarget } from "@/src/reference-index";
import type { TriggersIndexEntry } from "@/src/triggers-index";

import { ReferenceIndexTable } from "./ReferenceIndexTable";

/** A trigger-index row after server-only Markdown and signature rendering. */
export interface TriggersIndexRow extends TriggersIndexEntry {
  /** Server-rendered description markup. */
  readonly summaryHtml: string;
  /** Compact signature shown in the table column. */
  readonly signatureSummary: string;
}

/** Renders the generated-trigger inventory through the shared reference table. */
export function TriggersIndexTable({
  rows,
  scopeOptions,
  scopePages,
}: {
  /** Complete server-rendered trigger rows. */
  readonly rows: readonly TriggersIndexRow[];
  /** Canonical scopes offered by the legal-scope filter. */
  readonly scopeOptions: readonly string[];
  /** Published scope pages used for universal availability links. */
  readonly scopePages: readonly ScopeLinkTarget[];
}) {
  return (
    <ReferenceIndexTable
      id="triggers"
      nameHeader="Builder"
      itemName="builders"
      rows={rows}
      scopeOptions={scopeOptions}
      scopePages={scopePages}
      searchPlaceholder="hasCountryFlag, has_country_flag"
    />
  );
}
