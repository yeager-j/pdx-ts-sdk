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
    registry: "technology",
    field: "modifier",
    count: 243,
    reason:
      "Declared `single_alias_right[modifier_clause]`, which the emitter has no lowering for " +
      'in this position ("no declaration the emitter can lower").',
    issue: "SDK-63",
  },
  {
    registry: "technology",
    field: "technology_swap.modifier",
    count: 55,
    reason:
      "The same modifier_clause gap as technology.modifier above, one level down inside the " +
      "technology_swap struct (technologies_consolidated.cwt:162-163) — invisible until the " +
      "corpus gate started descending into plain structs, and closed by the same fix.",
    issue: "SDK-63",
  },
  {
    registry: "technology",
    field: "prereqfor_desc",
    count: 125,
    reason:
      "A block keyed by `enum[prereq_for_category]` with title/desc sub-blocks; needs " +
      "enum-keyed map machinery.",
    issue: "SDK-64",
  },
  {
    registry: "technology",
    field: "technology_swap.prereqfor_desc",
    count: 28,
    reason:
      "The same enum-keyed map as technology.prereqfor_desc above, declared again inside " +
      "technology_swap (technologies_consolidated.cwt:164-172) and closed by the same machinery.",
    issue: "SDK-64",
  },
  {
    registry: "technology",
    field: "mod_weight_if_group_picked",
    count: 34,
    reason: "A map keyed by `value[tech_weight_group]`; needs value-set-keyed map machinery.",
    issue: "SDK-66",
  },
  {
    registry: "building",
    field: "resources",
    count: 458,
    reason:
      "A `category` sibling beside the `alias_name[economic_template]` splice; the " +
      "economicResources lowering other registries use does not fit this declaration.",
    issue: "SDK-62",
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
    issue: "SDK-65",
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
    issue: "SDK-67",
  },
  {
    registry: "megastructure",
    field: "placement_rules",
    count: 27,
    reason:
      "An `alias_name[trigger]` splice beside a named `planet_possible` sibling " +
      "(megastructures.cwt:234-240): not a pure splice, so it is not the trigger shape, and " +
      "structShape declines any block holding a splice rather than dropping it. The same " +
      "declaration is why decision.custom_tooltip and component_template.custom_tooltip are " +
      "unlowerable, so one shape closes all three.",
    issue: "SDK-84",
  },
];
