import { describe, expect, it } from "vitest";

import { CONTENT_MANIFEST } from "../../tools/codegen/content-manifest.ts";
import { loadRules } from "../../tools/codegen/cwt/rules.ts";
import { emitContentType } from "../../tools/codegen/emit/content-type.ts";
import { Emitter } from "../../tools/codegen/emit/types.ts";

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
    expect(rules.diagnostics.filter((diagnostic) => manifestSources.has(diagnostic.file))).toEqual(
      []
    );
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

  it("overrides dual bare/modifier_rule declarations that would otherwise pick the wrong shape", () => {
    // bombardment_stance.planet_damage and archaeological_site_type.weight are each
    // declared twice — once as a bare number, once as a modifier_rule block. Without
    // the weightBlock override the field group picks the bare declaration first and
    // silently drops the gated adjustments, the same failure mode opinion_modifier hit.
    const bombardmentStance = emissions.get("bombardment_stance");
    expect(bombardmentStance?.code).toContain("planetDamage?: WeightBlock<ScopeName>;");
    expect(bombardmentStance?.code).toContain('aiWeight: WeightBlock<"fleet">;');

    const archaeologicalSiteType = emissions.get("archaeological_site_type");
    expect(archaeologicalSiteType?.code).toContain('weight?: WeightBlock<"planet">;');
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

  it("declines a struct field that would collide with a localization member name", () => {
    // building.desc (`single_alias_right[triggered_desc_clause]`, a repeated
    // trigger+text struct) would otherwise duplicate the `desc` flavor-text
    // member the type's own localisation table already claims.
    const building = emissions.get("building");
    expect(building?.code).not.toContain("export interface BuildingDesc ");
    expect(building?.unsupported.join("\n")).toContain(
      'desc (collides with the "desc" localization slot)'
    );
    // triggered_desc has no such collision and still lowers.
    expect(building?.code).toContain("export interface BuildingTriggeredDesc");
  });
});
