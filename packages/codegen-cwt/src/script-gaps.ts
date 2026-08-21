import type {
  ScriptGenerationSkipCategory,
  ScriptSkipCategory,
  SkippedRule,
} from "./emit/shape.ts";

export type ScriptRuleKind = "trigger" | "effect";

export type PolicySkipCategory = "handwritten-trigger" | "structural-effect" | "event-fire-effect";

export type GenerationGapCategory = ScriptGenerationSkipCategory;

export interface ScriptGenerationGap {
  readonly kind: ScriptRuleKind;
  readonly key: string;
  readonly category: GenerationGapCategory;
  readonly rationale: string;
  readonly issue: string;
}

export interface ClassifiedScriptSkip extends SkippedRule {
  readonly kind: ScriptRuleKind;
}

export interface TrackedScriptGap extends ClassifiedScriptSkip {
  readonly category: GenerationGapCategory;
  readonly rationale: string;
  readonly issue: string;
}

export interface ScriptGapReport {
  readonly policyOwned: readonly ClassifiedScriptSkip[];
  readonly abstractPlaceholders: readonly ClassifiedScriptSkip[];
  readonly trackedGaps: readonly TrackedScriptGap[];
}

export interface ScriptGapReportLines {
  readonly policyOwned: readonly string[];
  readonly abstractPlaceholders: readonly string[];
  readonly trackedGaps: readonly string[];
}

const POLICY_CATEGORIES = new Set<ScriptSkipCategory>([
  "handwritten-trigger",
  "structural-effect",
  "event-fire-effect",
]);

function acknowledged(
  kind: ScriptRuleKind,
  category: GenerationGapCategory,
  issue: string,
  rationale: string,
  keys: readonly string[]
): ScriptGenerationGap[] {
  return keys.map((key) => ({ kind, key, category, rationale, issue }));
}

export const SCRIPT_GENERATION_GAPS: readonly ScriptGenerationGap[] = [
  ...acknowledged(
    "trigger",
    "unknown-scope",
    "SDK-243",
    "The declared legacy pop scope has no canonical SDK scope mapping.",
    ["has_pop_flag", "pop_has_ethic"]
  ),
  ...acknowledged(
    "effect",
    "unknown-scope",
    "SDK-243",
    "The declared legacy pop scope has no canonical SDK scope mapping.",
    ["pop_event", "remove_pop_flag", "set_pop_flag", "set_timed_pop_flag"]
  ),
  ...acknowledged(
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
  ...acknowledged(
    "trigger",
    "repeated-nested-field",
    "SDK-246",
    "The script argument model has no array form for repeated nested fields.",
    ["check_economic_production_modifier_for_job"]
  ),
  ...acknowledged(
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
  ...acknowledged(
    "effect",
    "repeated-structured-scalar-arms",
    "SDK-246",
    "The script argument model cannot preserve repetition across scalar and structured arms.",
    ["create_message", "create_species", "set_fleet_formation"]
  ),
  ...acknowledged(
    "trigger",
    "bare-value-block",
    "SDK-247",
    "The trigger argument model cannot represent bare block values.",
    ["has_active_event", "trait_has_all_tags", "trait_has_any_tag"]
  ),
  ...acknowledged(
    "trigger",
    "structured-bare-values",
    "SDK-247",
    "The script argument model cannot represent bare values inside a nested block.",
    [
      "total_country_workforce_with_job_tag",
      "total_system_workforce_with_job_tag",
      "total_workforce_with_job_tag",
    ]
  ),
  ...acknowledged(
    "effect",
    "structured-bare-values",
    "SDK-247",
    "The script argument model cannot represent bare values inside a nested block.",
    [
      "add_timeline_event",
      "clear_relations",
      "copy_ascension_perks_from",
      "copy_techs_from",
      "copy_traditions_from",
      "create_balanced_fleet",
      "create_random_fleet",
      "give_specimen",
      "spawn_planet",
      "start_storm_area_placing",
      "storm_apply_aftermath_modifier",
    ]
  ),
  ...acknowledged(
    "trigger",
    "scalar-block-overload",
    "SDK-248",
    "The trigger emitter has no sound discriminator for non-localisation scalar and block arms.",
    ["has_resource", "intel_level", "is_war_participant"]
  ),
  ...acknowledged(
    "trigger",
    "computed-field-key",
    "SDK-249",
    "The trigger argument model cannot represent computed switch keys.",
    ["inverted_switch", "switch"]
  ),
  ...acknowledged(
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
  ...acknowledged(
    "effect",
    "unsupported-field-value",
    "SDK-253",
    "The create_fleet parent field uses the malformed CWT keyword sceop[fleet].",
    ["create_fleet"]
  ),
  ...acknowledged(
    "effect",
    "unsupported-alias-splice",
    "SDK-252",
    "The effect emitter cannot type the fleet_action alias category.",
    ["queue_actions"]
  ),
];

function identity(row: { readonly kind: ScriptRuleKind; readonly key: string }): string {
  return `${row.kind}:${row.key}`;
}

function classified(
  triggers: readonly SkippedRule[],
  effects: readonly SkippedRule[]
): ClassifiedScriptSkip[] {
  return [
    ...triggers.map((skip) => ({ ...skip, kind: "trigger" as const })),
    ...effects.map((skip) => ({ ...skip, kind: "effect" as const })),
  ].sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`));
}

export function reconcileScriptGaps(
  skips: {
    readonly triggers: readonly SkippedRule[];
    readonly effects: readonly SkippedRule[];
  },
  ledger: readonly ScriptGenerationGap[] = SCRIPT_GENERATION_GAPS
): ScriptGapReport {
  const errors: string[] = [];
  const ledgerByIdentity = new Map<string, ScriptGenerationGap>();

  for (const row of ledger) {
    const id = identity(row);
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
    const category = row.category as ScriptSkipCategory;
    if (POLICY_CATEGORIES.has(category) || category === "abstract-placeholder") {
      errors.push(`${id}: intentional exclusions do not belong in the gap ledger`);
    }
  }

  const actual = classified(skips.triggers, skips.effects);
  const actualByIdentity = new Map(
    actual.map((skip) => [identity({ kind: skip.kind, key: skip.name }), skip])
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
    const id = identity({ kind: skip.kind, key: skip.name });
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
    const id = identity(row);
    const skip = actualByIdentity.get(id);
    if (skip === undefined) {
      errors.push(`${id}: stale ledger row; the rule now emits or no longer exists`);
    } else if (POLICY_CATEGORIES.has(skip.category) || skip.category === "abstract-placeholder") {
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
