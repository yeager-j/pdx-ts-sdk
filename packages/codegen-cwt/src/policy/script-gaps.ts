import type {
  ScriptGenerationSkipCategory,
  ScriptSkipCategory,
  SkippedRule,
} from "../lower/script-shape.ts";

/** The generated script surface on which a skipped CWT rule was declared. */
export type ScriptRuleKind = "trigger" | "effect";

/**
 * Intentional skip categories owned by policy rather than by a generator
 * limitation: hand-written, structural, event-fire, or removed by the rules.
 */
export type PolicySkipCategory =
  "handwritten-trigger" | "structural-effect" | "event-fire-effect" | "removed-api";

/** Generator limitations that must have an issue and rationale in the gap ledger. */
export type GenerationGapCategory = ScriptGenerationSkipCategory;

/** One acknowledged trigger or effect that the current generator cannot preserve. */
export interface ScriptGenerationGap {
  /** The script surface that declares the rule. */
  readonly kind: ScriptRuleKind;
  /** The original CWT rule key. */
  readonly key: string;
  /** The stable generator limitation that prevents emission. */
  readonly category: GenerationGapCategory;
  /** Why the rule remains unsupported. */
  readonly rationale: string;
  /** The Linear issue that owns closing the gap. */
  readonly issue: string;
}

/** A generator skip paired with its trigger or effect surface. */
export interface ClassifiedScriptSkip extends SkippedRule {
  /** The script surface that produced the skip. */
  readonly kind: ScriptRuleKind;
}

/** A current generator skip reconciled with its ledger rationale and issue. */
export interface TrackedScriptGap extends ClassifiedScriptSkip {
  /** The reconciled generator limitation. */
  readonly category: GenerationGapCategory;
  /** Why the limitation is accepted temporarily. */
  readonly rationale: string;
  /** The Linear issue that owns closing the gap. */
  readonly issue: string;
}

/** Current script skips separated by intentional policy, placeholders, and tracked gaps. */
export interface ScriptGapReport {
  /** Rules intentionally implemented or excluded by hand-written policy. */
  readonly policyOwned: readonly ClassifiedScriptSkip[];
  /** Abstract CWT placeholders that do not represent callable rules. */
  readonly abstractPlaceholders: readonly ClassifiedScriptSkip[];
  /** Generator limitations that match a current ledger row. */
  readonly trackedGaps: readonly TrackedScriptGap[];
}

/** Human-readable report lines grouped by the same categories as {@link ScriptGapReport}. */
export interface ScriptGapReportLines {
  /** Formatted policy-owned skips. */
  readonly policyOwned: readonly string[];
  /** Formatted abstract placeholders. */
  readonly abstractPlaceholders: readonly string[];
  /** Formatted tracked gaps, including their issue and rationale. */
  readonly trackedGaps: readonly string[];
}

const POLICY_CATEGORIES = new Set<ScriptSkipCategory>([
  "handwritten-trigger",
  "structural-effect",
  "event-fire-effect",
  "removed-api",
] satisfies readonly PolicySkipCategory[]);

function isIntentionalExclusion(category: ScriptSkipCategory): boolean {
  return POLICY_CATEGORIES.has(category) || category === "abstract-placeholder";
}

function trackedGapRows(
  kind: ScriptRuleKind,
  category: GenerationGapCategory,
  issue: string,
  rationale: string,
  keys: readonly string[]
): ScriptGenerationGap[] {
  return keys.map((key) => ({ kind, key, category, rationale, issue }));
}

/** The reviewed ledger of current trigger and effect generation gaps. */
export const SCRIPT_GENERATION_GAPS: readonly ScriptGenerationGap[] = [
  ...trackedGapRows(
    "trigger",
    "missing-push-scope",
    "SDK-245",
    "The scope-changing wrapper has no evidence-backed nested scope annotation.",
    [
      "any_cosmic_storm",
      "any_cosmic_storm_end_position",
      "any_cosmic_storm_start_position",
      "any_system_added_to_storm",
      "any_system_removed_from_storm",
      "any_system_within_storm",
      "any_trait_available_for_species",
      "hidden_progress",
      "simple_progress",
    ]
  ),
  ...trackedGapRows(
    "trigger",
    "repeated-nested-field",
    "SDK-246",
    "The script argument model has no array form for repeated nested fields.",
    ["check_economic_production_modifier_for_job"]
  ),
  ...trackedGapRows(
    "effect",
    "repeated-nested-field",
    "SDK-246",
    "The script argument model has no array form for repeated nested fields.",
    [
      "clone_leader",
      "create_colony",
      "create_country",
      "create_leader",
      "create_rebels",
      "create_saved_leader",
      "custom_tooltip_with_params",
      "release_vivarium_fauna_count",
      "start_colony",
    ]
  ),
  ...trackedGapRows(
    "effect",
    "repeated-structured-scalar-arms",
    "SDK-246",
    "The script argument model cannot preserve repetition across scalar and structured arms.",
    ["create_message", "create_species", "set_fleet_formation"]
  ),
  ...trackedGapRows(
    "trigger",
    "scalar-block-overload",
    "SDK-248",
    "The trigger emitter has no sound discriminator for non-localisation scalar and block arms.",
    ["has_resource", "intel_level", "is_war_participant"]
  ),
  ...trackedGapRows(
    "trigger",
    "computed-field-key",
    "SDK-249",
    "The trigger argument model cannot represent computed switch keys.",
    ["inverted_switch", "switch"]
  ),
  ...trackedGapRows(
    "effect",
    "computed-field-key",
    "SDK-250",
    "The effect argument model cannot represent computed or subtype field keys.",
    [
      "add_attunement",
      "add_resource_from_debris",
      "add_resource_to_local_stockpile",
      "set_agreement_terms",
      "set_country_code_flags",
      "set_trade_conversions",
    ]
  ),
  ...trackedGapRows(
    "effect",
    "unsupported-field-value",
    "SDK-253",
    "The create_fleet parent field uses the malformed CWT keyword sceop[fleet].",
    ["create_fleet"]
  ),
  ...trackedGapRows(
    "effect",
    "unsupported-alias-splice",
    "SDK-252",
    "The effect emitter cannot type the fleet_action alias category.",
    ["queue_actions"]
  ),
];

function scriptGapIdentity(row: { readonly kind: ScriptRuleKind; readonly key: string }): string {
  return `${row.kind}:${row.key}`;
}

function classifyScriptSkips(
  triggers: readonly SkippedRule[],
  effects: readonly SkippedRule[]
): ClassifiedScriptSkip[] {
  return [
    ...triggers.map((skip) => ({ ...skip, kind: "trigger" as const })),
    ...effects.map((skip) => ({ ...skip, kind: "effect" as const })),
  ].sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`));
}

/**
 * Reconciles current generator skips with the acknowledged gap ledger.
 * It rejects duplicate, stale, malformed, reclassified, and unacknowledged ledger entries.
 */
export function reconcileScriptGaps(
  skips: {
    /** Trigger rules omitted by the current generation pass. */
    readonly triggers: readonly SkippedRule[];
    /** Effect rules omitted by the current generation pass. */
    readonly effects: readonly SkippedRule[];
  },
  ledger: readonly ScriptGenerationGap[] = SCRIPT_GENERATION_GAPS
): ScriptGapReport {
  const errors: string[] = [];
  const ledgerByIdentity = new Map<string, ScriptGenerationGap>();

  for (const row of ledger) {
    const id = scriptGapIdentity(row);
    if (ledgerByIdentity.has(id)) {
      errors.push(`${id}: duplicate ledger row`);
      continue;
    }
    ledgerByIdentity.set(id, row);
    if (!/^SDK-[1-9][0-9]*$/.test(row.issue)) {
      errors.push(`${id}: issue must be an SDK-N Linear identifier`);
    }
    if (row.rationale.trim() === "") {
      errors.push(`${id}: rationale must explain the tracked gap`);
    }
    if (isIntentionalExclusion(row.category)) {
      errors.push(`${id}: intentional exclusions do not belong in the gap ledger`);
    }
  }

  const actual = classifyScriptSkips(skips.triggers, skips.effects);
  const actualByIdentity = new Map(
    actual.map((skip) => [scriptGapIdentity({ kind: skip.kind, key: skip.name }), skip])
  );
  const policyOwned: ClassifiedScriptSkip[] = [];
  const abstractPlaceholders: ClassifiedScriptSkip[] = [];
  const trackedGaps: TrackedScriptGap[] = [];

  for (const skip of actual) {
    if (POLICY_CATEGORIES.has(skip.category)) {
      policyOwned.push(skip);
      continue;
    }
    if (skip.category === "abstract-placeholder") {
      abstractPlaceholders.push(skip);
      continue;
    }
    const id = scriptGapIdentity({ kind: skip.kind, key: skip.name });
    const row = ledgerByIdentity.get(id);
    if (row === undefined) {
      errors.push(`${id}: unacknowledged ${skip.category} gap`);
      continue;
    }
    if (row.category !== skip.category) {
      errors.push(
        `${id}: ledger category ${row.category} is stale; current category is ${skip.category}`
      );
      continue;
    }
    trackedGaps.push({
      ...skip,
      category: row.category,
      rationale: row.rationale,
      issue: row.issue,
    });
  }

  for (const row of ledger) {
    const id = scriptGapIdentity(row);
    const skip = actualByIdentity.get(id);
    if (skip === undefined) {
      errors.push(`${id}: stale ledger row; the rule now emits or no longer exists`);
    } else if (isIntentionalExclusion(skip.category)) {
      errors.push(`${id}: stale ledger row; current category is ${skip.category}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `script generation gap ledger disagrees with current emission:\n${errors
        .sort()
        .map((error) => `  - ${error}`)
        .join("\n")}`
    );
  }

  return { policyOwned, abstractPlaceholders, trackedGaps };
}

/** Formats a reconciled gap report for deterministic generator diagnostics. */
export function formatScriptGapReport(report: ScriptGapReport): ScriptGapReportLines {
  const ordinary = (entry: ClassifiedScriptSkip): string =>
    `${entry.kind} ${entry.name} [${entry.category}] — ${entry.detail}`;
  return {
    policyOwned: report.policyOwned.map(ordinary),
    abstractPlaceholders: report.abstractPlaceholders.map(ordinary),
    trackedGaps: report.trackedGaps.map(
      (entry) =>
        `${entry.kind} ${entry.name} [${entry.category}] — ${entry.issue}: ${entry.rationale} (${entry.detail})`
    ),
  };
}
