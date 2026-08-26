/**
 * Fields the game writes at or above the presence floor that the SDK cannot
 * yet author, each acknowledged with a reason. The presence-floor test in
 * `corpus-conformance.test.ts` fails on any unauthorable field at
 * `PRESENCE_FLOOR` occurrences or more that has no row here and no
 * `CONTENT_DECLINED_FIELDS` row — and fails the other way on a row whose field
 * has since become authorable or fallen below the floor, so the table cannot
 * rot in either direction.
 *
 * A row is measurement, not acceptance: it names work (usually emitter
 * machinery) that a maintainer has decided to sequence, and the Linear issue
 * tracking that work. Every row's tracking issue carries the "Corpus Gap"
 * label in Linear, so the open gap backlog is queryable by label. Adding a row
 * takes the same scrutiny as an overlay entry — the diff is one object, so
 * review reads the reason and the count and asks whether deferring is still
 * right. Deliberately *withholding* an authorable shape is
 * `CONTENT_DECLINED_FIELDS`' job, never this table's.
 */

export interface AcknowledgedGap {
  readonly registry: string;
  /** The corpus's dotted path, e.g. `resources` or `stages.icon`. */
  readonly field: string;
  /** Occurrences when the gap was accepted — context for review, not asserted. */
  readonly count: number;
  readonly reason: string;
  /**
   * The Linear issue tracking the fix. Required, not optional: an acknowledged
   * gap with no issue is a hole nobody is sequenced to close, so a row cannot
   * be added without filing one first.
   */
  readonly issue: string;
}

export const ACKNOWLEDGED_GAPS: readonly AcknowledgedGap[] = [
  {
    registry: "building",
    field: "inline_script",
    count: 285,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
  {
    registry: "tradition",
    field: "inline_script",
    count: 27,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
  {
    registry: "job",
    field: "inline_script",
    count: 146,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
  {
    registry: "mission",
    field: "inline_script",
    count: 50,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
  {
    registry: "utility_component_template",
    field: "inline_script",
    count: 121,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
  {
    registry: "weapon_component_template",
    field: "inline_script",
    count: 36,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
  {
    registry: "special_project",
    field: "inline_script",
    count: 105,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
];
