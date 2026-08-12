/**
 * Every rationale-bearing row the shape-conformance gate reads, for all four
 * mismatch kinds — and the comparison that keeps the softer two reviewed.
 *
 * `shapeConformance` reports `form`, `scope`, `arity` and `literal`, and the
 * gate does not treat them alike. A `form` or `scope` mismatch names a field the
 * SDK emits and no author can fill, so it fails unless
 * {@link ACKNOWLEDGED_MISMATCHES} carries the reason. An `arity` or `literal`
 * mismatch names something legal: a list CWT permits and vanilla happens never
 * to repeat, or a scalar the engine reads case-insensitively. Failing those
 * would be a claim that CWT is wrong.
 *
 * Reporting them to the console, which is what this replaced, was the other
 * error. An observation nobody has to answer for is an observation nobody
 * reads: the row scrolls past, and the next game patch's new one scrolls past
 * beside it. So {@link OBSERVATIONS} is a committed baseline, every row saying
 * *which* kind of legal it is and why, and {@link compareObservations} fails on
 * any movement — a new observation, one that stopped happening, or one whose
 * evidence changed. What it never does is fail on an observation that is
 * already classified and unchanged.
 *
 * Two things are deliberately absent. There is no rebaseline command: a row is
 * written by a person who looked at the CWT declaration, and
 * {@link observationStub} emits a `classification` outside the union so a
 * pasted stub fails `tsc` until somebody chooses. And the row identity is never
 * the mismatch's prose `detail`, which carries definition counts that move with
 * every patch and a sample that truncates at six — it is `(registry, field,
 * kind)` plus the structured `evidence`, compared as a set.
 *
 * One caveat the evidence cannot state about itself: the corpus reader keeps at
 * most `VALUE_SAMPLE` (64) distinct scalars per field, and a field that filled
 * that sample before an out-of-union spelling appeared would never record the
 * spelling — the stray would go unreported and a row would stay green over a
 * value nobody reviewed. Below the cap there is no sample at all: the set is
 * everything the corpus wrote. That is what "keeps every closed literal union
 * under the value-sample cap" in `corpus-conformance.test.ts` asserts, so the
 * cap stays a memory bound rather than becoming a silent filter.
 */

import type { ConformanceMismatchKind } from "@pdx-ts/codegen-cwt/corpus";

import { compareUtf8 } from "../../src/ordering.ts";

/** The two kinds this baseline classifies. The other two are acknowledged below. */
export type ObservationKind = Extract<ConformanceMismatchKind, "arity" | "literal">;

/**
 * What an observation turned out to be. Two verdicts per kind, because each kind
 * really does have exactly two: the finding is legal breadth the SDK should keep
 * carrying, or it is work the SDK owes and has not done.
 *
 * There is no "the checker is confused" verdict, on purpose. When the gate
 * measured `ship_size.graphical_culture`'s 25 culture ids against the `yes`/`no`
 * union its *scalar* arm declares, the answer was to stop asking a dual's two
 * arms one question, not to write the confusion down as evidence about the game.
 */
export type ObservationClass =
  /**
   * `arity`. CWT declares the key repeatable and vanilla never uses that, so the
   * emitted list is wider than the shipped corpus and narrower than nothing.
   * Keeping it costs an author one pair of brackets; narrowing it would reject a
   * mod the game accepts.
   */
  | "rules-wider-than-vanilla"
  /**
   * `arity`. The list really is the wrong authoring surface and a
   * `CONTENT_FIELD_OVERRIDES` row with `arity: "single"` is the fix (see
   * `technology.mod_weight_if_group_picked`), sequenced rather than done.
   * Requires the issue that will do it.
   */
  | "narrowing-deferred"
  /**
   * `literal`. The shipped value differs from a union member only by a spelling
   * the engine normalizes — `LARGE` for `large`. Nothing is unauthorable: the
   * SDK's stricter surface is the deliberate one, and CWT is not wrong.
   */
  | "engine-lenient-spelling"
  /**
   * `literal`. The value is real and the emitted union cannot hold it, so an
   * author is stuck until the union widens. Requires the issue that will widen
   * it.
   */
  | "rules-omit-value";

/** Which kind each classification is allowed to answer. */
const CLASSIFICATION_KIND: Readonly<Record<ObservationClass, ObservationKind>> = {
  "rules-wider-than-vanilla": "arity",
  "narrowing-deferred": "arity",
  "engine-lenient-spelling": "literal",
  "rules-omit-value": "literal",
};

/** The classifications naming work, which cannot be recorded without an owner. */
const NEEDS_ISSUE: ReadonlySet<ObservationClass> = new Set<ObservationClass>([
  "narrowing-deferred",
  "rules-omit-value",
]);

/** One measured `arity` or `literal` mismatch, as the gate projects it. */
export interface ObservedShape {
  readonly registry: string;
  /** The corpus's dotted path, e.g. `resources` or `stages.section_weight.modifier`. */
  readonly field: string;
  readonly kind: ObservationKind;
  /** `ShapeMismatch.evidence` — the strays for `literal`, empty for `arity`. */
  readonly evidence: readonly string[];
}

export interface ClassifiedObservation extends ObservedShape {
  readonly classification: ObservationClass;
  /** Why this classification, in this field's own terms. Never empty. */
  readonly rationale: string;
  /**
   * The CWT declaration this row claims to be wider than: `file.cwt:line` and
   * the cardinality that made the key a list. Required on every `arity` row,
   * because "the rules are wider" is a claim *about the rules* — a row that
   * cites none is a shrug, and looking the line up is what stops a family of
   * rows from being written blind.
   */
  readonly declaration?: string;
  /** Required by {@link NEEDS_ISSUE}: work nobody is sequenced to do is a hole. */
  readonly issue?: string;
}

/** Shared by both tables: an alias splice is unbounded by construction. */
const MODIFIER_ROW =
  "modifier_rule.cwt:5 — alias[modifier_rule:modifier], spliced by alias_match_left, " +
  "which bounds nothing";

/** The reason every `alias[modifier_rule:modifier]` row carries, holder aside. */
function weightRows(holder: string): string {
  return (
    `A weight block's rows are an alias splice, so the list is how the category is spliced ` +
    `rather than a cardinality anyone wrote: ${holder}. Every shipped definition that writes ` +
    `this block gates it on a single condition, and a second row is the ordinary way to write ` +
    `a second condition — the breadth is the feature.`
  );
}

/** The reason every economic-resources row carries. */
function resourceRows(): string {
  return (
    "An economic resources block is declared repeatable because the game merges repeats, and " +
    "every shipped definition writes exactly one. Writing one is the natural authoring either " +
    "way; narrowing would reject a mod that splits its costs and upkeep across two blocks, " +
    "which the rules permit."
  );
}

/**
 * The classified `arity` and `literal` baseline, sorted by registry, field, kind.
 *
 * Every `arity` row today is `rules-wider-than-vanilla`, which is what a corpus
 * that is a lower bound looks like: the game writing a key once proves nothing
 * about whether writing it twice is legal, and CWT is the authority that says it
 * is. The `literal` rows are the same finding in the other direction —
 * `Yes`, `LARGE` and `extra_Large` are the engine's case-insensitivity showing
 * through vanilla's own files.
 */
export const OBSERVATIONS: readonly ClassifiedObservation[] = [
  {
    registry: "ascension_perk",
    field: "tradition_swap.custom_tooltip",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/ascension_perks.cwt:95 — ## cardinality = 0..inf",
    rationale:
      "A tooltip line per swap, and every shipped swap writes one. The perk's own custom_tooltip " +
      "is 0..1 (ascension_perks.cwt:79) and the swap's is not, so the rules mean the swap to be " +
      "able to say several things.",
  },
  {
    registry: "bombardment_stance",
    field: "kill_pop_chance.modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: MODIFIER_ROW,
    rationale: weightRows("holder at common/bombardment_stances.cwt:39"),
  },
  {
    registry: "building",
    field: "empire_limit.modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: MODIFIER_ROW,
    rationale: weightRows("holder at common/buildings.cwt:93"),
  },
  {
    registry: "building",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/buildings.cwt:241 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "building",
    field: "show_in_tech",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/buildings.cwt:180 — ## cardinality = 0..inf",
    rationale:
      "A building can be shown under several technologies and shipped buildings pick a single " +
      "technology each. The starbase copy of this key is 0..1 " +
      "(starbases_consolidated.cwt:239) while the building copy is not, so the difference is " +
      "one the rules state rather than one vanilla's usage implies.",
  },
  {
    registry: "casus_belli",
    field: "proxy_war_resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/casus_belli_and_war_goals.cwt:58 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "civic_or_origin",
    field: "custom_tooltip_with_modifiers",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/governments.cwt:395 — ## cardinality = 0..inf",
    rationale:
      "Sits beside custom_tooltip under the same 0..inf, and the civics and origins that " +
      "write it write one line. A civic with two modifier tooltips is exactly what the " +
      "repetition is for.",
  },
  {
    registry: "civic_or_origin",
    field: "has_secondary_species.traits.trait",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/governments.cwt:460 — ## cardinality = 1..5",
    rationale:
      "The one row here whose declaration is a bounded range rather than an open one: a " +
      "secondary species may require up to five traits, and the shipped origins require one. " +
      "Narrowing to a single trait would make four fifths of the declared range unwritable.",
  },
  {
    registry: "civic_or_origin",
    field: "soft_traits.trait",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/governments.cwt:497 — ## cardinality = 0..inf",
    rationale:
      "The unbounded sibling of the row above — a preference rather than a requirement, so the " +
      "rules put no ceiling on it. Every shipped definition names one trait.",
  },
  {
    registry: "edict",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/edicts.cwt:32 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "global_ship_design",
    field: "growth_stages.section",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/global_ship_designs.cwt:37 — ## cardinality = 0..inf",
    rationale:
      "A design's own sections are 0..inf too (global_ship_designs.cwt:76) and shipped designs " +
      "do write several; the growth-stage copy is the same key and the same rule, and the " +
      "definitions that grow through stages happen to fit each stage in one section.",
  },
  {
    registry: "graphical_culture",
    field: "ship_selection_weight.modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: MODIFIER_ROW,
    rationale: weightRows("holder at common/graphical_cultures.cwt:71"),
  },
  {
    registry: "job",
    field: "overlord_resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/pop_jobs.cwt:183 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "job",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/pop_jobs.cwt:176 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "job",
    field: "triggered_planet_pop_group_modifier_for_all",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/pop_jobs.cwt:206 — ## cardinality = 0..inf",
    rationale:
      "A triggered modifier is one condition and one modifier set, so several of them is how a " +
      "job expresses several cases; the shipped jobs using it have one case each. Its " +
      "unconditional siblings on the same type are 0..1, which is the shape of a rule that " +
      "means the repetition.",
  },
  {
    registry: "megastructure",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/megastructures.cwt:191 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "scripted_loc",
    field: "text.weight.modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: MODIFIER_ROW,
    rationale: weightRows("holder at common/scripted_loc.cwt:18"),
  },
  {
    registry: "section_template",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/section_templates.cwt:48 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "ship_size",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/ship_sizes.cwt:306 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "ship_size",
    field: "space_fauna_values.culling_value",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/ship_sizes.cwt:252 — ## cardinality = 0..inf",
    rationale:
      "A culling value is a resource-shaped block, and the rules let a fauna size declare " +
      "several; the sizes that declare any declare one. Same reading as the resources rows, one " +
      "level in.",
  },
  {
    registry: "situation_type",
    field: "approach.resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/situations.cwt:156 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "situation_type",
    field: "stages.section_weight.modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: MODIFIER_ROW,
    rationale: weightRows("holder at common/situations.cwt:241"),
  },
  {
    registry: "situation_type",
    field: "stages.triggered_target_modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/situations.cwt:276 — ## cardinality = 0..inf",
    rationale:
      "The stage copy of a key the situation type also declares 0..inf twice over " +
      "(situations.cwt:99 and :149), and shipped situations do write several at those other " +
      "levels. A stage writing one is the corpus being thin here, not the rule being wide.",
  },
  {
    registry: "solar_system_initializer",
    field: "moon.moon",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration:
      "common/solar_system_initializers.cwt:330 — alias_name[moon_initializer] = " +
      "alias_match_left[moon_initializer], which bounds nothing",
    rationale:
      "A moon may itself carry moons, and the recursion is an alias splice with no cardinality " +
      "to narrow. The shipped nesting has a single inner moon; a planet's moons at the " +
      "level above (:237) are the same splice and vanilla does repeat those.",
  },
  {
    registry: "solar_system_initializer",
    field: "planet.modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/solar_system_initializers.cwt:211 — ## cardinality = 0..inf",
    rationale:
      "A `<planet_modifier>` reference, and a planet may carry several — the rules say so in " +
      "the same breath as `modifiers = none` on the line above, which is the opt-out. The " +
      "shipped initializers name one modifier each.",
  },
  {
    registry: "solar_system_initializer",
    field: "usage",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/solar_system_initializers.cwt:35 — ## cardinality = 0..inf",
    rationale:
      "An initializer can be offered for several usages, and shipped initializers pick exactly " +
      "one of the enum. The repetition is how a system says it serves both, and no vanilla system " +
      "happens to.",
  },
  {
    registry: "special_project",
    field: "location",
    kind: "literal",
    evidence: ["Yes"],
    classification: "engine-lenient-spelling",
    rationale:
      "A boolean written `Yes` where the union declares `yes`. Stellaris reads yes/no without " +
      "regard to case, so the file is legal and the emitted `boolean` is the right authoring " +
      "surface — an SDK author writes `true` and the writer lowers it to `yes`. Nothing here " +
      "says CWT's `bool` is wrong.",
  },
  {
    registry: "species_class",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/species_consolidated.cwt:264 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "strike_craft_component_template",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/components.cwt:333 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "strike_craft_component_template",
    field: "size",
    kind: "literal",
    evidence: ["LARGE"],
    classification: "engine-lenient-spelling",
    rationale:
      "`LARGE` for the `large` the union declares — the same shouted spelling as " +
      "weapon_component_template.size's `extra_Large`, in a different file. The component slot " +
      "vocabulary is an enum the engine matches case-insensitively; the SDK's union spells each " +
      "member once, on purpose.",
  },
  {
    registry: "technology",
    field: "prereqfor_desc.component",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/technologies_consolidated.cwt:244 — ## cardinality = 0..4",
    rationale:
      "The prereq-for categories are declared as one `enum[prereq_for_category]` key repeated " +
      "up to four times, so every category inherits the same list arity. A technology that " +
      "describes a component describes one.",
  },
  {
    registry: "technology",
    field: "prereqfor_desc.diplo_action",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/technologies_consolidated.cwt:244 — ## cardinality = 0..4",
    rationale:
      "Same declaration as prereqfor_desc.component: one repeatable enum key covering every " +
      "category. A technology that describes a diplomatic action describes one.",
  },
  {
    registry: "technology",
    field: "prereqfor_desc.hide_prereq_for_desc",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/technologies_consolidated.cwt:242 — ## cardinality = 0..4",
    rationale:
      "A technology may hide the prereq-for line of up to four categories, and the ones that hide " +
      "any hide one. Four is the count of categories, so the bound is the rules being precise " +
      "rather than generous.",
  },
  {
    registry: "technology",
    field: "prereqfor_desc.ship",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/technologies_consolidated.cwt:244 — ## cardinality = 0..4",
    rationale:
      "Same declaration as its sibling categories. A technology that describes a ship " +
      "describes one.",
  },
  {
    registry: "tradition",
    field: "ai_weight.modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: MODIFIER_ROW,
    rationale: weightRows("holder at common/traditions.cwt:133"),
  },
  {
    registry: "tradition",
    field: "custom_tooltip_with_modifiers",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/traditions.cwt:81 — ## cardinality = 0..inf",
    rationale:
      "A tradition that writes a modifier tooltip writes one. The key sits under the same 0..inf as " +
      "the plain custom_tooltip beside it, which shipped traditions also write once — a pair of " +
      "lines is what the rules leave room for.",
  },
  {
    registry: "tradition",
    field: "tradition_swap.custom_tooltip",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/traditions.cwt:100 — ## cardinality = 0..inf",
    rationale:
      "The swap's copy of the tradition-level key, declared the same way and written once by " +
      "each swap that writes it.",
  },
  {
    registry: "tradition",
    field: "tradition_swap.custom_tooltip_with_modifiers",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/traditions.cwt:102 — ## cardinality = 0..inf",
    rationale:
      "The swap's copy of tradition.custom_tooltip_with_modifiers above, same rule and same " +
      "reading; the swaps that write it write one.",
  },
  {
    registry: "tradition",
    field: "tradition_swap.triggered_modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/traditions.cwt:125 — ## cardinality = 0..inf",
    rationale:
      "One condition and one modifier set per entry, so several entries is how a swap expresses " +
      "several cases. The swaps that use it have one case each; the tradition-level copy " +
      "(traditions.cwt:69) carries the same declaration.",
  },
  {
    registry: "utility_component_template",
    field: "hostile_aura",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/components.cwt:467 — ## cardinality = 0..inf",
    rationale:
      "An aura is a self-contained single_alias block, and a component projecting two is what " +
      "the rules leave open. Shipped utility components project one each.",
  },
  {
    registry: "utility_component_template",
    field: "resources",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/components.cwt:400 — ## cardinality = 0..inf",
    rationale: resourceRows(),
  },
  {
    registry: "utility_component_template",
    field: "triggered_ship_design_modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/components.cwt:433 — ## cardinality = 0..inf",
    rationale:
      "A triggered modifier clause per case, and the components using it have one case each. " +
      "The weapon subtype declares the identical key at components.cwt:220.",
  },
  {
    registry: "utility_component_template",
    field: "triggered_ship_modifier",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/components.cwt:430 — ## cardinality = 0..inf",
    rationale:
      "The sibling of triggered_ship_design_modifier above, same declaration and same reading; " +
      "the components that write it have one case each.",
  },
  {
    registry: "weapon_component_template",
    field: "on_hit",
    kind: "arity",
    evidence: [],
    classification: "rules-wider-than-vanilla",
    declaration: "common/components.cwt:328 — ## cardinality = 0..inf",
    rationale:
      "An effect clause per hit reaction, so a weapon with two reactions writes two. Shipped " +
      "weapons write one, which says nothing about whether a mod may write two.",
  },
  {
    registry: "weapon_component_template",
    field: "size",
    kind: "literal",
    evidence: ["extra_Large"],
    classification: "engine-lenient-spelling",
    rationale:
      "`extra_Large` for the `extra_large` the union declares. Same " +
      "engine leniency as strike_craft_component_template.size's `LARGE`, and the same answer: " +
      "the union is right and the file is legal.",
  },
];

/**
 * The `form` and `scope` mismatches that are real, understood, and not this
 * gate's to fix, each with the reason. Anything else fails.
 *
 * Every entry here is a field the SDK emits whose type and the shipped values
 * disagree: an author cannot write what vanilla writes, or — where an unpinned
 * trigger clause widened to `Trigger<never>` — can write it with nothing
 * checking it. Unlike {@link OBSERVATIONS}, these are acknowledged defects
 * rather than classified legality, so they carry no evidence to compare: a row
 * exists or the gate fails, and a row whose defect was fixed fails the other
 * way.
 *
 * {@link AcknowledgedFamily} names the four shapes they come in, none of them a
 * misreading the emitter could fix on its own.
 */
export type AcknowledgedFamily =
  /**
   * The corpus writes a form CWT does not declare. Inventing an arm the rules
   * deny would be guessing at game semantics from one shipped file.
   */
  | "rules-omit-form"
  /**
   * Two declarations whose arms are indistinguishable. A dual dispatches on what
   * the author passed, so two arms that both author as arrays cannot be told
   * apart. See `lowerDual`.
   */
  | "indistinguishable-arms"
  /**
   * A scope the rules pin and the corpus contradicts, on evidence too thin to
   * overrule them. Asserting over a stated scope is a stronger claim than
   * filling in an omitted one, and needs more than a couple of definitions.
   */
  | "pinned-scope-contradicted"
  /**
   * A field CWT scopes `any` whose legal set is not settled. The fix is a scope
   * the definition supplies (`CONTENT_SCOPE_PARAMETERS`, which `decision` now
   * uses), and a row there needs the same evidence any assertion does. Once one
   * exists the gate stops acknowledging and starts checking: it asks whether the
   * declared set covers what the corpus writes.
   */
  | "unsettled-any-scope";

export interface AcknowledgedMismatch {
  readonly registry: string;
  readonly field: string;
  readonly kind: Extract<ConformanceMismatchKind, "form" | "scope">;
  readonly family: AcknowledgedFamily;
  readonly rationale: string;
}

export const ACKNOWLEDGED_MISMATCHES: readonly AcknowledgedMismatch[] = [
  {
    registry: "bombardment_stance",
    field: "planet_damage.modifier",
    kind: "scope",
    family: "pinned-scope-contradicted",
    rationale:
      "The one row here where the rules do state a scope and the corpus disagrees. " +
      "bombardment_stances.cwt:50 pins the block `## replace_scopes = { root = fleet " +
      "this = fleet from = planet }`, and 2 of the 13 shipped stances gate a weight row on " +
      "`planet_devastation`, which cwtools scopes to the planet family (carrier/colony/planet/" +
      "ship). Two readings fit: cwtools' trigger list is missing fleet, or the rows really do " +
      "evaluate planet-side and the game resolves it through the declared FROM. Two definitions " +
      "cannot settle which, and an overlay assertion overruling a scope the rules state — as " +
      "opposed to filling in one they omit, which is what the three ai_weight rows do — needs " +
      "more than that.",
  },
  {
    registry: "economic_category",
    field: "triggered_cost_modifier.trigger",
    kind: "scope",
    family: "unsettled-any-scope",
    rationale:
      "CWT annotates no scope, so the clause lowers to `Trigger<never>` — writable but unchecked. " +
      "The category's modifiers are evaluated against whatever is paying, and the corpus shows " +
      "the game itself branching on that: `is_scope_valid` appears in all four definitions " +
      "writing this clause, guarding ship conditions (is_ship_class, is_ship_size, " +
      "is_space_fauna, has_ship_owner_type) against a scope that may not be one. That is the " +
      "SDK-24 narrowing case, not a declaration — the same finding as " +
      "ship_size.potential_construction below.",
  },
  {
    registry: "economic_category",
    field: "triggered_produces_modifier.trigger",
    kind: "scope",
    family: "unsettled-any-scope",
    rationale:
      "Same declaration and same finding as triggered_cost_modifier above " +
      "(single_alias[economic_category_triggered_modifier], economic_categories.cwt:76-87). " +
      "Its 13 definitions spread wider still — ship category, specimen category, planet, and " +
      "species traits — which is what an unannotated clause evaluated per consumer looks like.",
  },
  {
    registry: "economic_category",
    field: "triggered_upkeep_modifier.trigger",
    kind: "scope",
    family: "unsettled-any-scope",
    rationale:
      "Same declaration and same finding as its two siblings above. Its 10 definitions divide by " +
      "consumer rather than mixing: one writes only ship conditions, another only pop " +
      "(has_trait, is_robot_pop_group, is_unemployed), a third only `exists = planet`.",
  },
  {
    registry: "global_ship_design",
    field: "upgrades_to",
    kind: "form",
    family: "rules-omit-form",
    rationale:
      "CWT declares the scalar form only; one space-whale design writes a two-element block anyway. " +
      "An upstream rules gap rather than a misreading — the SDK should not invent an arm the " +
      "rules do not declare.",
  },
  {
    registry: "scripted_loc",
    field: "text.trigger",
    kind: "scope",
    family: "unsettled-any-scope",
    rationale:
      "A scripted localization is rendered wherever its key is referenced, so its condition runs " +
      "in whatever scope did the referencing — genuinely any, and CWT is right to annotate " +
      "none. The corpus is the same shape: 1072 definitions across 206 distinct condition sets, " +
      "spanning country, species, planet and variable scopes. Nothing to declare; SDK-24's " +
      "narrowing inside the clause is the only remedy.",
  },
  {
    registry: "scripted_loc",
    field: "text.weight.modifier",
    kind: "scope",
    family: "unsettled-any-scope",
    rationale:
      "The weight sibling of the row above, and the same finding one field over: a scripted " +
      "localization is rendered wherever its key is referenced, so the conditions gating its " +
      "weight rows run in whatever scope did the referencing. The 5 definitions that gate a " +
      "weight row are the same shape as the 1072 that gate the text — country and species " +
      "conditions (`has_ethic`, `has_trait`) in separate definitions, no single scope to " +
      "declare. SDK-24's narrowing inside the clause is the remedy for both.",
  },
  {
    registry: "ship_size",
    field: "potential_construction",
    kind: "scope",
    family: "unsettled-any-scope",
    rationale:
      "The widened `Trigger<never>` is the right type and the clause needs narrowing inside it, " +
      "not a declaration: one ship size's construction clause is evaluated against several scope " +
      "types and vanilla branches on which, testing `is_scope_type` 13 times across these " +
      "clauses " +
      "(zero shipped decisions do, which is why a scope parameter fit there and not here). " +
      "SDK-24 tracks the `inScope` combinator; it waits on SDK-13, since most bodies here " +
      "delegate to vanilla scripted triggers the SDK cannot name yet.",
  },
  {
    registry: "ship_size",
    field: "triggered_ship_roles.trigger",
    kind: "scope",
    family: "unsettled-any-scope",
    rationale:
      "The wrapped struct one level inside the field above, and the same registry's finding: a " +
      "scope parameter does not fit ship_size. Its 43 definitions do write one coherent " +
      "country-scope set (OR, has_technology, has_battleship_cloaking_tech), so a `scope` " +
      "assertion is not ruled out the way the sibling clauses' are — but which country the " +
      "role is evaluated for is exactly what the rules decline to state, and an assertion here " +
      "would be read off the corpus alone. SDK-24.",
  },
  {
    registry: "situation_type",
    field: "picture",
    kind: "form",
    family: "indistinguishable-arms",
    rationale:
      "Declared twice, as a bare <sprite> and as a trigger+picture block — but both declarations " +
      "carry `cardinality = 0..inf`, so both arms author as arrays and the writer could not tell " +
      "which one a value belongs to. `title` and `desc` dual cleanly because their scalar arm is " +
      "`0..1`. An `arity` assertion cannot help: it would narrow the block arm too, and the block " +
      "form really does repeat.",
  },
];

/** `registry.field kind`, the spelling both tables and every message use. */
export function shapeKey(row: {
  readonly registry: string;
  readonly field: string;
  readonly kind: string;
}): string {
  return `${row.registry}.${row.field} ${row.kind}`;
}

/** Sort order for both tables and every list of lines: registry, field, kind. */
function compareRows(
  a: { registry: string; field: string; kind: string },
  b: { registry: string; field: string; kind: string }
): number {
  return (
    compareUtf8(a.registry, b.registry) ||
    compareUtf8(a.field, b.field) ||
    compareUtf8(a.kind, b.kind)
  );
}

/** `[a b c]`, sorted, for a message that has to show two evidence lists side by side. */
function renderEvidence(evidence: readonly string[]): string {
  return `[${[...evidence].sort(compareUtf8).join(" ")}]`;
}

/** Whether two evidence lists say the same thing. Order is not significant. */
function sameEvidence(a: readonly string[], b: readonly string[]): boolean {
  return renderEvidence(a) === renderEvidence(b);
}

/** `  ! <key>: <problem>` — a row that cannot be trusted to classify anything. */
function validate(baseline: readonly ClassifiedObservation[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  baseline.forEach((row, index) => {
    const key = shapeKey(row);
    const say = (problem: string): void => void lines.push(`  ! ${key}: ${problem}`);
    if (seen.has(key)) {
      say("duplicate row");
    }
    seen.add(key);
    const previous = baseline[index - 1];
    if (previous !== undefined && compareRows(previous, row) >= 0) {
      say("out of order — sort rows by registry, field, kind");
    }
    if (row.rationale.trim() === "") {
      say("no rationale");
    }
    const answers = CLASSIFICATION_KIND[row.classification];
    if (answers !== row.kind) {
      say(`${row.classification} classifies a ${answers} observation, not a ${row.kind} one`);
    }
    if (NEEDS_ISSUE.has(row.classification) && (row.issue ?? "").trim() === "") {
      say(`${row.classification} names work, so it needs the Linear issue that will do it`);
    }
    if (row.kind === "arity" && (row.declaration ?? "").trim() === "") {
      say(`${row.classification} cites no CWT declaration`);
    }
  });
  return lines;
}

/**
 * Every way the measured observations and the committed baseline disagree, as
 * lines a maintainer can act on. Empty means the baseline holds.
 *
 * Three movements fail, and each means something different. A `+` is an
 * observation nobody has classified — the game, the rules, or the emitter
 * changed, and which of those it was is the question the row has to answer. A
 * `-` is a row whose observation stopped happening, so the classification is now
 * describing nothing. A `~` is the subtle one: the same field, still observed,
 * with different values behind it — a second stray spelling under a row written
 * for the first.
 */
export function compareObservations(
  observed: readonly ObservedShape[],
  baseline: readonly ClassifiedObservation[] = OBSERVATIONS
): readonly string[] {
  const lines = validate(baseline);
  const rows = new Map(baseline.map((row) => [shapeKey(row), row]));
  const measured = new Map<string, ObservedShape>();
  for (const one of [...observed].sort(compareRows)) {
    const key = shapeKey(one);
    if (measured.has(key)) {
      // Two emitted fields sharing one dotted path in one registry. Silently
      // keeping the first would let the second's evidence go unreviewed.
      lines.push(`  ! ${key}: duplicate observation — two emitted fields share this path`);
      continue;
    }
    measured.set(key, one);
  }

  const added: string[] = [];
  const changed: string[] = [];
  for (const [key, one] of measured) {
    const row = rows.get(key);
    if (row === undefined) {
      added.push(`  + ${key}: new observation — classify it in corpus-observations.ts`);
    } else if (!sameEvidence(row.evidence, one.evidence)) {
      changed.push(
        `  ~ ${key}: evidence ${renderEvidence(row.evidence)} -> ` +
          `${renderEvidence(one.evidence)} — re-review the row and update it`
      );
    }
  }
  const removed = [...rows.keys()]
    .filter((key) => !measured.has(key))
    .map(
      (key) =>
        `  - ${key}: no longer observed — remove the row, unless its registry's fixture ` +
        "failed to load"
    );

  return [...lines, ...added, ...removed, ...changed];
}

/**
 * A row for a new observation, ready to paste — and deliberately not ready to
 * commit.
 *
 * `TODO-classify` is not an {@link ObservationClass}, so a pasted stub fails
 * `npm run typecheck` until somebody picks one, and the empty `rationale` fails
 * the gate after that. Bootstrapping ergonomics without an auto-absorb path.
 */
export function observationStub(observed: ObservedShape): string {
  const evidence = [...observed.evidence]
    .sort(compareUtf8)
    .map((value) => JSON.stringify(value))
    .join(", ");
  return [
    "  {",
    `    registry: ${JSON.stringify(observed.registry)},`,
    `    field: ${JSON.stringify(observed.field)},`,
    `    kind: ${JSON.stringify(observed.kind)},`,
    `    evidence: [${evidence}],`,
    `    classification: "TODO-classify",`,
    ...(observed.kind === "arity" ? ['    declaration: "<file.cwt:line — ## cardinality>",'] : []),
    '    rationale: "",',
    "  },",
  ].join("\n");
}
