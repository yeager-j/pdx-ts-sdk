/**
 * The report-row shapes shared by every field-lowering emitter: what one
 * omitted, documented, or tabulated field looks like as data.
 *
 * `fields.ts` produces these, `content-field-docs.ts` renders them into the
 * generated field-docs ledger, and the alias emitters (`alias-struct.ts`,
 * `alias-splice.ts`) bubble their own rows up in the same shapes — kept here
 * so all of them describe an omitted or documented field identically instead
 * of drifting into per-emitter formats.
 */

/**
 * A field the rules declare that the authoring surface leaves out, as one
 * structured row. The codegen report and the generated ledger are both
 * projections of these rows — see {@link omissionLine} for the report's.
 */
export interface FieldOmissionRow {
  /** The path exactly as the codegen report prints it. */
  readonly path: string;
  readonly kind: "declined" | "unsupported" | "collapsed";
  readonly reason: string;
}

/**
 * One authoring member's human-readable half, for the generated field-docs
 * ledger: what the emitted interface says about the member, as data a docs
 * build can render — the same doc lines that become the JSDoc, the same
 * optionality that becomes the `?`, the same type text intellisense shows.
 */
export interface MemberDocRow {
  readonly optional: boolean;
  readonly docs: readonly string[];
  readonly memberType: string;
  /** Every scalar the member admits, when the lowering closed the set. */
  readonly literals?: readonly string[];
}

/**
 * One emitted field table's documentation rows, named by the constant the
 * table is emitted as (`TECHNOLOGY_FIELDS`) so the ledger can key its map by
 * the very same runtime array the descriptors reference.
 */
export interface DocTable {
  readonly constant: string;
  readonly members: Readonly<Record<string, MemberDocRow>>;
}

/**
 * The report line a row has always printed as, per kind — declined rows use
 * an em dash, unsupported rows parenthesize, collapsed rows carry their own
 * leading `(pattern)`. Changing a format here changes the codegen report.
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
