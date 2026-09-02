/** Shared render-ready shapes for omitted fields and generated field documentation. */

/**
 * A CWT field omitted from the generated authoring surface.
 * The kind and reason support both the codegen report and the generated field ledger.
 */
export interface FieldOmissionRow {
  /** The path exactly as the codegen report prints it. */
  readonly path: string;
  /** Why the field is absent or represented by another emitted member. */
  readonly kind: "declined" | "unsupported" | "collapsed";
  /** The human-readable explanation appended to the report path. */
  readonly reason: string;
}

/**
 * Documentation facts for one generated authoring member.
 * The field-docs ledger uses the same optionality, prose, type text, and literals as its interface.
 */
export interface MemberDocRow {
  /** Whether the emitted interface permits the member to be absent. */
  readonly optional: boolean;
  /** The human-readable lines used for the emitted member's JSDoc. */
  readonly docs: readonly string[];
  /** The TypeScript type text shown for the emitted member. */
  readonly memberType: string;
  /** Every scalar the member admits, when the lowering closed the set. */
  readonly literals?: readonly string[];
}

/**
 * Documentation rows for one generated field-table constant.
 * The constant name is the stable key shared with runtime content descriptors.
 */
export interface DocTable {
  /** The generated field-table constant that owns these documentation rows. */
  readonly constant: string;
  /** Documentation keyed by the author-facing member name. */
  readonly members: Readonly<Record<string, MemberDocRow>>;
}

/**
 * Formats one omission for the codegen report.
 * Declined, unsupported, and collapsed rows intentionally use distinct report syntax.
 */
export function omissionLine(row: FieldOmissionRow): string {
  switch (row.kind) {
    case "declined":
      return `${row.path} — ${row.reason}`;
    case "unsupported":
      return `${row.path} (${row.reason})`;
    case "collapsed":
      return `${row.path} ${row.reason}`;
  }
}
