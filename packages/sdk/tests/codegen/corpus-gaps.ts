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
 * machinery) that a maintainer has decided to sequence, with the Linear issue
 * where one exists. Adding a row takes the same scrutiny as an overlay entry —
 * the diff is one object, so review reads the reason and the count and asks
 * whether deferring is still right. Deliberately *withholding* an authorable
 * shape is `CONTENT_DECLINED_FIELDS`' job, never this table's.
 */

export interface AcknowledgedGap {
  readonly registry: string;
  /** The corpus's dotted path, e.g. `resources` or `stages.icon`. */
  readonly field: string;
  /** Occurrences when the gap was accepted — context for review, not asserted. */
  readonly count: number;
  readonly reason: string;
  /** The Linear issue tracking the fix, or null where none exists yet. */
  readonly issue: string | null;
}

export const ACKNOWLEDGED_GAPS: readonly AcknowledgedGap[] = [
  {
    registry: "technology",
    field: "modifier",
    count: 243,
    reason:
      "Declared `single_alias_right[modifier_clause]`, which the emitter has no lowering for " +
      'in this position ("no declaration the emitter can lower").',
    issue: null,
  },
  {
    registry: "technology",
    field: "prereqfor_desc",
    count: 125,
    reason:
      "A block keyed by `enum[prereq_for_category]` with title/desc sub-blocks; needs " +
      "enum-keyed map machinery.",
    issue: null,
  },
  {
    registry: "technology",
    field: "mod_weight_if_group_picked",
    count: 34,
    reason: "A map keyed by `value[tech_weight_group]`; needs value-set-keyed map machinery.",
    issue: null,
  },
  {
    registry: "building",
    field: "resources",
    count: 458,
    reason:
      "A `category` sibling beside the `alias_name[economic_template]` splice; the " +
      "economicResources lowering other registries use does not fit this declaration.",
    issue: null,
  },
  {
    registry: "building",
    field: "inline_script",
    count: 285,
    reason: "CWT `macro[inline_script]`; needs first-class inline-script machinery.",
    issue: "SDK-17",
  },
  {
    registry: "building",
    field: "ai_resource_production",
    count: 39,
    reason:
      "A map keyed by `<resource>` references with trigger and complex-maths siblings; needs " +
      "reference-keyed map machinery.",
    issue: null,
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
    registry: "weapon_component_template",
    field: "target_weights",
    count: 25,
    reason:
      "An open scalar-keyed map of floats (`scalar = float`); needs scalar-keyed map machinery.",
    issue: null,
  },
];
