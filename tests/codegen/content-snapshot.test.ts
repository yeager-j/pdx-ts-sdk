import { describe, expect, it } from "vitest";

import { CONTENT_MANIFEST } from "../../tools/codegen/content-manifest.ts";
import type { CwtDiagnostic } from "../../tools/codegen/cwt/parser.ts";
import { loadRules } from "../../tools/codegen/cwt/rules.ts";
import driftBaseline from "../../tools/codegen/drift-baseline.json" with { type: "json" };
import { emitContentType } from "../../tools/codegen/emit/content-type.ts";
import { Emitter } from "../../tools/codegen/emit/types.ts";

function describeDiagnostic(diagnostic: CwtDiagnostic): string {
  return `${diagnostic.file}:${diagnostic.line} ${diagnostic.text}`;
}

const rules = loadRules("vendor/cwtools-stellaris-config/config");
const emitter = new Emitter(rules);
const emissions = new Map(
  CONTENT_MANIFEST.map((manifest) => {
    const type = rules.contentTypes.get(manifest.type);
    const body = rules.bodies.get(manifest.type);
    if (type === undefined || body === undefined) {
      throw new Error(`Missing fixture rules for ${manifest.type}`);
    }
    // Keyed by registry, not CWT type: three keywords share
    // type[component_template] and each is its own registry.
    const registry = (manifest as { as?: string }).as ?? manifest.type;
    emitter.beginFile();
    const emission = emitContentType(emitter, type, body, registry);
    emitter.endFile();
    return [registry, emission] as const;
  })
);

describe("content-type codegen", () => {
  it("parses every manifest source without recovery", () => {
    const manifestSources = new Set<string>(CONTENT_MANIFEST.map((entry) => entry.source));
    // common/governments.cwt and common/economic_categories.cwt each carry an
    // upstream `## default: no` malformed-option typo (SDK-2). Those three are
    // deliberately recorded in the drift baseline rather than fixed upstream,
    // so they are the only diagnostics this check lets through — anything else
    // in a manifest source is still a hard failure.
    const knownMalformedOptions = new Set(driftBaseline.malformedOptions);
    expect(
      rules.diagnostics
        .filter((diagnostic) => manifestSources.has(diagnostic.file))
        .filter((diagnostic) => !knownMalformedOptions.has(describeDiagnostic(diagnostic)))
    ).toEqual([]);
  });

  it("reports what it cannot lower rather than dropping it", () => {
    // Under emit-everything, an unlowerable field is the machinery backlog, not
    // an error — but it must stay visible in the report either way.
    for (const manifest of CONTENT_MANIFEST) {
      const registry = (manifest as { as?: string }).as ?? manifest.type;
      const emission = emissions.get(registry)!;
      for (const line of emission.unsupported) {
        expect(emission.machineryBacklog.join("\n"), registry).toContain(line.split(" (")[0]!);
      }
    }
  });

  it("carries a registry's body scope into trigger fields", () => {
    expect(emissions.get("building")?.code).toContain('allow?: Trigger<"colony">;');
    expect(emissions.get("building")?.code).toContain('potential?: Trigger<"colony">;');
  });

  it("emits repeated-struct definitions as data-driven field tables", () => {
    const tradition = emissions.get("tradition");
    expect(tradition?.code).toContain("export interface TraditionSwapFields");
    expect(tradition?.code).toContain('shape: "repeatedStruct"');
    expect(tradition?.code).toContain('keying: "siblings"');
    expect(tradition?.code).toContain("fields: TRADITION_SWAP_FIELDS");
    expect(tradition?.code).toContain("traditionSwap?: Readonly<Record<Id, TraditionSwapFields>>;");
  });

  it("infers reusable effect closures with the content body's scope", () => {
    const agenda = emissions.get("agenda");
    expect(agenda?.code).toContain('initEffect?: EffectBlock<"country">;');
    expect(agenda?.code).toContain('effect?: EffectBlock<"country">;');
    expect(agenda?.code).toContain('shape: "effect"');
    expect(emissions.get("ascension_perk")?.code).toContain('onEnabled?: EffectBlock<"country">;');
  });

  it("carries each modifier field's scope into its recorder closure", () => {
    expect(emissions.get("building")?.code).toContain(
      'planetModifier?: ModifierClosure<"colony">;'
    );
    expect(emissions.get("tradition")?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(emissions.get("agenda")?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(emissions.get("edict")?.code).toContain(
      'relayNetworkModifier?: ModifierClosure<"country">;'
    );
  });

  it("emits reusable economic and triggered-modifier blocks", () => {
    const edict = emissions.get("edict");
    expect(edict?.code).toContain('resources?: EconomicResourceBlock<"country">[];');
    expect(edict?.code).toContain('triggeredCountryModifier?: TriggeredModifier<"country">[];');
    expect(edict?.code).toContain('shape: "economicResources"');
    expect(edict?.code).toContain('shape: "triggeredModifierBlock"');
    expect(edict?.code).toContain("isWartimeEdict?: true;");
    expect(emissions.get("ascension_perk")?.code).toContain(
      'triggeredModifier?: TriggeredModifier<"country">[];'
    );
  });

  it("generates ascension perks and their swaps without registry-specific code", () => {
    const perk = emissions.get("ascension_perk");
    expect(perk?.code).toContain("export interface AscensionPerkDef");
    expect(perk?.code).toContain("export interface AscensionPerkSwapFields");
    expect(perk?.code).toContain('potential?: Trigger<"country">;');
    expect(perk?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(perk?.code).toContain('shape: "repeatedStruct"');
  });

  it("collapses duplicate localization patterns without hiding them", () => {
    const agenda = emissions.get("agenda");
    expect(agenda?.code).toContain("name: string;");
    expect(agenda?.code).toContain("desc?: string;");
    expect(agenda?.code).not.toContain("councilAgendaName");
    expect(agenda?.localisationAliases).toEqual([
      "agenda.localisation.council_agenda_name (council_agenda_$_name) duplicates name at council_agenda_$_name",
      "agenda.localisation.council_agenda_desc (council_agenda_$_desc) duplicates desc at council_agenda_$_desc",
    ]);
  });

  it("excludes localization patterns with no $ id placeholder rather than emit an unusable member", () => {
    const job = emissions.get("job");
    expect(job?.code).toContain("name: string;");
    expect(job?.code).toContain("desc?: string;");
    // Only one `desc` member survives on JobFields itself even though the rules
    // declare it twice — struct-shaped fields nested elsewhere in the file (like
    // swappable_data's own `desc`) are unrelated members and legitimately reuse
    // the name, so the check is scoped to the top-level interface body.
    const jobFieldsBody = job?.code?.match(/export interface JobFields \{([\s\S]*?)\n\}/)?.[1];
    expect(jobFieldsBody?.match(/\bdesc\??: string;/g)).toHaveLength(1);
    // The excluded patterns point at swappable_data's own `desc`/`condition_string`
    // body fields — struct lowering now expresses those as ordinary members on
    // JobSwappableDataDefault, an unrelated field the loc-alias exclusion above
    // does not (and should not) suppress.
    expect(job?.code).toContain("conditionString?: string;");
    expect(job?.localisationAliases).toEqual([
      "job.localisation.desc (swappable_data/default/desc) has no `$` id placeholder — " +
        "not a static <id>-keyed slot, excluded",
      "job.localisation.condition_string (swappable_data/default/condition_string) has no " +
        "`$` id placeholder — not a static <id>-keyed slot, excluded",
    ]);
  });

  it("generates decisions and jobs without registry-specific code", () => {
    const decision = emissions.get("decision");
    expect(decision?.code).toContain("export interface DecisionDef");
    expect(decision?.code).toContain("resources?: EconomicResourceBlock<ScopeName>[];");
    expect(decision?.code).toContain("prerequisites?: (TechnologyRef | string)[];");
    expect(decision?.code).toContain('shape: "economicResources"');

    const job = emissions.get("job");
    expect(job?.code).toContain("export interface JobDef");
    expect(job?.code).toContain('possible?: Trigger<"pop_group">;');
    expect(job?.code).toContain('countryModifier?: ModifierClosure<"country">;');
    expect(job?.code).toContain('planetModifier?: ModifierClosure<"colony">;');
    expect(job?.code).toContain('resources?: EconomicResourceBlock<"colony">[];');
    expect(job?.code).toContain('triggeredCountryModifier?: TriggeredModifier<"country">[];');
  });

  it("emits every field the emitter can express", () => {
    // The SDK's promise is that an author does not run out of API, so the only
    // reasons a field is absent are mechanical (the emitter cannot lower it) or
    // an explicit refusal. There is no third "not reviewed yet" state.
    for (const registry of ["building", "technology", "job"] as const) {
      const emission = emissions.get(registry)!;
      const accounted = new Set([
        ...emission.emittedFields.map((field) => `${registry}.${field}`),
        ...emission.declinedFields.map((line) => line.split(" — ")[0]!),
        ...emission.machineryBacklog,
      ]);
      for (const field of emission.machineryBacklog) {
        expect(accounted.has(field), field).toBe(true);
      }
      expect(emission.emittedFields.length, registry).toBeGreaterThan(0);
    }
    // building was capped at 18 curated fields; emitting everything expressible
    // roughly doubles it.
    expect(emissions.get("building")!.emittedFields.length).toBeGreaterThan(30);
  });

  it("honours an explicit refusal, with its reason", () => {
    const job = emissions.get("job")!;
    expect(job.emittedFields).not.toContain("auto_generate_description");
    expect(job.declinedFields.join("\n")).toContain("boolean[]");
  });

  it("emits fields the curated list used to withhold", () => {
    // Each of these lowers cleanly and was absent only because nobody had
    // written it down. decision.sound in particular is set by 66 shipped
    // decisions, so withholding it broke porting for no reason.
    expect(emissions.get("building")!.emittedFields).toContain("on_built");
    expect(emissions.get("building")!.emittedFields).toContain("on_destroy");
    expect(emissions.get("decision")!.emittedFields).toContain("sound");
  });

  it("generates casus_belli and war_goal without registry-specific code", () => {
    const casusBelli = emissions.get("casus_belli");
    expect(casusBelli?.code).toContain("export interface CasusBelliDef");
    expect(casusBelli?.code).toContain("proxyWarResources?: EconomicResourceBlock<ScopeName>[];");
    expect(casusBelli?.code).toContain('shape: "economicResources"');

    const warGoal = emissions.get("war_goal");
    expect(warGoal?.code).toContain("export interface WarGoalDef");
    expect(warGoal?.code).toContain("casusBelli: CasusBelliRef | string;");
    expect(warGoal?.code).toContain('aiWeight?: WeightBlock<"country">;');
    // forbidden_peace_offers is a fixed-shape anonymous block — the same struct
    // shape shape 3 generalizes down to cardinality 0..1 — so it is no longer
    // stuck on the machinery backlog.
    expect(warGoal?.code).toContain("forbiddenPeaceOffers?: WarGoalForbiddenPeaceOffers;");
    expect(warGoal?.code).toContain('shape: "struct"');
    expect(warGoal?.machineryBacklog.join("\n")).not.toContain("forbidden_peace_offers");
  });

  it("accepts both forms of a dual bare/modifier_rule declaration", () => {
    // bombardment_stance.planet_damage and archaeological_site_type.weight are each
    // declared twice — once as a bare number, once as a modifier_rule block. Picking
    // either alone is wrong in one direction (vanilla writes the scalar form almost
    // exclusively; the block form carries the gated adjustments), so the group lowers
    // to the union and the writer dispatches on what the author passes.
    const bombardmentStance = emissions.get("bombardment_stance");
    expect(bombardmentStance?.code).toContain('planetDamage?: number | WeightBlock<"fleet">;');
    // A pure modifier_rule splice needs no overlay row either — it infers weightBlock.
    expect(bombardmentStance?.code).toContain('aiWeight: WeightBlock<"fleet">;');

    const archaeologicalSiteType = emissions.get("archaeological_site_type");
    expect(archaeologicalSiteType?.code).toContain('weight?: number | WeightBlock<"planet">;');
  });

  it("lowers repeated siblings with no id (shape 3) as an anonymous struct list", () => {
    // scripted_loc.text: `text = { trigger = { ... } localization_key = ... }`
    // written N times as siblings, exactly the settled shape 3 example.
    const scriptedLoc = emissions.get("scripted_loc");
    expect(scriptedLoc?.code).toContain("export interface ScriptedLocText");
    expect(scriptedLoc?.code).toContain("text?: ScriptedLocText[];");
    expect(scriptedLoc?.code).toContain('{ key: "text", member: "text", shape: "struct"');
    expect(scriptedLoc?.machineryBacklog.join("\n")).not.toContain("text");

    // archaeological_site_type.stage: the same shape, order-dependent siblings.
    const archaeologicalSiteType = emissions.get("archaeological_site_type");
    expect(archaeologicalSiteType?.code).toContain("export interface ArchaeologicalSiteTypeStage");
    expect(archaeologicalSiteType?.code).toContain("stage?: ArchaeologicalSiteTypeStage[];");
  });

  it("generalizes the same struct shape down to a singular fixed-shape block", () => {
    // war_goal.forbidden_peace_offers has no id and cardinality 0..1 — the N=0..1
    // case of the same anonymous-struct mechanism as shape 3, not a fourth shape.
    const warGoal = emissions.get("war_goal");
    expect(warGoal?.code).toContain("export interface WarGoalForbiddenPeaceOffers");
    expect(warGoal?.code).toContain("demandSurrender?: string;");
    expect(warGoal?.code).not.toContain("forbiddenPeaceOffers?: WarGoalForbiddenPeaceOffers[];");
  });

  it("lowers CWT's wrapped bare-block spelling of a repeated struct", () => {
    // agreement_preset.term_data.discrete_terms declares its repetition as a bare
    // anonymous block cardinality inside a singular wrapper field, rather than by
    // repeating a named field directly — a second CWT spelling of shape 3.
    const agreementPreset = emissions.get("agreement_preset");
    expect(agreementPreset?.code).toContain("export interface AgreementPresetTermData");
    expect(agreementPreset?.code).toContain("termData: AgreementPresetTermData;");
    expect(agreementPreset?.code).toContain(
      "export interface AgreementPresetTermDataDiscreteTerms"
    );
    expect(agreementPreset?.code).toContain(
      "discreteTerms?: AgreementPresetTermDataDiscreteTerms[];"
    );
    expect(agreementPreset?.code).toContain("wrapped: true");
    expect(agreementPreset?.machineryBacklog.join("\n")).not.toContain("term_data");
  });

  it("generates situations' stages (container keying) and approach (siblings keying)", () => {
    // situations is repeated-struct's first "container" consumer: stages =
    // { stage_1 = { ... } } keys each entry by its own block key rather than a
    // body field, distinct from approach's siblings shape (tradition_swap's
    // shape) which carries its id in a body field ("name").
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain("export interface SituationStageFields");
    expect(situation?.code).toContain('shape: "repeatedStruct"');
    expect(situation?.code).toContain('keying: "container"');
    expect(situation?.code).toContain("fields: SITUATION_STAGE_FIELDS");
    expect(situation?.code).toContain("stages?: Readonly<Record<Id, SituationStageFields>>;");
    // "container" keying carries no identityKey member in its metadata — the
    // record key IS the block's own key, not a body field.
    expect(situation?.code).not.toMatch(/keying: "container"[^}]*identityKey/);

    expect(situation?.code).toContain("export interface SituationApproachFields");
    expect(situation?.code).toContain('keying: "siblings"');
    expect(situation?.code).toContain('identityKey: "name"');
    expect(situation?.code).toContain("fields: SITUATION_APPROACH_FIELDS");
    expect(situation?.code).toContain("approach?: Readonly<Record<Id, SituationApproachFields>>;");
  });

  it("falls back to the identity-localisation convention when no CWT type carries it", () => {
    // Neither stages nor approach has a vendored type[...] the way
    // tradition_swap borrows type[swapped_tradition] — CWT only ever types the
    // identity value itself as `localisation` inline. 99_README_SITUATIONS.txt
    // documents the same convention regardless: the key/name is required
    // localised text, with an optional `<key>_desc`.
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain(
      "export const SITUATION_STAGE_LOCALISATION: readonly ContentLocalisation[] = [\n" +
        '  { member: "name", pattern: "$", required: true },\n' +
        '  { member: "desc", pattern: "$_desc", required: false },\n' +
        "];"
    );
    expect(situation?.code).toContain(
      "export const SITUATION_APPROACH_LOCALISATION: readonly ContentLocalisation[] = [\n" +
        '  { member: "name", pattern: "$", required: true },\n' +
        '  { member: "desc", pattern: "$_desc", required: false },\n' +
        "];"
    );
  });

  it("lowers situation fields nested inside stages and approach without registry-specific code", () => {
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(situation?.code).toContain('onSelect?: EffectBlock<"situation">;');
    expect(situation?.code).toContain('resources?: EconomicResourceBlock<"situation">[];');
    expect(situation?.code).toContain('onFirstEnter?: EffectBlock<"situation">;');
  });

  it("accepts both forms of situations' dual declarations, including inside stages", () => {
    // total_progress, and stages' end/section_weight, are each declared twice
    // — once as a bare (malformed, in total_progress's case) scalar, once as a
    // modifier_rule block. Vanilla writes `end = 100` 254 times against 1
    // block, so typing away the scalar form was the wrong prescription: the
    // group lowers to the union, recurring inside a repeated-struct field too.
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain('totalProgress?: number | WeightBlock<"situation">;');
    expect(situation?.code).toContain('end?: number | WeightBlock<"situation">;');
    expect(situation?.code).toContain('sectionWeight?: number | WeightBlock<"situation">;');
  });

  it("merges a field declared as different literals across subtypes into the union", () => {
    // progress_direction is `monodirectional` in one subtype declaration and
    // `bidirectional` in the other; first-wins picking had made the second —
    // and the two fields it gates — unreachable through the typed API.
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain('progressDirection?: "monodirectional" | "bidirectional";');
    expect(situation?.code).toContain("completeCategory?: SituationCategory;");
  });

  it("renames a struct field that would collide with a localization member name", () => {
    // building.desc (`single_alias_right[triggered_desc_clause]`, a repeated
    // trigger+text struct) would otherwise duplicate the `desc` flavor-text
    // member the type's own localisation table already claims, so the overlay
    // renames its authoring member while the emitted key stays `desc`.
    const building = emissions.get("building");
    expect(building?.code).toContain("conditionalDesc?: BuildingDesc[];");
    expect(building?.code).toContain('{ key: "desc", member: "conditionalDesc", shape: "struct"');
    expect(building?.unsupported.join("\n")).not.toContain("localization slot");
    // triggered_desc is the building's own distinct key and keeps its member.
    expect(building?.code).toContain("export interface BuildingTriggeredDesc");
    expect(building?.code).toContain("triggeredDesc?: BuildingTriggeredDesc[];");

    // situations' desc is also declared as a bare localisation scalar, which
    // the slot already covers — the overlay pins the struct form.
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain("conditionalDesc?: SituationTypeDesc[];");
  });

  it("expands an all-scalar alias splice into an ordinary struct", () => {
    // job.possible_pre_triggers splices `pop_pre_trigger`, whose seven members
    // are every one a plain bool. Naming them turns the splice into something
    // the existing struct pipeline emits — and keeps it from becoming a
    // Trigger, which the game does not read in this position.
    const job = emissions.get("job");
    expect(job?.code).toContain("export interface JobPossiblePreTriggers {");
    expect(job?.code).toContain("possiblePreTriggers?: JobPossiblePreTriggers;");
    for (const member of [
      "hasOwner",
      "isEnslaved",
      "isBeingPurged",
      "isBeingAssimilated",
      "hasPlanet",
      "isSapient",
      "isRobotic",
    ]) {
      expect(job?.code, member).toContain(`  ${member}?: boolean;\n`);
    }
    expect(job?.code).toContain(
      '{ key: "has_owner", member: "hasOwner", shape: "value", conversion: "identity" }'
    );
    expect(job?.code).toContain(
      '{ key: "possible_pre_triggers", member: "possiblePreTriggers", shape: "struct", ' +
        "fields: JOB_POSSIBLE_PRE_TRIGGERS_FIELDS }"
    );
    expect(job?.emittedFields).toContain("possible_pre_triggers");
    expect(job?.unsupported.join("\n")).not.toContain("possible_pre_triggers");
    expect(job?.machineryBacklog.join("\n")).not.toContain("possible_pre_triggers");
  });

  it("lowers random_events' computed weight keys as a weighted event list", () => {
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain(
      "randomEvents?: readonly { weight: number; event?: EventScopelessRef | string | EventSituationRef }[];"
    );
    expect(situation?.code).toContain(
      '{ key: "random_events", member: "randomEvents", shape: "weightedEvents", conversion: "ref" }'
    );
    expect(situation?.unsupported.join("\n")).not.toContain("random_events");
  });

  it("generates councilor without registry-specific code", () => {
    // Blocked purely by the governments.cwt malformed-option drift block
    // (SDK-2); councilor's own fields are ordinary.
    const councilor = emissions.get("councilor");
    expect(councilor?.code).toContain("export interface CouncilorDef");
    expect(councilor?.code).toContain('possible?: Trigger<"country">;');
    expect(councilor?.code).toContain('isLeaderPossible?: Trigger<"leader">;');
    expect(councilor?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(councilor?.code).toContain('triggeredCountryModifier?: TriggeredModifier<"country">[];');
    expect(councilor?.machineryBacklog).toEqual([]);
  });
});
