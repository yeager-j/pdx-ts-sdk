import { readFileSync } from "node:fs";
import { CONTENT_MANIFEST, type ContentManifestEntry } from "@pdx-ts/codegen-cwt/content-manifest";
import type { CwtDiagnostic } from "@pdx-ts/codegen-cwt/cwt/parser";
import { loadRules } from "@pdx-ts/codegen-cwt/cwt/rules";
import driftBaseline from "@pdx-ts/codegen-cwt/drift-baseline.json" with { type: "json" };
import { emitAliasSplice } from "@pdx-ts/codegen-cwt/emit/alias-splice";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content-type";
import type { EmittedField } from "@pdx-ts/codegen-cwt/emit/fields";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { pascalCase } from "@pdx-ts/codegen-cwt/naming";
import {
  CONTENT_DECLINED_FIELDS,
  HAND_WRITTEN_CONTENT_DEFINERS,
} from "@pdx-ts/codegen-cwt/overlay";
import { describe, expect, it } from "vitest";

function describeDiagnostic(diagnostic: CwtDiagnostic): string {
  return `${diagnostic.file}:${diagnostic.line} ${diagnostic.text}`;
}

/** Just the names: the emitter now describes each field's lowered shape too. */
function fieldNames(fields: readonly EmittedField[]): string[] {
  return fields.map((field) => field.field);
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
    expect(tradition?.code).toContain(
      "traditionSwap?: Readonly<Record<string, TraditionSwapFields>>;"
    );
  });

  it("keys a repeated-struct record by string, not by the owner's id type", () => {
    // A nested id is its own name (`othermod_swap`), unrelated to the
    // definition that contains it. Reusing the owner's `Id` for the key only
    // ever looked sound under the class API's wide `PrefixedId<P>`, where both
    // sides were the same pattern; against the literal id the pure API's
    // definers preserve, it demanded every swap key equal the tradition's id.
    // Nothing references `Id` inside the Fields interface any more, so it
    // carries no type parameter either — only `XDef` is generic in the id.
    for (const registry of ["tradition", "ascension_perk", "situation_type"] as const) {
      const code = emissions.get(registry)!.code;
      expect(code, registry).not.toContain("Record<Id,");
      expect(code, registry).not.toMatch(/export interface \w+Fields<Id/);
    }
    expect(emissions.get("tradition")!.code).toContain("export interface TraditionFields {");
    expect(emissions.get("tradition")!.code).toContain(
      "export interface TraditionDef<Id extends string = string> extends TraditionFields {"
    );
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
    // SDK-56: building's plain modifier trio, each field-level
    // `replace_scopes` (buildings.cwt:212/215/218) carried into its own
    // scope rather than falling back to building's body scope (colony).
    expect(emissions.get("building")?.code).toContain(
      'countryModifier?: ModifierClosure<"country">;'
    );
    expect(emissions.get("building")?.code).toContain('armyModifier?: ModifierClosure<"army">;');
    expect(emissions.get("building")?.code).toContain(
      'systemModifier?: ModifierClosure<"system">;'
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
    // SDK-56: building's triggered modifier trio all splice
    // triggered_modifier_by_planet_clause (aliases.cwt:113), which reuses
    // the plain triggeredModifierBlock shape building.triggered_planet_modifier
    // (SDK-39) already proved out — push_scope is not part of the emitted
    // shape, only the field-level `replace_scopes` scope parameter is.
    expect(emissions.get("building")?.code).toContain(
      'triggeredCountryModifier?: TriggeredModifier<"country">[];'
    );
    expect(emissions.get("building")?.code).toContain(
      'triggeredArmyModifier?: TriggeredModifier<"army">[];'
    );
    expect(emissions.get("building")?.code).toContain(
      'triggeredPlanetPopGroupModifierForAll?: TriggeredModifier<"pop_group">[];'
    );
    // SDK-56: the seventh field, caught in review — for_species splices
    // triggered_modifier_by_pop_group_clause, not the by_planet_clause the
    // other three splice, but reuses the same triggeredModifierBlock shape
    // job.triggered_planet_pop_group_modifier_for_species (SDK-39) already
    // proved out for that clause.
    expect(emissions.get("building")?.code).toContain(
      'triggeredPlanetPopGroupModifierForSpecies?: TriggeredModifier<"pop_group">[];'
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
    expect(decision?.code).toContain(
      'resources?: WithFrom<EconomicResourceBlock<NoInfer<S>>[], NoInfer<S>, "country">;'
    );
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
        ...fieldNames(emission.emittedFields).map((field) => `${registry}.${field}`),
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

  it("asserts an arity the rules get wrong rather than declining the field", () => {
    // `## cardinality = 0..inf` on a bare bool lowered to `boolean[]`, which was
    // the last thing CONTENT_DECLINED_FIELDS withheld. Shape conformance
    // measures the arity against the corpus instead, so the field is
    // authorable rather than refused — a defect that is measured does not
    // need a reviewer to vouch for it.
    const job = emissions.get("job")!;
    expect(fieldNames(job.emittedFields)).toContain("auto_generate_description");
    expect(job.code).toContain("autoGenerateDescription?: boolean;");
    // SDK-30's `change_orbit` rows are the one exception to "stays empty" —
    // not a shape the emitter lowers badly, but positional sugar an
    // array-shaped member cannot represent at all, so nothing here is a
    // defect measurement could have caught the way auto_generate_description's
    // was.
    expect([...CONTENT_DECLINED_FIELDS.keys()]).toEqual([
      "solar_system_initializer.change_orbit",
      "planet_initializer.change_orbit",
      "moon_initializer.change_orbit",
    ]);
  });

  it("emits fields the curated list used to withhold", () => {
    // Each of these lowers cleanly and was absent only because nobody had
    // written it down. decision.sound in particular is set by 66 shipped
    // decisions, so withholding it broke porting for no reason.
    expect(fieldNames(emissions.get("building")!.emittedFields)).toContain("on_built");
    expect(fieldNames(emissions.get("building")!.emittedFields)).toContain("on_destroy");
    expect(fieldNames(emissions.get("decision")!.emittedFields)).toContain("sound");
  });

  it("generates casus_belli and war_goal without registry-specific code", () => {
    const casusBelli = emissions.get("casus_belli");
    expect(casusBelli?.code).toContain("export interface CasusBelliDef");
    expect(casusBelli?.code).toContain("proxyWarResources?: EconomicResourceBlock<ScopeName>[];");
    expect(casusBelli?.code).toContain('shape: "economicResources"');

    const warGoal = emissions.get("war_goal");
    expect(warGoal?.code).toContain("export interface WarGoalDef");
    expect(warGoal?.code).toContain("casusBelli: CasusBelliRef | string;");
    expect(warGoal?.code).toContain(
      'aiWeight?: WithFrom<WeightBlock<"country">, "country", "country">;'
    );
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
    // to the union and the writer dispatches on what the author passes. The arms read
    // in CWT's own declaration order, which is why the two differ.
    const bombardmentStance = emissions.get("bombardment_stance");
    expect(bombardmentStance?.code).toContain(
      'planetDamage?: number | WithFrom<WeightBlock<"fleet">, "fleet", "planet">;'
    );
    // A pure modifier_rule splice needs no overlay row either — it infers weightBlock.
    expect(bombardmentStance?.code).toContain(
      'aiWeight: WithFrom<WeightBlock<"fleet">, "fleet", "planet">;'
    );

    const archaeologicalSiteType = emissions.get("archaeological_site_type");
    expect(archaeologicalSiteType?.code).toContain('weight?: WeightBlock<"planet"> | number;');
    expect(archaeologicalSiteType?.code).toContain(
      '{ key: "weight", member: "weight", shape: "dual", arms: ['
    );
  });

  it("carries a block's declared FROM scope into its effect closure", () => {
    // `## replace_scopes = { this = fleet from = archaeological_site }` states
    // two facts, and only one of them used to survive into the emitted type.
    // FROM is what half these blocks are for — vanilla's own `on_roll_failed`
    // is a `from = { ... }` block — so the closure gets it as `ctx.from`.
    const archaeologicalSiteType = emissions.get("archaeological_site_type");
    expect(archaeologicalSiteType?.code).toContain(
      'onRollFailed: EffectBlock<"fleet", "archaeological_site">;'
    );
    // A `push_scope` names `this` and leaves FROM alone, so the same registry's
    // on_create keeps the one-argument form and its ctx.from stays unreadable.
    expect(archaeologicalSiteType?.code).toContain(
      'onCreate?: EffectBlock<"archaeological_site">;'
    );
    // Each registry's own rules decide the scope, rather than one convention:
    // a war goal's FROM is the targeted country.
    expect(emissions.get("war_goal")?.code).toContain(
      'onAccept?: EffectBlock<"country", "country">;'
    );
  });

  it("gives a declarative field with a FROM the closure form too", () => {
    // A trigger and a weight block are values, so FROM reaches them through an
    // added closure form rather than through an argument list they never had.
    const archaeologicalSiteType = emissions.get("archaeological_site_type");
    expect(archaeologicalSiteType?.code).toContain(
      'allow: WithFrom<Trigger<"fleet">, "fleet", "archaeological_site">;'
    );
    // A field with no FROM keeps the plain type: the closure form exists to
    // carry FROM, so a field without one has nothing to offer it.
    expect(emissions.get("building")?.code).toContain('allow?: Trigger<"colony">;');
    expect(emissions.get("building")?.code).not.toContain("WithFrom");
    // A dual keeps arm-by-arm dispatch: only the arm that can hold a condition
    // grows the closure form.
    expect(emissions.get("opinion_modifier")?.code).toContain(
      'opinion: WithFrom<WeightBlock<"country">, "country", "country"> | number;'
    );
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
    expect(situation?.code).toContain("stages?: Readonly<Record<string, SituationStageFields>>;");
    // "container" keying carries no identityKey member in its metadata — the
    // record key IS the block's own key, not a body field.
    expect(situation?.code).not.toMatch(/keying: "container"[^}]*identityKey/);

    expect(situation?.code).toContain("export interface SituationApproachFields");
    expect(situation?.code).toContain('keying: "siblings"');
    expect(situation?.code).toContain('identityKey: "name"');
    expect(situation?.code).toContain("fields: SITUATION_APPROACH_FIELDS");
    expect(situation?.code).toContain(
      "approach?: Readonly<Record<string, SituationApproachFields>>;"
    );
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
    // The scalar arm is `value_field`, not `float`, so it widens to
    // `ScriptValue` (widenedLowering) rather than plain `number` — a number
    // still assigns unchanged.
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain('totalProgress?: ScriptValue | WeightBlock<"situation">;');
    expect(situation?.code).toContain('end?: ScriptValue | WeightBlock<"situation">;');
    expect(situation?.code).toContain('sectionWeight?: ScriptValue | WeightBlock<"situation">;');
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
    // shipped situations do write, so the renamed member is a dual of both arms.
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain("conditionalDesc?: string | SituationTypeDesc[];");
    // The rename has to reach the arms too: the writer resolves an arm by its
    // own member name, so a single-shot replace would leave them as `desc`.
    expect(situation?.code).not.toContain('member: "desc", shape: "struct"');
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
      '{ key: "has_owner", member: "hasOwner", shape: "value", form: "scalar", ' +
        'conversion: "identity" }'
    );
    expect(job?.code).toContain(
      '{ key: "possible_pre_triggers", member: "possiblePreTriggers", shape: "struct", ' +
        'form: "block", fields: JOB_POSSIBLE_PRE_TRIGGERS_FIELDS }'
    );
    expect(fieldNames(job!.emittedFields)).toContain("possible_pre_triggers");
    expect(job?.unsupported.join("\n")).not.toContain("possible_pre_triggers");
    expect(job?.machineryBacklog.join("\n")).not.toContain("possible_pre_triggers");
  });

  it("lowers a top-level unkeyed modifier splice into one authoring member", () => {
    // static_modifier's rule is `{ alias_name[modifier] = alias_match_left[modifier]
    // icon = filepath ... }` — the modifier grammar is the body itself, which
    // mergeByName cannot see because the key is a splice rather than a name.
    // Without it the registry could set an icon and a tooltip but never a
    // modifier, which is the whole point of a static modifier.
    const staticModifier = emissions.get("static_modifier");
    expect(staticModifier?.inlineSplices).toEqual(["modifier"]);
    expect(staticModifier?.code).toContain("modifiers?: ModifierClosure<ScopeName>;");
    expect(staticModifier?.code).toContain('{ member: "modifiers", shape: "inlineModifiers" }');
    // No `key`: the game reads none, and the writer splices the rows at the
    // block root next to the metadata keys, the way vanilla writes them.
    expect(staticModifier?.code).not.toContain(
      'member: "modifiers", shape: "inlineModifiers", key'
    );
    expect(staticModifier?.unsupported.join("\n")).not.toContain("alias_name");
    // The metadata leads with the splice, matching both the rules' declaration
    // order and vanilla's files.
    const fields = staticModifier?.code.slice(
      staticModifier.code.indexOf("STATIC_MODIFIER_FIELDS")
    );
    expect(fields?.indexOf("inlineModifiers")).toBeLessThan(fields!.indexOf('key: "icon"'));
  });

  it("reports a top-level splice it has no authoring member for", () => {
    // Only `modifier` lowers. A body splicing any other category must surface
    // in the report rather than silently losing the whole clause.
    const type = rules.contentTypes.get("static_modifier")!;
    const body = rules.bodies.get("static_modifier")!;
    const spliced = {
      ...body,
      fields: body.fields.map((field) =>
        field.key.kind === "aliasName"
          ? { ...field, key: { kind: "aliasName", category: "fleet_action" } as const }
          : field
      ),
    };
    emitter.beginFile();
    const emission = emitContentType(emitter, type, spliced, "static_modifier");
    emitter.endFile();
    expect(emission.inlineSplices).toEqual([]);
    expect(emission.unsupported.join("\n")).toContain(
      "alias_name[fleet_action] (spliced unkeyed at the top level"
    );
  });

  it("lowers random_events' computed weight keys as a weighted event list", () => {
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain(
      "randomEvents?: readonly { weight: number; event?: EventScopelessRef | string | EventSituationRef }[];"
    );
    expect(situation?.code).toContain(
      '{ key: "random_events", member: "randomEvents", shape: "weightedEvents", ' +
        'form: "list", conversion: "ref", refTypes: ["event.scopeless","event.situation"] }'
    );
    expect(situation?.unsupported.join("\n")).not.toContain("random_events");
  });

  it("distinguishes an engine-keyed map from an identity-keyed one", () => {
    // section_slots and situations' stages are the SAME shape in CWT — a
    // wildcard-keyed block inside a block — and mean opposite things. A stage
    // key is an id the mod owns, prefixed and localised; a section slot key is
    // `mid` or the integer `1`, names the engine and the ship models already
    // agree on. Only the overlay can tell them apart, so this pins both.
    const shipSize = emissions.get("ship_size");
    expect(shipSize?.code).toContain("export interface ShipSizeSectionSlots");
    expect(shipSize?.code).toContain(
      "sectionSlots?: Readonly<Record<string, ShipSizeSectionSlots>>;"
    );
    expect(shipSize?.code).toContain('shape: "structMap"');
    expect(shipSize?.code).toContain("fields: SHIP_SIZE_SECTION_SLOTS_FIELDS");
    // No identity machinery: a structMap key carries no localisation table and
    // no identityKey, which is exactly what separates it from repeatedStruct.
    expect(shipSize?.code).not.toContain("SHIP_SIZE_SECTION_SLOTS_LOCALISATION");
    expect(shipSize?.code).not.toContain('shape: "repeatedStruct"');
    // The identity-keyed reading is still generated where it belongs.
    expect(emissions.get("situation_type")?.code).toContain('keying: "container"');
  });

  it("lowers a ref-keyed scalar map, the shape two registries needed", () => {
    // `{ <resource> = float }` and `{ <job> = int }` are computed keys, which
    // mergeByName drops — so nothing reached these fields at all.
    // leader_background_job_weight sat on the machinery backlog until
    // ship_size.min_upgrade_cost turned up as a second consumer.
    const shipSize = emissions.get("ship_size");
    expect(shipSize?.code).toContain("minUpgradeCost?: Readonly<Record<string, number>>;");
    expect(shipSize?.code).toContain(
      '{ key: "min_upgrade_cost", member: "minUpgradeCost", shape: "scalarMap", form: "block" }'
    );
    const civic = emissions.get("civic_or_origin");
    expect(civic?.code).toContain("leaderBackgroundJobWeight?: Readonly<Record<string, number>>;");
    // Both registries now lower everything the rules declare.
    expect(shipSize?.machineryBacklog).toEqual([]);
    expect(civic?.machineryBacklog).toEqual([]);
  });

  it("carries ship_size's per-field modifier scopes", () => {
    // The two modifier fields sit in different scopes on the same definition,
    // which is the thing a flat modifier table could never express.
    const shipSize = emissions.get("ship_size");
    expect(shipSize?.code).toContain('modifier?: ModifierClosure<"starbase">;');
    expect(shipSize?.code).toContain('shipModifier?: ModifierClosure<"ship">;');
  });

  it("lets the overlay assert a scope the rules omit", () => {
    // country_ship_of_size_limit.show carries no `## replace_scopes`, so the
    // mechanical reading is Trigger<ScopeName> — valid in EVERY scope — and the
    // field is required. All 7 shipped entries write a country condition there,
    // none of which satisfies that type, so the field would be emitted and
    // unfillable. The corpus gate cannot see this: it only checks presence.
    const limit = emissions.get("country_ship_of_size_limit");
    expect(limit?.code).toContain('show: Trigger<"country">;');
    expect(limit?.code).not.toContain("show: Trigger<ScopeName>;");
    // The assertion is surgical, and its counterpart is a different mechanism:
    // a decision's scope really does vary per definition, so it takes a scope
    // parameter rather than an asserted constant.
    expect(emissions.get("decision")?.code).toContain(
      'potential?: WithFrom<Trigger<NoInfer<S>>, NoInfer<S>, "country">;'
    );
  });

  it("parameterises a registry whose scope is a property of the definition", () => {
    // CWT annotates the decision body `this = any` and is right to: the same
    // registry is planet-scoped on a planet and ship-scoped on a nomadic
    // colony ship. Asserting a constant would be overriding that; the
    // definition declares which it is instead, and every unpinned field
    // follows. `NoInfer` keeps `scope` the sole inference site — inferring
    // from the contravariant `Trigger<S>` positions lands elsewhere entirely.
    const decision = emissions.get("decision")!;
    expect(decision.code).toContain('export type DecisionScope = "planet" | "ship";');
    expect(decision.code).toContain("export interface DecisionFields<S extends DecisionScope");
    expect(decision.code).toContain("  scope?: S;");
    expect(decision.code).toContain('effect: EffectBlock<NoInfer<S>, "country">;');
    // A field CWT does pin keeps its own scope: the parameter fills the gap
    // rather than flattening everything into it.
    expect(decision.code).toContain('showTechUnlockIf?: Trigger<"country">;');
    // Nothing else moves — a registry with no row is emitted exactly as before.
    expect(emissions.get("edict")?.code).not.toContain("NoInfer<S>");
  });

  it("gives an asserted scope precedence over one the rules declare", () => {
    // The row has to win even where CWT *does* annotate, otherwise it could
    // only ever fix the absent case and a wrong annotation would be unfixable.
    // Feeding `show` a planet scope it does not really have proves precedence.
    const type = rules.contentTypes.get("country_ship_of_size_limit")!;
    const body = rules.bodies.get("country_ship_of_size_limit")!;
    const misScoped = {
      ...body,
      fields: body.fields.map((field) =>
        field.key.kind === "name" && field.key.name === "show"
          ? { ...field, scope: { this: "planet", root: null, from: null, replaces: false } }
          : field
      ),
    };
    emitter.beginFile();
    const emission = emitContentType(emitter, type, misScoped, "country_ship_of_size_limit");
    emitter.endFile();
    expect(emission.code).toContain('show: Trigger<"country">;');
    expect(emission.code).not.toContain('show: Trigger<"planet">;');
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

  it("generates economic_category without registry-specific code", () => {
    // Same drift block as councilor (SDK-2), same source file.
    const economicCategory = emissions.get("economic_category");
    expect(economicCategory?.code).toContain("export interface EconomicCategoryDef");
    expect(economicCategory?.code).toContain(
      "triggeredCostModifier?: EconomicCategoryTriggeredCostModifier[];"
    );
    expect(economicCategory?.machineryBacklog).toEqual([]);
  });

  it("lowers civic_or_origin's potential/possible onto the shared government_trigger block", () => {
    // civic_or_origin was blocked on the government_trigger alias category
    // (SDK-1): potential/possible splice it alongside ordinary text/always
    // siblings, the same "combinator" shape government_trigger's own OR/AND/
    // limit members use, so the overlay points both at the shared
    // GovernmentTriggerBlock rather than a Trigger.
    const civicOrOrigin = emissions.get("civic_or_origin");
    expect(civicOrOrigin?.code).toContain("export interface CivicOrOriginDef");
    expect(civicOrOrigin?.code).toContain("potential?: GovernmentTriggerBlock;");
    expect(civicOrOrigin?.code).toContain("possible?: GovernmentTriggerBlock;");
    expect(civicOrOrigin?.code).toContain(
      '{ key: "potential", member: "potential", shape: "aliasStruct", ' +
        'form: "block", category: "government_trigger" }'
    );
    // playable/ai_playable are single_alias_right[trigger_clause] — real
    // Triggers, not government_trigger — and their `## replace_scopes` pins
    // them to no_scope.
    expect(civicOrOrigin?.code).toContain('playable?: Trigger<"no_scope">;');
    expect(civicOrOrigin?.code).toContain('aiPlayable?: Trigger<"no_scope">;');
    expect(civicOrOrigin?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(civicOrOrigin?.code).toContain(
      'multiplyByHabitabilityEffectModifier?: ModifierClosure<"country">;'
    );
    expect(civicOrOrigin?.code).toContain("export interface CivicOrOriginSwapType");
    expect(civicOrOrigin?.code).toContain("modifier?: ModifierClosure<ScopeName>;");
    expect(fieldNames(civicOrOrigin!.emittedFields)).toContain("potential");
    expect(fieldNames(civicOrOrigin!.emittedFields)).toContain("possible");
    expect(civicOrOrigin?.unsupported.join("\n")).not.toContain("potential");
    expect(civicOrOrigin?.unsupported.join("\n")).not.toContain("possible");
    // leader_background_job_weight (`{ <job> = int }`) was the one field left
    // on this registry's machinery backlog when it landed. `scalarMap` — built
    // once ship_size.min_upgrade_cost turned up needing the same shape —
    // retired it, so the backlog is now empty.
    expect(civicOrOrigin?.machineryBacklog).toEqual([]);
    expect(fieldNames(civicOrOrigin!.emittedFields)).toContain("leader_background_job_weight");
  });

  it("widens unpinned-scope Trigger/WeightBlock fields to never, buying real scope back by overlay row (widenedLowering, SDK-33)", () => {
    // civic_or_origin.swap_type.trigger carries no `## replace_scopes` and no
    // overlay `scope` assertion — CWT genuinely does not say, so it stays
    // unchecked (`Trigger<never>`, the top of Trigger's contravariant
    // lattice) rather than the unsatisfiable `Trigger<ScopeName>`.
    const civicOrOrigin = emissions.get("civic_or_origin");
    expect(civicOrOrigin?.code).toContain("trigger: Trigger<never>;");
    // solar_system_initializer.usage_odds and tradition_category.desc.trigger
    // are the same unpinned defect, but with a `CONTENT_FIELD_OVERRIDES`
    // `scope` row buying the checking back — see overlay.ts for the corpus
    // evidence (shape conformance, not a reading of the rules alone).
    const solarSystemInitializer = emissions.get("solar_system_initializer");
    expect(solarSystemInitializer?.code).toContain('usageOdds?: number | WeightBlock<"system">;');
    const traditionCategory = emissions.get("tradition_category");
    expect(traditionCategory?.code).toContain('trigger?: Trigger<"country">;');
  });

  it("generates component_set as a name_field registry without registry-specific code", () => {
    const componentSet = emissions.get("component_set");
    expect(componentSet?.code).toContain("export interface ComponentSetDef");
    expect(componentSet?.code).toContain("requiredComponentSet?: boolean;");
    expect(componentSet?.code).toContain("affectsTargetFocus?: boolean;");
    expect(componentSet?.machineryBacklog).toEqual([]);
  });

  it("lowers section_template's resources/modifier/ship_modifier via overlay shapes", () => {
    // section_template's own machinery is ordinary name_field wiring; only its
    // economic_template and modifier_clause splices need overlay help, the
    // same shapes every other registry with those fields already uses.
    const sectionTemplate = emissions.get("section_template");
    expect(sectionTemplate?.code).toContain("export interface SectionTemplateDef");
    expect(sectionTemplate?.code).toContain("resources?: EconomicResourceBlock<ScopeName>[];");
    // Both replace_scopes-pinned to "ship".
    expect(sectionTemplate?.code).toContain('modifier?: ModifierClosure<"ship">;');
    expect(sectionTemplate?.code).toContain('shipModifier?: ModifierClosure<"ship">;');
    expect(fieldNames(sectionTemplate!.emittedFields)).toContain("resources");
    expect(fieldNames(sectionTemplate!.emittedFields)).toContain("modifier");
    expect(fieldNames(sectionTemplate!.emittedFields)).toContain("ship_modifier");
    expect(sectionTemplate?.machineryBacklog).toEqual([]);
  });

  it("lowers component templates' resources/modifier fields via overlay shapes (componentTemplateResources)", () => {
    // SDK-31: none of the three component_template registries had a single
    // field override before this cluster landed, so resources and modifier
    // were present in components.cwt but absent from CONTENT_FIELD_OVERRIDES
    // — the writer only emits declared ContentField[] members, so a ported
    // SMALL_SHIELD_1 occupied a slot, cost nothing, and granted nothing.
    const utility = emissions.get("utility_component_template");
    expect(utility?.code).toContain("export interface UtilityComponentTemplateDef");
    expect(utility?.code).toContain('resources?: EconomicResourceBlock<"ship">[];');
    expect(utility?.code).toContain('modifier?: ModifierClosure<"ship">;');
    expect(utility?.code).toContain('shipModifier?: ModifierClosure<"ship">;');
    expect(utility?.code).toContain('shipDesignModifier?: ModifierClosure<"design">;');
    expect(utility?.code).toContain('triggeredShipModifier?: TriggeredModifier<"ship">[];');
    expect(utility?.code).toContain('triggeredShipDesignModifier?: TriggeredModifier<"design">[];');
    expect(fieldNames(utility!.emittedFields)).toContain("resources");
    expect(fieldNames(utility!.emittedFields)).toContain("modifier");
    // target_weights and the friendly_aura/hostile_aura nested modifiers are
    // pre-existing gaps this ticket does not touch — exact-line membership so
    // this assertion does not accidentally require fixing them too (their
    // report lines are prefixed with "friendly_aura."/"hostile_aura.").
    expect(utility?.unsupported).not.toContain("resources (no declaration the emitter can lower)");
    expect(utility?.unsupported).not.toContain("modifier (no declaration the emitter can lower)");

    const weapon = emissions.get("weapon_component_template");
    expect(weapon?.code).toContain("export interface WeaponComponentTemplateDef");
    // Splices economic_template_no_produce (components.cwt:189), not plain
    // economic_template like utility's own resources above — `produces` is
    // not game-legal here, so the row requests economicResourcesNoProduce
    // rather than economicResources and the member type has no `produces` arm.
    expect(weapon?.code).toContain('resources?: EconomicResourceBlockNoProduce<"ship">[];');
    expect(weapon?.code).toContain('shape: "economicResourcesNoProduce"');
    expect(weapon?.code).not.toContain('resources?: EconomicResourceBlock<"ship">[];');
    expect(weapon?.code).toContain('modifier?: ModifierClosure<"ship">;');
    expect(weapon?.code).toContain('shipDesignModifier?: ModifierClosure<"design">;');
    expect(fieldNames(weapon!.emittedFields)).toContain("resources");
    expect(fieldNames(weapon!.emittedFields)).toContain("modifier");

    // strike_craft_component_template only declares resources and
    // ship_modifier (components.cwt:332-343) — no modifier,
    // ship_design_modifier, or either triggered variant, unlike weapon and
    // utility above. Those four remain unsupported here because the same
    // CWT body backs all three registries and mergeByName folds weapon's and
    // utility's declarations of those names into strike_craft's field group
    // too; with no strike_craft-specific override they correctly stay
    // unlowered rather than borrowing a shape strike craft never declares.
    const strikeCraft = emissions.get("strike_craft_component_template");
    expect(strikeCraft?.code).toContain("export interface StrikeCraftComponentTemplateDef");
    // Same economic_template_no_produce splice as weapon's above
    // (components.cwt:338).
    expect(strikeCraft?.code).toContain('resources?: EconomicResourceBlockNoProduce<"ship">[];');
    expect(strikeCraft?.code).toContain('shape: "economicResourcesNoProduce"');
    expect(strikeCraft?.code).not.toContain('resources?: EconomicResourceBlock<"ship">[];');
    expect(strikeCraft?.code).toContain('shipModifier?: ModifierClosure<"ship">;');
    expect(fieldNames(strikeCraft!.emittedFields)).toContain("resources");
    expect(fieldNames(strikeCraft!.emittedFields)).toContain("ship_modifier");
    expect(strikeCraft?.unsupported).not.toContain(
      "resources (no declaration the emitter can lower)"
    );
    expect(strikeCraft?.unsupported).not.toContain(
      "ship_modifier (no declaration the emitter can lower)"
    );
    // Confirms the four fields strike_craft genuinely does not declare stay
    // unsupported rather than silently picking up weapon's/utility's shapes.
    expect(strikeCraft?.unsupported).toContain("modifier (no declaration the emitter can lower)");
    expect(strikeCraft?.unsupported).toContain(
      "ship_design_modifier (no declaration the emitter can lower)"
    );
  });

  it("generates ambient_object as a name_field registry keyed by name", () => {
    const ambientObject = emissions.get("ambient_object");
    expect(ambientObject?.code).toContain("export interface AmbientObjectDef");
    expect(ambientObject?.code).toContain("entity: ModelEntityRef | string;");
    expect(ambientObject?.code).toContain("showName?: boolean;");
    expect(ambientObject?.machineryBacklog).toEqual([]);
  });

  it("generates graphical_culture with unpinned, widened randomized/selectable triggers", () => {
    // No `## replace_scopes` on either field, unlike ship_selection_weight
    // (pinned to species scope) right below them, so they lower to the
    // widened, unchecked `Trigger<never>` (widenedLowering) rather than the
    // unsatisfiable `Trigger<ScopeName>`.
    const graphicalCulture = emissions.get("graphical_culture");
    expect(graphicalCulture?.code).toContain("export interface GraphicalCultureDef");
    expect(graphicalCulture?.code).toContain("randomized?: Trigger<never>;");
    expect(graphicalCulture?.code).toContain("selectable?: Trigger<never>;");
    expect(graphicalCulture?.code).toContain(
      'shipSelectionWeight?: WithFrom<WeightBlock<"species">, "species", "country">;'
    );
    expect(graphicalCulture?.machineryBacklog).toEqual([]);
  });

  it("pins starbase_level's upgrade/downgrade triggers to starbase scope", () => {
    const starbaseLevel = emissions.get("starbase_level");
    expect(starbaseLevel?.code).toContain("export interface StarbaseLevelDef");
    expect(starbaseLevel?.code).toContain('upgradePossible?: Trigger<"starbase">;');
    expect(starbaseLevel?.code).toContain('downgradePotential?: Trigger<"starbase">;');
    expect(starbaseLevel?.code).toContain("collectsTrade?: boolean;");
    expect(starbaseLevel?.code).toContain("specialConstruction?: boolean;");
    expect(starbaseLevel?.machineryBacklog).toEqual([]);
  });

  it("lowers species_class's possible/possible_secondary onto the shared government_trigger block", () => {
    // Same shape and reasoning SDK-3 landed for civic_or_origin.potential/
    // .possible: `possible = { text? always? alias_name[government_trigger] }`.
    const speciesClass = emissions.get("species_class");
    expect(speciesClass?.code).toContain("export interface SpeciesClassDef");
    expect(speciesClass?.code).toContain("possible?: GovernmentTriggerBlock;");
    expect(speciesClass?.code).toContain("possibleSecondary?: GovernmentTriggerBlock;");
    expect(speciesClass?.code).toContain(
      '{ key: "possible", member: "possible", shape: "aliasStruct", ' +
        'form: "block", category: "government_trigger" }'
    );
    // resources/modifier need the same economicResources/modifierBlock help
    // every other registry with those fields already uses.
    expect(speciesClass?.code).toContain("resources?: EconomicResourceBlock<ScopeName>[];");
    expect(speciesClass?.code).toContain('modifier?: ModifierClosure<"pop_group">;');
    // playable carries no `## replace_scopes`, unlike possible/possible_secondary,
    // so it lowers to the widened, unchecked `Trigger<never>` (widenedLowering)
    // rather than the unsatisfiable `Trigger<ScopeName>` — see content.test-d.ts's
    // widenedLowering species_class.playable coverage for the authoring payoff.
    expect(speciesClass?.code).toContain("playable?: Trigger<never>;");
    // The localisation table nests under `subtype[playable]`, not the type's
    // top level — 26 slots, all recovered.
    expect(speciesClass?.code).toContain('{ member: "plural", pattern: "$_plural"');
    expect(fieldNames(speciesClass!.emittedFields)).toContain("possible");
    expect(fieldNames(speciesClass!.emittedFields)).toContain("possible_secondary");
    expect(speciesClass?.unsupported.join("\n")).not.toContain("possible");
    expect(speciesClass?.machineryBacklog).toEqual([]);
  });

  it("lowers country_ship_of_size_limit.ship_types onto the branded ship_size ref", () => {
    // `<ship_size>` in the CWT body is a ref to the registry SDK-7 landed
    // (9fb2da8), so this must come out branded rather than bare `string[]` —
    // the whole point of not treating it as a plain scalar list.
    const countryShipOfSizeLimit = emissions.get("country_ship_of_size_limit");
    expect(countryShipOfSizeLimit?.code).toContain("export interface CountryShipOfSizeLimitDef");
    expect(countryShipOfSizeLimit?.code).toContain("shipTypes: (ShipSizeRef | string)[];");
    // base/max/navalCapFraction are `country_limits.cwt`'s `value_field`, not
    // `float`, so they lower to the widened `ScriptValue` (widenedLowering)
    // rather than plain `number` — a number still assigns unchanged.
    expect(countryShipOfSizeLimit?.code).toContain("base: ScriptValue;");
    expect(countryShipOfSizeLimit?.code).toContain("max?: ScriptValue;");
    expect(countryShipOfSizeLimit?.code).toContain("navalCapFraction?: ScriptValue;");
    // `show` is scoped by an overlay assertion rather than by the rules — see
    // the scope-assertion test above for why the mechanical reading was wrong.
    expect(countryShipOfSizeLimit?.code).toContain('show: Trigger<"country">;');
    // The CWT type declares no localisation for this registry at all.
    expect(countryShipOfSizeLimit?.code).not.toContain("name?:");
    expect(countryShipOfSizeLimit?.code).not.toContain("desc?:");
    expect(countryShipOfSizeLimit?.code).toContain(
      "COUNTRY_SHIP_OF_SIZE_LIMIT_LOCALISATION: readonly ContentLocalisation[] = [\n];"
    );
    expect(countryShipOfSizeLimit?.machineryBacklog).toEqual([]);
  });

  it("lowers the solar system initializer's planet splice onto a category interface", () => {
    const solarSystem = emissions.get("solar_system_initializer");
    expect(solarSystem?.code).toContain("export interface SolarSystemInitializerDef");
    // The planet tree arrives as `alias_name[planet_initializer]`, spliced
    // unkeyed at the top level. It lowers to a named member holding an ordered
    // array, with the field table resolved by category at write time.
    expect(solarSystem?.code).toContain("planet?: PlanetInitializerFields[];");
    expect(solarSystem?.code).toContain('category: "planet_initializer"');
    expect(solarSystem?.code).toContain('shape: "aliasStruct"');
    // Declared once per subtype arm; both arms describe the same tree, so the
    // emitter records one splice rather than reporting the second as a
    // member-name collision.
    expect(solarSystem?.inlineSplices).toEqual(["planet_initializer"]);
    expect(solarSystem?.machineryBacklog).toEqual([]);
    // Members follow the rules' declaration order, splices included. Here that
    // puts `planet` ahead of `orbitDistance`, which is what the CWT body says;
    // the case where the order carries meaning is one level down, inside
    // `planet` — see the category test below.
    expect(solarSystem?.code.indexOf("planet?:")).toBeLessThan(
      solarSystem!.code.indexOf("orbitDistance?:")
    );
    // SDK-30: `change_orbit` is CONTENT_DECLINED_FIELDS — it is positional
    // sugar (advances the orbit cursor for the planets that follow it) that
    // an array-shaped member cannot represent, and the long form
    // (`class: "none", orbitDistance: n` on the next `planet`) already emits
    // the same geometry correctly, so nothing is emitted for it at all.
    expect(solarSystem?.code).not.toContain("changeOrbit");
    expect(solarSystem?.declinedFields).toEqual(
      expect.arrayContaining([expect.stringContaining("solar_system_initializer.change_orbit")])
    );
    // Two fields with no overlay help: `class` unions both ref arms the rules
    // declare, and `flags = { value_set[star_flag] }` reads as a bare list.
    expect(solarSystem?.code).toContain("class: StarClassRef | string | StarClassRandomListRef;");
    expect(solarSystem?.code).toContain("flags?: StarFlag[];");
    // The planet member is a measured field, not just a reported splice — the
    // corpus gate can hold it to a shape.
    expect(fieldNames(solarSystem?.emittedFields ?? [])).toContain("planet");
  });

  it("emits the planet and moon categories as mutually recursive blocks", () => {
    const planet = emitAliasSplice(emitter, "planet_initializer");
    const moon = emitAliasSplice(emitter, "moon_initializer");
    expect(planet?.memberKey).toBe("planet");
    expect(planet?.spliceCategories).toEqual(["planet_initializer", "moon_initializer"]);
    // The interface refers to itself and to the moon's; the *table* cannot, so
    // it is registered under the category name and resolved at write time.
    expect(planet?.code).toContain("planet?: PlanetInitializerFields[];");
    expect(planet?.code).toContain("moon?: MoonInitializerFields[];");
    expect(planet?.code).toContain(
      'registerAliasStructFields("planet_initializer", PLANET_INITIALIZER_FIELDS)'
    );
    // A moon carries moons and never planets, which is what makes the two
    // categories worth keeping separate.
    expect(moon?.code).toContain("moon?: MoonInitializerFields[];");
    expect(moon?.code).not.toContain("planet?:");
    expect(moon?.spliceCategories).toEqual(["moon_initializer"]);
    // Scope comes from the nested `## replace_scopes`, not an overlay row.
    expect(planet?.code).toContain('initEffect?: EffectBlock<"planet">;');
    // SDK-30: `change_orbit` inside a planet is the same positional sugar as
    // the top-level one (advances the orbit cursor for the moons that
    // follow it) and is declined the same way — not emitted at all, long
    // form only.
    expect(planet?.code).not.toContain("changeOrbit");
    expect(planet?.declinedFields).toEqual(
      expect.arrayContaining([expect.stringContaining("planet_initializer.change_orbit")])
    );
    expect(moon?.code).not.toContain("changeOrbit");
    expect(moon?.declinedFields).toEqual(
      expect.arrayContaining([expect.stringContaining("moon_initializer.change_orbit")])
    );
    // The four arity rows: without them both keys collapse to arrays, because
    // CWT declares each arm `0..inf`.
    expect(planet?.code).toContain('orbitAngle?: "random" | number | PlanetInitializerOrbitAngle;');
    expect(planet?.code).toContain("size?: number | PlanetInitializerSize;");
    // Fields are rooted at the member key so the corpus gate can line them up
    // with the real files, where they are written inside `planet = { ... }`.
    expect(fieldNames(planet?.emittedFields ?? [])).toContain("planet.class");
    expect(fieldNames(planet?.emittedFields ?? [])).toContain("planet.moon");
    expect(planet?.unsupported).toEqual([]);
    expect(moon?.unsupported).toEqual([]);
  });
});

/**
 * The free definers (SDK-23) — the whole content surface since the collection
 * factories were deleted — read from the committed output rather than
 * re-emitted: `npm run codegen:check` is what guarantees the file matches the
 * emitter, so asserting against the file also asserts against what ships.
 *
 * The claim is that all 34 definers are importable from this one module — 33
 * mechanical, one re-exported from the hand-written graft — and that none of
 * them registers anything, which is what makes `collection(...)` and
 * `discoverContent` the only things that decide placement.
 */
describe("generated content definers", () => {
  const definers = readFileSync("packages/sdk/src/generated/content-definers.ts", "utf8");
  const capability = readFileSync("packages/sdk/src/generated/content-capability.ts", "utf8");

  it("emits one free definer and one item union per manifest registry", () => {
    for (const manifest of CONTENT_MANIFEST) {
      const entry = manifest as ContentManifestEntry;
      const name = pascalCase(entry.as ?? entry.type);
      expect(definers, entry.type).toContain(`export type ${name}Item =`);
      expect(definers, entry.type).toMatch(new RegExp(`\\bdefine${name}\\b`));
    }
    // 33 mechanical `export function defineX` plus the graft's re-export.
    expect(definers.match(/^export function define\w+</gm)).toHaveLength(
      CONTENT_MANIFEST.length - HAND_WRITTEN_CONTENT_DEFINERS.size
    );
    // HAND_WRITTEN_CONTENT_DEFINERS, the HAND_WRITTEN_TRIGGERS arrangement one
    // level up: no mechanical defineSituationType is emitted beside the graft,
    // because `targetScope` is a contract the rules describe nowhere.
    expect(HAND_WRITTEN_CONTENT_DEFINERS.has("situation_type")).toBe(true);
    expect(definers).toContain('export { defineSituationType } from "../definers.ts";');
    expect(definers).not.toContain("export function defineSituationType");
    expect(definers).not.toContain("defineSituationType<const Id");
  });

  it("preserves a definition's literal id, and registers nothing", () => {
    expect(definers).toContain(
      "export function defineTechnology<const Id extends string>(\n" +
        "  def: TechnologyDef<Id>\n" +
        '): ContentItem<"technology", TechnologyDef<Id>> {\n' +
        '  return { itemKind: "content", type: "technology", id: def.id, def };\n' +
        "}"
    );
    // No collection, no item array, nothing pushed: a definer is a function
    // from a definition to a value, and that is the whole of it.
    expect(definers).not.toContain("items.push");
    expect(definers).not.toContain("makeCollection");
    expect(definers).not.toContain("Collection<");
  });

  it("emits the free patchTechnology and addShipOfSizeLimits, and only those", () => {
    expect(definers.match(/^export function patch\w+</gm)).toEqual([
      "export function patchTechnology<",
    ]);
    expect(definers).toContain(
      "): TechnologyPatchItem {\n" +
        '  return { itemKind: "patch", patched: transformTechnology(technology, patch) };'
    );
    expect(definers.match(/^export function add\w+\(/gm)).toEqual([
      "export function addShipOfSizeLimits(",
    ]);
    expect(definers).toContain(
      "export type CountryShipOfSizeLimitItem =\n" +
        '  ContentItem<"country_ship_of_size_limit", CountryShipOfSizeLimitDef> | ContributionItem;'
    );
    expect(definers).toContain("): ContributionItem {");
    expect(definers).toContain('registry: "ship_of_size_limits",');
    expect(definers).toContain('refRegistry: "country_ship_of_size_limit",');
  });

  it("keeps capability helpers out of the free-definer export and derives them from the manifest", () => {
    expect(definers).not.toContain("export interface IdProfile {");
    expect(definers).not.toContain("DEFAULT_ID_PROFILE");
    expect(definers).not.toContain("contentCapabilityMethods");
    expect(capability).toContain("export interface IdProfile {");
    expect(capability).toContain('  technology: "tech",');
    expect(capability).toContain('  traditionCategory: "tradition_category",');
    expect(capability).toContain(
      "export function contentCapabilityMethods<P extends string, I extends IdProfile>("
    );
    expect(capability).toContain(
      '): ContentItem<"technology", TechnologyDef<MintedContentId<P, I, "technology", Name>>>;'
    );
    expect(capability).toContain(
      'SituationTypeCapabilityDef<MintedContentId<P, I, "situationType", Name>, T, Approach, Stage>'
    );
    expect(capability).toContain("readonly patchTechnology: typeof patchTechnology;");
    expect(capability).toContain("readonly addShipOfSizeLimits: typeof addShipOfSizeLimits;");
    expect(capability).toContain(
      "The capability mints and owns the full id; the returned branded reference"
    );
    expect(capability).toContain(
      "Unlike a capability definition method, it mints no id and owns no new content."
    );
    expect(capability).toContain(
      "This is an id-less additive contribution, not a capability-owned definition."
    );
  });

  it("derives every nested identity table from repeated-struct metadata", () => {
    const nestedByRegistry = CONTENT_MANIFEST.map((manifest) => {
      const registry = (manifest as ContentManifestEntry).as ?? manifest.type;
      return {
        registry,
        members: emissions
          .get(registry)!
          .emittedFields.filter((field) => field.shape === "repeatedStruct")
          .map((field) =>
            field.field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
          )
          .sort(),
      };
    }).filter((entry) => entry.members.length > 0);

    expect(nestedByRegistry).toEqual([
      { registry: "tradition", members: ["traditionSwap"] },
      { registry: "ascension_perk", members: ["traditionSwap"] },
      { registry: "situation_type", members: ["approach", "stages"] },
    ]);
    for (const { registry, members } of nestedByRegistry) {
      const table = `${registry.toUpperCase()}_NESTED_DEFINITION_MEMBERS`;
      expect(capability).toContain(
        `const ${table} = [${members.map((member) => JSON.stringify(member)).join(", ")}] as const;`
      );
      expect(capability.match(new RegExp(`\\b${table}\\b`, "g"))).toHaveLength(2);
    }
    expect(capability).toContain("function assertNestedDefinitionIds(");
  });
});
