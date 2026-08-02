import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CONTENT_MANIFEST,
  type ContentManifestEntry,
} from "../../tools/codegen/content-manifest.ts";
import type { CwtDiagnostic } from "../../tools/codegen/cwt/parser.ts";
import { loadRules } from "../../tools/codegen/cwt/rules.ts";
import driftBaseline from "../../tools/codegen/drift-baseline.json" with { type: "json" };
import { emitContentType } from "../../tools/codegen/emit/content-type.ts";
import { Emitter } from "../../tools/codegen/emit/types.ts";
import { pascalCase } from "../../tools/codegen/naming.ts";
import { HAND_WRITTEN_CONTENT_DEFINERS } from "../../tools/codegen/overlay.ts";

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
        'conversion: "ref", refTypes: ["event.scopeless","event.situation"] }'
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
      '{ key: "min_upgrade_cost", member: "minUpgradeCost", shape: "scalarMap" }'
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
    // The assertion is surgical: decision's triggers stay scopeless on purpose,
    // because a decision's own scope really does vary by category.
    expect(emissions.get("decision")?.code).toContain("potential?: Trigger<ScopeName>;");
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
          ? { ...field, scope: { this: "planet", root: null } }
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
        'category: "government_trigger" }'
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
    expect(civicOrOrigin?.emittedFields).toContain("potential");
    expect(civicOrOrigin?.emittedFields).toContain("possible");
    expect(civicOrOrigin?.unsupported.join("\n")).not.toContain("potential");
    expect(civicOrOrigin?.unsupported.join("\n")).not.toContain("possible");
    // leader_background_job_weight (`{ <job> = int }`) was the one field left
    // on this registry's machinery backlog when it landed. `scalarMap` — built
    // once ship_size.min_upgrade_cost turned up needing the same shape —
    // retired it, so the backlog is now empty.
    expect(civicOrOrigin?.machineryBacklog).toEqual([]);
    expect(civicOrOrigin?.emittedFields).toContain("leader_background_job_weight");
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
    expect(sectionTemplate?.emittedFields).toContain("resources");
    expect(sectionTemplate?.emittedFields).toContain("modifier");
    expect(sectionTemplate?.emittedFields).toContain("ship_modifier");
    expect(sectionTemplate?.machineryBacklog).toEqual([]);
  });

  it("generates ambient_object as a name_field registry keyed by name", () => {
    const ambientObject = emissions.get("ambient_object");
    expect(ambientObject?.code).toContain("export interface AmbientObjectDef");
    expect(ambientObject?.code).toContain("entity: ModelEntityRef | string;");
    expect(ambientObject?.code).toContain("showName?: boolean;");
    expect(ambientObject?.machineryBacklog).toEqual([]);
  });

  it("generates graphical_culture with scope-agnostic randomized/selectable triggers", () => {
    // No `## replace_scopes` on either field, unlike ship_selection_weight
    // (pinned to species scope) right below them.
    const graphicalCulture = emissions.get("graphical_culture");
    expect(graphicalCulture?.code).toContain("export interface GraphicalCultureDef");
    expect(graphicalCulture?.code).toContain("randomized?: Trigger<ScopeName>;");
    expect(graphicalCulture?.code).toContain("selectable?: Trigger<ScopeName>;");
    expect(graphicalCulture?.code).toContain('shipSelectionWeight?: WeightBlock<"species">;');
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
        'category: "government_trigger" }'
    );
    // resources/modifier need the same economicResources/modifierBlock help
    // every other registry with those fields already uses.
    expect(speciesClass?.code).toContain("resources?: EconomicResourceBlock<ScopeName>[];");
    expect(speciesClass?.code).toContain('modifier?: ModifierClosure<"pop_group">;');
    // playable carries no `## replace_scopes`, unlike possible/possible_secondary.
    expect(speciesClass?.code).toContain("playable?: Trigger<ScopeName>;");
    // The localisation table nests under `subtype[playable]`, not the type's
    // top level — 26 slots, all recovered.
    expect(speciesClass?.code).toContain('{ member: "plural", pattern: "$_plural"');
    expect(speciesClass?.emittedFields).toContain("possible");
    expect(speciesClass?.emittedFields).toContain("possible_secondary");
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
    expect(countryShipOfSizeLimit?.code).toContain("base: number;");
    expect(countryShipOfSizeLimit?.code).toContain("max?: number;");
    expect(countryShipOfSizeLimit?.code).toContain("navalCapFraction?: number;");
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
});

/**
 * The collection factories, read from the committed output rather than
 * re-emitted: `npm run codegen:check` is what guarantees the file matches the
 * emitter, so asserting against the file also asserts against what ships.
 */
describe("generated content factories", () => {
  const factories = readFileSync("src/generated/content-factories.ts", "utf8");

  it("emits one factory per manifest registry, named by its explicit plural", () => {
    for (const manifest of CONTENT_MANIFEST) {
      const entry = manifest as ContentManifestEntry;
      const registry = entry.as ?? entry.type;
      const name = pascalCase(registry);
      expect(factories, registry).toMatch(
        new RegExp(
          `export function create${pascalCase(entry.plural)}\\(\\s*file\\?: string\\s*\\): ` +
            `${name}Collection \\{`
        )
      );
      expect(factories, registry).toMatch(
        new RegExp(`export interface ${name}Collection\\s+extends Collection<${name}Item>`)
      );
    }
    expect(factories.match(/^export function create/gm)).toHaveLength(CONTENT_MANIFEST.length);
  });

  it("preserves a definition's literal id through its definer", () => {
    // The property the class methods — generic only in the mod prefix —
    // widened away, and what every branded cross-reference downstream needs.
    expect(factories).toContain(
      "  defineTechnology<const Id extends string>(\n" +
        "    def: TechnologyDef<Id>\n" +
        '  ): ContentItem<"technology", TechnologyDef<Id>>;'
    );
  });

  it("keeps patchTechnology on the technology factory alone", () => {
    // A prefixed definition cannot collide with vanilla, but a patch is a
    // whole-object override whose load order and emission are verified per
    // registry — and only technology has that evidence.
    expect(factories.match(/^  patch\w+</gm)).toEqual(["  patchTechnology<"]);
    expect(factories).toContain("patched: transformTechnology(technology, patch)");
  });

  it("keeps addShipOfSizeLimits on the country_ship_of_size_limit factory alone", () => {
    expect(factories.match(/^  add\w+\(/gm)).toEqual(["  addShipOfSizeLimits("]);
    expect(factories).toContain('registry: "ship_of_size_limits",');
  });

  it("takes the XItem unions from the definers module rather than declaring them", () => {
    // The unions describe what a collection of a registry's items can hold,
    // which outlives the factory that used to be the only way to build one —
    // so they are emitted beside the free definers and imported here. Two
    // `export *` sources in src/index.ts must not both export the same name.
    expect(factories).not.toMatch(/^export type \w+Item =/m);
    expect(factories).toContain('} from "./content-definers.ts";');
  });

  it("takes situation_type's definer from the hand-written graft", () => {
    // HAND_WRITTEN_CONTENT_DEFINERS, the HAND_WRITTEN_TRIGGERS arrangement one
    // level up: no mechanical defineSituationType is emitted beside the graft,
    // because `targetScope` is a contract the rules describe nowhere.
    expect(HAND_WRITTEN_CONTENT_DEFINERS.has("situation_type")).toBe(true);
    expect(factories).not.toContain("defineSituationType<const Id");
    expect(factories).toContain(
      "export interface SituationTypeCollection\n" +
        "  extends Collection<SituationTypeItem>, SituationTypeDefiner {}"
    );
    expect(factories).toContain("    ...situationTypeDefiner(items),");
    // Every other registry still gets its mechanical definer.
    expect(factories.match(/^  define\w+<const Id/gm)).toHaveLength(CONTENT_MANIFEST.length - 1);
  });
});

/**
 * The free definers (SDK-23), read from the committed output for the same
 * reason: `codegen:check` is what ties the file to the emitter.
 *
 * The claim is that all 34 definers are importable from this one module — 33
 * mechanical, one re-exported from the hand-written graft — and that none of
 * them registers anything, which is what makes `collection(...)` and
 * `discoverContent` the only things that decide placement.
 */
describe("generated content definers", () => {
  const definers = readFileSync("src/generated/content-definers.ts", "utf8");

  it("emits one free definer and one item union per manifest registry", () => {
    for (const manifest of CONTENT_MANIFEST) {
      const entry = manifest as ContentManifestEntry;
      const name = pascalCase(entry.as ?? entry.type);
      expect(definers, entry.type).toContain(`export type ${name}Item =`);
      expect(definers, entry.type).toMatch(new RegExp(`\\bdefine${name}\\b`));
    }
    // 33 mechanical `export function defineX` plus the graft's re-export.
    expect(definers.match(/^export function define\w+<const Id extends string>\(/gm)).toHaveLength(
      CONTENT_MANIFEST.length - HAND_WRITTEN_CONTENT_DEFINERS.size
    );
    expect(definers).toContain('export { defineSituationType } from "../factories.ts";');
    expect(definers).not.toContain("export function defineSituationType");
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
    expect(definers).toContain('refRegistry: "country_ship_of_size_limit",');
  });
});
