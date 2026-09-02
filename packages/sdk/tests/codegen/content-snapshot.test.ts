import { readFileSync } from "node:fs";
import type { RuleField } from "@pdx-ts/codegen-cwt/cwt/model";
import { emitAliasSplice } from "@pdx-ts/codegen-cwt/emit/content/alias-splice";
import { emitContentType } from "@pdx-ts/codegen-cwt/emit/content/content-type";
import { pickOrdinary } from "@pdx-ts/codegen-cwt/emit/content/field-projection";
import type { FieldContext } from "@pdx-ts/codegen-cwt/emit/scope-context";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/typescript";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import type { EmittedField } from "@pdx-ts/codegen-cwt/lower/content-model";
import { camelCase, constantCase, pascalCase } from "@pdx-ts/codegen-cwt/naming";
import {
  CONTENT_DECLINED_FIELDS,
  CONTENT_PATCH_REGISTRIES,
  HAND_WRITTEN_CONTENT_DEFINERS,
} from "@pdx-ts/codegen-cwt/overlay";
import {
  CONTENT_MANIFEST,
  registryNameOf,
  type ContentManifestEntry,
} from "@pdx-ts/codegen-cwt/policy/manifest";
import { describe, expect, it } from "vitest";

/** Just the names: the emitter now describes each field's lowered shape too. */
function fieldNames(fields: readonly EmittedField[]): string[] {
  return fields.map((field) => field.field);
}

/** Every member named by one key's dual descriptor: the dual itself, then its arms. */
function dualMembers(code: string, key: string): string[] {
  const descriptor = code
    .split("\n")
    .find((line) => line.includes(`key: ${JSON.stringify(key)}`) && line.includes('shape: "dual"'));
  return [...(descriptor ?? "").matchAll(/member: "(\w+)"/g)].map((match) => match[1]!);
}

/** The member names one emitted interface declares, in declaration order. */
function interfaceMembers(code: string, name: string): string[] {
  // Generic parameters and an `extends` clause may sit between the name and
  // the body: a subtype arm extends the registry's base interface.
  const start = code.search(new RegExp(`^export interface ${name}\\b[^{]*\\{`, "m"));
  if (start === -1) {
    return [];
  }
  const body = code.slice(start, code.indexOf("\n}", start));
  return [...body.matchAll(/^ {2}(?:readonly )?(\w+)\??:/gm)].map((match) => match[1]!);
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
    // type[component_template] and each is its own registry. The subtype the
    // registry narrows to is a separate argument — `spriteType` is
    // `subtype[normal]`, and its name names no subtype at all.
    const entry: ContentManifestEntry = manifest;
    const registry = registryNameOf(entry);
    emitter.beginFile();
    const emission = emitContentType(emitter, type, body, registry, entry.as);
    emitter.endFile();
    return [registry, emission] as const;
  })
);

describe("content-type codegen", () => {
  it("generates relic, mission, and mission-category authoring surfaces", () => {
    const relic = emissions.get("relic");
    const mission = emissions.get("mission");
    const missionCategory = emissions.get("mission_category");

    expect(relic?.code).toContain('possible: Trigger<"country">;');
    expect(mission?.code).toContain("export interface MissionCounterDefinition");
    expect(mission?.code).toContain(
      "counter?: Readonly<Record<string, MissionCounterDefinition>>;"
    );
    // The contract arm is selected by the category's qualified reference; the
    // plain arm refuses an authored category whose witness selects it.
    expect(mission?.code).toContain("category: MissionCategoryContractRef;");
    expect(mission?.code).toContain(
      "category?: (MissionCategoryRef & { readonly def?: { readonly isContract?: false } }) | string;"
    );
    expect(mission?.code).toContain("/** One named counter definition for a mission. */");
    expect(mission?.code).toContain(
      "/** Maximum counter value shown in the mission's localized counter display. */"
    );
    expect(mission?.code).toContain("potentialOperator?: WithFrom<");
    expect(mission?.code).toContain('readonly from: NoInfer<L>; readonly fromfrom: "country"');
    expect(mission?.code).toContain("onAccept?: EffectBlock<");
    expect(mission?.code).toContain("readonly fromfrom: NoInfer<L>;");
    expect(mission?.code).toContain("aiWeight?: WithFrom<");
    expect(missionCategory?.code).toContain("isContract: boolean;");
  });

  it("declines ambiguous mixed trigger structs instead of dropping declarations", () => {
    const field = (key: RuleField["key"]): RuleField => ({
      key,
      type:
        key.kind === "aliasName"
          ? { kind: "aliasMatchLeft", category: key.category }
          : { kind: "int", range: null },
      cardinality: { min: 0, max: 1 },
      docs: [],
      scope: null,
      line: 1,
      comparison: false,
    });
    const trigger = field({ kind: "aliasName", category: "trigger" });
    const sibling = field({ kind: "name", name: "text" });
    const ctx: FieldContext = { scope: null, unpinned: "ScopeName" };
    const mixed = (fields: readonly RuleField[]) => ({
      ...sibling,
      type: { kind: "block" as const, fields, bare: [] },
    });
    expect(
      pickOrdinary(
        emitter,
        [
          mixed([
            trigger,
            sibling,
            field({ kind: "computed", type: { kind: "int", range: null } }),
          ]),
        ],
        "mixed",
        ctx,
        undefined,
        undefined,
        "test.mixed"
      )
    ).toBeNull();
    expect(
      pickOrdinary(
        emitter,
        [mixed([trigger, sibling, field({ kind: "aliasName", category: "effect" })])],
        "mixed",
        ctx,
        undefined,
        undefined,
        "test.mixed"
      )
    ).toBeNull();
    expect(
      pickOrdinary(
        emitter,
        [mixed([trigger, sibling, field({ kind: "name", name: "when" })])],
        "mixed",
        ctx,
        undefined,
        undefined,
        "test.mixed"
      )
    ).toBeNull();
  });

  it("parses every manifest source without unrecorded recovery", () => {
    const manifestSources = new Set<string>(CONTENT_MANIFEST.map((entry) => entry.source));

    expect(
      rules.diagnostics
        .filter((diagnostic) => manifestSources.has(diagnostic.file))
        .map((diagnostic) => `${diagnostic.file}:${diagnostic.line} ${diagnostic.text}`)
        .sort()
    ).toEqual([]);
  });

  it("carries a registry's body scope into trigger fields", () => {
    expect(emissions.get("building")?.code).toContain('allow?: Trigger<"colony">;');
    expect(emissions.get("building")?.code).toContain('potential?: Trigger<"colony">;');
    expect(emissions.get("building")?.code).toContain(
      'aiResourceProduction?: EconomicResourceOperation<"colony">[];'
    );
    expect(emissions.get("building")?.code).toContain(
      '{ key: "ai_resource_production", member: "aiResourceProduction", shape: "economicResourceOperation", form: "block", repeated: true }'
    );
    expect(emissions.get("building")?.nestedEmittedFields).toContainEqual({
      field: "building.ai_resource_production.trigger",
      authoredPath: ["aiResourceProduction"],
      shape: "trigger",
      repeated: false,
      clause: "trigger",
      scope: ["colony"],
    });
    expect(emissions.get("building")?.corpusDescents).toContainEqual({
      field: "ai_resource_production",
      mode: "economicResourceOperationTrigger",
      children: [],
    });
  });

  it("lowers the player-crisis route with branded links and country closures", () => {
    const resource = emissions.get("resource");
    const path = emissions.get("crisis_path");
    const level = emissions.get("crisis_level");
    const objective = emissions.get("crisis_objective");
    const perk = emissions.get("menace_perk");

    expect(resource?.code).toContain("export interface ResourceFieldsBase {");
    expect(path?.code).toContain("crisisCurrency: CrisisCurrencyRole;");
    expect(path?.code).toContain('localizationFamily: "crisis_currency"');
    expect(path?.code).toContain("levels: (CrisisLevelRef | string)[];");
    expect(path?.code).toContain("objectives: (CrisisObjectiveRef | string)[];");
    expect(level?.code).toContain('allow?: Trigger<"country">;');
    expect(level?.code).toContain("perks: (MenacePerkRef | string)[];");
    expect(level?.code).toContain(
      'onUnlock: EffectBlock<"country", { readonly root: "country" }>;'
    );
    expect(objective?.code).toContain('potential?: Trigger<"country">;');
    expect(perk?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(perk?.code).toContain(
      'onUnlock?: EffectBlock<"country", { readonly root: "country" }>;'
    );
  });

  it("emits repeated-struct definitions as data-driven field tables", () => {
    const tradition = emissions.get("tradition");
    expect(tradition?.code).toContain("export interface TraditionSwapFields");
    expect(tradition?.code).toContain('shape: "repeatedStruct"');
    expect(tradition?.code).toContain('keying: "siblings"');
    // Read off type[swapped_tradition]'s own `name_field = name`, the same
    // statement the top level reads for an id-in-a-body-field registry.
    expect(tradition?.code).toContain('identityKey: "name"');
    expect(tradition?.code).toContain("fields: TRADITION_SWAP_FIELDS");
    expect(tradition?.code).toContain(
      "traditionSwap?: Readonly<Record<string, TraditionSwapFields>>;"
    );
    // The identity key is not also a body field: the record key carries it.
    const swapFields = fieldNames(tradition?.nestedEmittedFields ?? []);
    expect(swapFields).toContain("tradition.tradition_swap.modifier");
    expect(swapFields).not.toContain("tradition.tradition_swap.name");
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
    expect(agenda?.code).toContain(
      'initEffect?: EffectBlock<"country", { readonly root: "country" }>;'
    );
    expect(agenda?.code).toContain(
      'effect?: EffectBlock<"country", { readonly root: "country" }>;'
    );
    expect(agenda?.code).toContain('StaticModifierHostContract<"country">');
    expect(agenda?.code).toContain("StaticModifierRef & { readonly hostScope?: never }");
    expect(agenda?.code).toContain('shape: "effect"');
    expect(emissions.get("ascension_perk")?.code).toContain(
      'onEnabled?: EffectBlock<"country", { readonly root: "country" }>;'
    );
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
    // SDK-63: technology's own modifier_clause, at both levels the rules
    // declare it. Each carries its own
    // `## replace_scopes = { this = country root = country }`
    // (technologies_consolidated.cwt:237-238 and 162-163) — the nested one is
    // not inherited from the parent field, it is declared again inside the
    // technology_swap struct, and the struct's members are typed against the
    // same context the top level's are.
    expect(emissions.get("technology")?.code).toContain('modifier?: ModifierClosure<"country">;');
    const swapBody = emissions
      .get("technology")
      ?.code?.match(/export interface TechnologyTechnologySwap \{([\s\S]*?)\n\}/)?.[1];
    expect(swapBody).toContain('modifier?: ModifierClosure<"country">;');
    // Both are named to the corpus gate under the paths it measures, which is
    // what retires their `corpus-gaps.ts` rows: a member that only exists on
    // the interface leaves the nested path unexpressed.
    expect(fieldNames(emissions.get("technology")!.emittedFields)).toContain("modifier");
    expect(fieldNames(emissions.get("technology")!.nestedEmittedFields)).toContain(
      "technology.technology_swap.modifier"
    );
  });

  it("expands an enum-keyed block into one member per key (SDK-64)", () => {
    // `enum[prereq_for_category] = { title = localisation … }` names its keys
    // exactly, unlike `scalar = { … }`, so the block lowers with no overlay row
    // to disambiguate it: one member per enum value, in the SDK's own
    // camelCase, beside the ordinary `hide_prereq_for_desc` sibling the same
    // block declares.
    const technology = emissions.get("technology")!;
    const body = technology.code.match(
      /export interface TechnologyPrereqforDesc \{([\s\S]*?)\n\}/
    )?.[1];
    expect(body).toContain("hidePrereqForDesc?: PrereqForCategory[];");
    expect(body).toContain("diploAction?: TechnologyPrereqforDescEntry[];");
    // One entry interface for all six keys: the rules declare one shape, and
    // six structurally identical interfaces would put that duplication in the
    // public API.
    expect(technology.code.match(/export interface TechnologyPrereqforDescEntry \{/g)).toHaveLength(
      1
    );
    expect(technology.code).toContain('key: "diplo_action", member: "diploAction"');
    // Named to the corpus gate at each key's own path, which is what retires
    // the `corpus-gaps.ts` rows — the reader records `prereqfor_desc.custom`
    // and its interior separately per key, so one shared interface still has
    // to claim all of them.
    const nested = fieldNames(technology.nestedEmittedFields);
    expect(nested).toContain("technology.prereqfor_desc.custom");
    expect(nested).toContain("technology.prereqfor_desc.custom.title");
    expect(nested).toContain("technology.prereqfor_desc.hide_prereq_for_desc");
    expect(nested).toContain("technology.technology_swap.prereqfor_desc.custom.desc");
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
    // The modifier body keeps the field's replace scope, while the nested
    // potential follows the clause's own planet push_scope.
    expect(emissions.get("building")?.code).toContain(
      'triggeredCountryModifier?: TriggeredModifier<"country", "planet">[];'
    );
    expect(emissions.get("building")?.code).toContain(
      'triggeredArmyModifier?: TriggeredModifier<"army", "planet">[];'
    );
    expect(emissions.get("building")?.code).toContain(
      'triggeredPlanetPopGroupModifierForAll?: TriggeredModifier<"pop_group", "planet">[];'
    );
    // SDK-56: the seventh field, caught in review — for_species splices
    // triggered_modifier_by_pop_group_clause, not the by_planet_clause the
    // other three splice, but reuses the same triggeredModifierBlock shape
    // job.triggered_planet_pop_group_modifier_for_species (SDK-39) already
    // proved out for that clause.
    expect(emissions.get("building")?.code).toContain(
      'triggeredPlanetPopGroupModifierForSpecies?: TriggeredModifier<"pop_group">[];'
    );
    expect(emissions.get("situation_type")?.code).toContain(
      'triggeredModifier?: TriggeredModifier<"country", "situation">[];'
    );
    expect(emissions.get("situation_type")?.code).toContain(
      'triggeredTargetModifier?: TriggeredModifier<ScopeName, "situation">[];'
    );
  });

  it("refuses a triggered-modifier shape without one nested potential declaration", () => {
    const body = rules.bodies.get("building")!;
    const malformed = {
      ...body,
      fields: body.fields.map((field) =>
        field.key.kind === "name" &&
        field.key.name === "triggered_country_modifier" &&
        field.type.kind === "block"
          ? { ...field, type: { ...field.type, fields: [] } }
          : field
      ),
    };
    const isolated = new Emitter(rules);
    isolated.beginFile();
    expect(() =>
      emitContentType(isolated, rules.contentTypes.get("building")!, malformed, "building")
    ).toThrow("A triggered-modifier block must expand to exactly one named potential declaration");
  });

  it("refuses an economic operation shape that would drop a declared sibling", () => {
    const body = rules.bodies.get("building")!;
    const malformed = {
      ...body,
      fields: body.fields.map((field) =>
        field.key.kind === "name" &&
        field.key.name === "ai_resource_production" &&
        field.type.kind === "block"
          ? {
              ...field,
              type: {
                ...field.type,
                fields: field.type.fields.filter(
                  (inner) =>
                    !(
                      inner.key.kind === "computed" &&
                      inner.key.type.kind === "enum" &&
                      inner.key.type.name === "complex_maths_enum"
                    )
                ),
              },
            }
          : field
      ),
    };
    const isolated = new Emitter(rules);
    isolated.beginFile();
    expect(() =>
      emitContentType(isolated, rules.contentTypes.get("building")!, malformed, "building")
    ).toThrow(
      "An economic-resource operation field must declare exactly one open <resource> numeric arm, one 0..1 pure trigger alias, and complex_maths_enum value-field arm"
    );
  });

  it("refuses a repeated trigger in an economic resource operation", () => {
    const body = rules.bodies.get("building")!;
    const malformed = {
      ...body,
      fields: body.fields.map((field) =>
        field.key.kind === "name" &&
        field.key.name === "ai_resource_production" &&
        field.type.kind === "block"
          ? {
              ...field,
              type: {
                ...field.type,
                fields: field.type.fields.map((inner) =>
                  inner.key.kind === "name" && inner.key.name === "trigger"
                    ? { ...inner, cardinality: { min: 0, max: null } }
                    : inner
                ),
              },
            }
          : field
      ),
    };
    const isolated = new Emitter(rules);
    isolated.beginFile();
    expect(() =>
      emitContentType(isolated, rules.contentTypes.get("building")!, malformed, "building")
    ).toThrow(
      "An economic-resource operation field must declare exactly one open <resource> numeric arm, one 0..1 pure trigger alias, and complex_maths_enum value-field arm"
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
    expect(agenda?.code).toContain("name: LocalizedText;");
    expect(agenda?.code).toContain("desc?: LocalizedText;");
    expect(agenda?.code).not.toContain("councilAgendaName");
    expect(agenda?.localisationAliases).toEqual([
      "agenda.localisation.council_agenda_name (council_agenda_$_name) duplicates name at council_agenda_$_name",
      "agenda.localisation.council_agenda_desc (council_agenda_$_desc) duplicates desc at council_agenda_$_desc",
    ]);
  });

  it("excludes localization patterns with no $ id placeholder rather than emit an unusable member", () => {
    const job = emissions.get("job");
    expect(job?.code).toContain("name: LocalizedText;");
    expect(job?.code).toContain("desc?: LocalizedText;");
    // Only one `desc` member survives on JobFields itself even though the rules
    // declare it twice — struct-shaped fields nested elsewhere in the file (like
    // swappable_data's own `desc`) are unrelated members and legitimately reuse
    // the name, so the check is scoped to the top-level interface body.
    const jobFieldsBody = job?.code?.match(/export interface JobFields \{([\s\S]*?)\n\}/)?.[1];
    expect(jobFieldsBody?.match(/\bdesc\??: LocalizedText;/g)).toHaveLength(1);
    // The excluded patterns point at swappable_data's own `desc`/`condition_string`
    // body fields — struct lowering now expresses those as ordinary members on
    // JobSwappableDataDefault, an unrelated field the loc-alias exclusion above
    // does not (and should not) suppress.
    expect(job?.code).toContain("conditionString?: LocalizationInput;");
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
      'resources?: WithFrom<EconomicResourceBlock<NoInfer<S>>[], NoInfer<S>, { readonly root: "carrier"; readonly from: "country" }>;'
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
      const emitted = new Set(fieldNames(emission.emittedFields));
      const absent = [
        ...emission.declinedFields.map((line) => line.split(" — ")[0]!),
        ...emission.unsupported.map((line) => line.split(" (")[0]!),
      ].map((field) => field.replace(`${registry}.`, ""));
      // A field is in exactly one bucket: an absent field the emitter also
      // emitted would make either number a lie.
      for (const field of absent) {
        expect(emitted.has(field), field).toBe(false);
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
    // SDK-30's `change_orbit` rows are positional sugar that an array-shaped
    // member cannot represent. SDK-295 restores the mission contract fields,
    // so no mission row remains in this explicit refusal table.
    expect([...CONTENT_DECLINED_FIELDS.keys()]).toEqual([
      "solar_system_initializer.change_orbit",
      "planet_initializer.change_orbit",
      "moon_initializer.change_orbit",
    ]);
  });

  it("asserts the widening arity direction too, where a 0..1 key repeats in the corpus", () => {
    // The mirror of the row above, and the more damaging direction: a `0..1`
    // the game contradicts does not merely make the member awkward, it makes
    // the second block unwritable. megastructures.cwt:221-223 declares
    // triggered_country_modifier `0..1`; vanilla's shroud_seal writes two,
    // gating different modifiers on different potentials, so an
    // `arity: "repeated"` row lifts the member to a list.
    const megastructure = emissions.get("megastructure")!;
    expect(megastructure.code).toContain(
      'triggeredCountryModifier?: TriggeredModifier<"country">[];'
    );
    // The descriptor the writer reads has to agree with the member type —
    // asserting the cardinality once, before either is derived, is what keeps
    // them from disagreeing.
    expect(megastructure.code).toContain('form: "list"');
    expect(
      megastructure.emittedFields.find((field) => field.field === "triggered_country_modifier")
        ?.repeated
    ).toBe(true);
    // The assertion is scoped to the one field that earned it: country_modifier
    // sits beside it under the same rules and stays singular.
    expect(megastructure.code).toContain('countryModifier?: ModifierClosure<"country">;');
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
      'aiWeight?: WithFrom<WeightBlock<"country">, "country", { readonly root: "country"; readonly from: "country" }>;'
    );
    // forbidden_peace_offers is a fixed-shape anonymous block — the same struct
    // shape shape 3 generalizes down to cardinality 0..1 — so it is no longer
    // stuck on the machinery backlog.
    expect(warGoal?.code).toContain("forbiddenPeaceOffers?: WarGoalForbiddenPeaceOffers;");
    expect(warGoal?.code).toContain('shape: "struct"');
    expect(warGoal?.unsupported.join("\n")).not.toContain("forbidden_peace_offers");
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
      'planetDamage?: number | WithFrom<WeightBlock<"fleet">, "fleet", { readonly root: "fleet"; readonly from: "planet" }>;'
    );
    // A pure modifier_rule splice needs no overlay row either — it infers weightBlock.
    expect(bombardmentStance?.code).toContain(
      'aiWeight: WithFrom<WeightBlock<"fleet">, "fleet", { readonly root: "fleet"; readonly from: "planet" }>;'
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
      'onRollFailed: EffectBlock<"fleet", { readonly root: "fleet"; readonly from: "archaeological_site" }>;'
    );
    // The same registry's on_create is `{ root = archaeological_site this =
    // archaeological_site }` — no FROM in a `replace_scopes` means cleared, so
    // the FROM slot stays the undeclared sentinel while ROOT is spelled.
    expect(archaeologicalSiteType?.code).toContain(
      'onCreate?: EffectBlock<"archaeological_site", { readonly root: "archaeological_site" }>;'
    );
    // Each registry's own rules decide the scope, rather than one convention:
    // a war goal's FROM is the targeted country.
    expect(emissions.get("war_goal")?.code).toContain(
      'onAccept?: EffectBlock<"country", { readonly root: "country"; readonly from: "country" }>;'
    );
  });

  it("carries a block's declared ROOT independently of the scope it runs in", () => {
    // `## replace_scopes = { this = planet root = country prev = system ... }`
    // on a planet initializer's init_effect. THIS and ROOT are different
    // scopes here, and vanilla's own `root = { ... }` inside one of these runs
    // against the fallen empire — typing ROOT as the block's own scope would
    // both admit planet effects the game rejects and reject the country
    // operations the block reaches for ROOT to perform.
    expect(emitAliasSplice(emitter, "planet_initializer")?.code).toContain(
      'initEffect?: EffectBlock<"planet", { readonly root: "country"; readonly prev: "system"; readonly prevprev: "system" }>;'
    );
    expect(emitAliasSplice(emitter, "planet_initializer")?.code).toContain(
      'shape: "effect", form: "closure", splitRoot: true'
    );
    expect(emitAliasSplice(emitter, "moon_initializer")?.code).toContain(
      'shape: "effect", form: "closure", splitRoot: true'
    );
    // `root = any` names no scope, so it stays unreadable rather than lowering
    // to something an author could navigate — the same rule `from = any`
    // already follows. The top-level init_effect is that case.
    expect(emissions.get("solar_system_initializer")?.code).toContain(
      'initEffect?: EffectBlock<"system", {}>;'
    );
    // A `push_scope` states only THIS, and an unannotated field states
    // nothing, so neither invents a ROOT.
    expect(emissions.get("building")?.code).not.toContain("EffectBlock<NoInfer<S>, undefined,");
    expect(emissions.get("agenda")?.code).not.toContain("splitRoot: true");
  });

  it("gives a declarative field with a FROM the closure form too", () => {
    // A trigger and a weight block are values, so FROM reaches them through an
    // added closure form rather than through an argument list they never had.
    const archaeologicalSiteType = emissions.get("archaeological_site_type");
    expect(archaeologicalSiteType?.code).toContain(
      'allow: WithFrom<Trigger<"fleet">, "fleet", { readonly root: "fleet"; readonly from: "archaeological_site" }>;'
    );
    // A field with no FROM keeps the plain type: the closure form exists to
    // carry FROM, so a field without one has nothing to offer it.
    expect(emissions.get("building")?.code).toContain('allow?: Trigger<"colony">;');
    expect(emissions.get("building")?.code).not.toContain("WithFrom");
    // A dual keeps arm-by-arm dispatch: only the arm that can hold a condition
    // grows the closure form.
    expect(emissions.get("opinion_modifier")?.code).toContain(
      'opinion: WithFrom<WeightBlock<"country">, "country", { readonly root: "country"; readonly from: "country" }> | number;'
    );
  });

  it("lowers repeated siblings with no id (shape 3) as an anonymous struct list", () => {
    // scripted_loc.text: `text = { trigger = { ... } localization_key = ... }`
    // written N times as siblings, exactly the settled shape 3 example.
    const scriptedLoc = emissions.get("scripted_loc");
    expect(scriptedLoc?.code).toContain("export interface ScriptedLocText");
    expect(scriptedLoc?.code).toContain("text?: ScriptedLocText[];");
    expect(scriptedLoc?.code).toContain('{ key: "text", member: "text", shape: "struct"');
    expect(scriptedLoc?.unsupported.join("\n")).not.toContain("text");

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
    expect(warGoal?.code).toContain("demandSurrender?: LocalizationInput;");
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
    expect(agreementPreset?.unsupported.join("\n")).not.toContain("term_data");
  });

  it("generates situations' stages (container keying) and approach (siblings keying)", () => {
    // situations is repeated-struct's first "container" consumer: stages =
    // { stage_1 = { ... } } keys each entry by its own block key rather than a
    // body field, distinct from approach's siblings shape (tradition_swap's
    // shape) which carries its id in a body field ("name").
    //
    // The keying is read off the declaration, not configured: stages' block
    // declares one wildcard key ("scalar = { ... }"), approach's declares its
    // entry's own fields.
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
    expect(situation?.code).toContain(
      'onSelect?: EffectBlock<"situation", { readonly root: "situation" }>;'
    );
    expect(situation?.code).toContain('resources?: EconomicResourceBlock<"situation">[];');
    expect(situation?.code).toContain(
      'onFirstEnter?: EffectBlock<"situation", { readonly root: "situation" }>;'
    );
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

  it("emits a readable subtype arm as named union members (SDK-360)", () => {
    // `subtype[!start]` requires `cost` and `weight`; `subtype[start]` leaves
    // them optional. Read flat both were optional, and a non-start technology
    // without a cost typechecked.
    const technology = emissions.get("technology");
    expect(technology?.subtypeUnions).toEqual([
      "start (`start_tech = yes`)",
      "repeatable (a written `levels`)",
    ]);
    expect(technology?.code).toContain(
      "export interface TechnologyStartFields extends TechnologyFieldsBase {"
    );
    expect(technology?.code).toContain(
      "export interface TechnologyPlainFields extends TechnologyFieldsBase {"
    );
    const armOf = (name: string) => interfaceMembers(technology?.code ?? "", name);
    expect(armOf("TechnologyStartFields")).toContain("startTech");
    expect(technology?.code).toMatch(/TechnologyStartFields[^]*?startTech: true;/);
    expect(technology?.code).toMatch(
      /TechnologyPlainFields[^]*?cost: number \| WeightBlock<never>;/
    );
    expect(technology?.code).toMatch(/TechnologyPlainFields[^]*?weight: number;/);
    expect(technology?.code).toMatch(/TechnologyPlainFields[^]*?startTech\?: false;/);
    // start × repeatable is contradictory (`levels` selects repeatable and a
    // start technology may not carry it), so only three arms exist.
    expect(technology?.code).toContain(
      "export type TechnologyFields =\n  | TechnologyStartFields\n  | TechnologyRepeatableFields\n  | TechnologyPlainFields;"
    );
    expect(technology?.code).toContain("export type TechnologyDef<Id extends string = string> =");
    expect(technology?.code).toContain(
      "export interface TechnologyPlainDef<Id extends string = string> extends TechnologyPlainFields {"
    );
    // The base keeps no claimed member and no flat "Only when" line.
    expect(interfaceMembers(technology?.code ?? "", "TechnologyFieldsBase")).not.toContain("cost");
    expect(technology?.code).not.toContain("Only when technology subtype");
    // The ledger records a claimed member as optional, with the arm's condition.
    const docs = technology?.docTables[0]?.members;
    expect(docs?.cost).toMatchObject({
      optional: true,
      docs: ["Required unless `startTech: true`."],
    });
    expect(technology?.publicTypes).toEqual(
      expect.arrayContaining([
        "TechnologyFieldsBase",
        "TechnologyStartFields",
        "TechnologyPlainDef",
      ])
    );
  });

  it("models a reference-selected arm through the referenced registry's witness (SDK-296)", () => {
    const mission = emissions.get("mission");
    expect(mission?.subtypeUnions).toEqual(["contract (`category = <mission_category.contract>`)"]);
    expect(mission?.subtypeCollapses).toEqual([]);
    expect(mission?.code).toContain("export interface MissionContractFields<");
    expect(mission?.code).toContain("export interface MissionPlainFields<");
    // The contract arm requires what `subtype[contract]` requires and the
    // plain arm forbids what it alone declares.
    expect(mission?.code).toMatch(
      /MissionContractFields<[\s\S]*?eventChain: EventChainRef \| string;/
    );
    expect(mission?.code).toMatch(
      /MissionPlainFields<[\s\S]*?eventChain\?: EventChainRef \| string;/
    );
    expect(mission?.code).toMatch(/MissionPlainFields<[\s\S]*?timeToAccept\?: never;/);
    // The location declaration belongs to contracts: the plain arm refuses it,
    // and keeps `L` so its callbacks are contextually typed like the contract arm's.
    const armBody = (name: string) =>
      mission!.code.slice(mission!.code.indexOf(`export interface ${name}<`)).split("\n}\n")[0]!;
    expect(armBody("MissionPlainFields")).toContain("locationScope?: never;");
    expect(armBody("MissionContractFields")).not.toContain("locationScope?: never;");
    // The qualified reference the arm spells is registered for refs.ts by the
    // emission that spells it.
    expect(emitter.usedRefs.has("mission_category.contract")).toBe(true);
  });

  it("collapses a required arm the type cannot state into a visible row (SDK-360)", () => {
    // An overlay row keeps a contradicted arm flat, naming the measurement.
    const shipSize = emissions.get("ship_size");
    expect(shipSize?.subtypeUnions).toEqual([
      "space_fauna (`is_space_fauna_ship = yes`)",
      "arkship (a written `carries_colony`)",
    ]);
    expect(shipSize?.subtypeCollapses).toEqual([
      expect.stringContaining("ship_size.evaluation_resource required under subtype[bio_ship]"),
    ]);
  });

  it("merges a field declared as different literals across subtypes into the union", () => {
    // progress_direction is `monodirectional` in one subtype declaration and
    // `bidirectional` in the other; first-wins picking had made the second —
    // and the two fields it gates — unreachable through the typed API.
    const situation = emissions.get("situation_type");
    expect(situation?.code).toContain('progressDirection?: "monodirectional" | "bidirectional";');
    expect(situation?.code).toContain("completeCategory?: SituationCategory;");
  });

  it("derives a conditionally required localisation slot from its subtype", () => {
    // type[swapped_tradition] declares `name = "$"` inside
    // subtype[not_inheriting_name], whose body — `## cardinality = 0..0
    // inherit_name = yes` — says the subtype covers every swap that does not
    // write inherit_name. The two facts together are the requirement.
    expect(emissions.get("tradition")?.code).toContain(
      '{ member: "name", pattern: "$", required: false, requiredUnless: "inheritName" }'
    );
    expect(emissions.get("ascension_perk")?.code).toContain(
      '{ member: "name", pattern: "$", required: false, requiredUnless: "inheritName" }'
    );
    // The `## optional` slots in the same subtype blocks state their own
    // requiredness, so nothing is derived for them.
    expect(emissions.get("tradition")?.code).toContain(
      '{ member: "flavor", pattern: "$_delayed", required: false }'
    );
    // A slot declared outside any subtype has no discriminator to read.
    expect(emissions.get("tradition")?.code).toContain(
      '{ member: "name", pattern: "$", required: true }'
    );
  });

  it("renames a struct field that would collide with a localization member name", () => {
    // building.desc (`single_alias_right[triggered_desc_clause]`, a repeated
    // trigger+text struct) would otherwise duplicate the `desc` flavor-text
    // member the type's own localisation table already claims, so the collision
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
    expect(situation?.code).toContain("conditionalDesc?: LocalizationInput | SituationTypeDesc[];");
    // The rename has to reach the arms too: the writer resolves an arm by its
    // own member name, so an arm left as `desc` would be unreachable. The
    // member is rendered from the name the emitter settled on, once for the
    // dual and once per arm.
    expect(situation?.code).not.toContain('member: "desc", shape: "struct"');
    expect(dualMembers(situation!.code, "desc")).toEqual([
      "conditionalDesc",
      "conditionalDesc",
      "conditionalDesc",
    ]);
  });

  it("derives every localization rename from the collision, and only those", () => {
    // One rule over the slot set `planLocalisation` produces, so the four the
    // rules collide on their own and the one SYNTHETIC_LOCALISATION
    // manufactures come out of the same place.
    const renamed = [...emissions].flatMap(([registry, emission]) =>
      emission.localisationRenames.map(() => registry)
    );
    expect(renamed.sort()).toEqual([
      "archaeological_site_type",
      "building",
      "mission",
      "situation_type",
      "special_project",
      "tradition_category",
    ]);
    for (const [, emission] of emissions) {
      for (const line of emission.localisationRenames) {
        expect(line).toContain('authors as "conditionalDesc"');
      }
      // A rename only ever happens where a collision does, so no registry is
      // left reporting one as unlowerable.
      expect(emission.unsupported.join("\n")).not.toContain("localization slot");
    }
  });

  it("points a synthetic localisation slot at the body member the rename produced", () => {
    // archaeology.cwt declares no `$`-bearing desc pattern, so the slot is
    // synthetic — the game still reads its text through the body's own `desc`
    // key, which the collision that slot creates renames to `conditionalDesc`.
    // The pointer is that rename, not a second spelling of it.
    expect(emissions.get("archaeological_site_type")?.code).toContain(
      '{ member: "desc", pattern: "$_desc", required: false, pointerMember: "conditionalDesc" }'
    );
    // situation_type's `desc = "$_desc"` is the game's own declared key, so its
    // slot needs no pointer even though its body field renames identically.
    expect(emissions.get("situation_type")?.code).not.toContain("pointerMember");
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
  });

  it("lowers a top-level unkeyed modifier splice into one authoring member", () => {
    // static_modifier's rule is `{ alias_name[modifier] = alias_match_left[modifier]
    // icon = filepath ... }` — the modifier grammar is the body itself, which
    // mergeByName cannot see because the key is a splice rather than a name.
    // Without it the registry could set an icon and a tooltip but never a
    // modifier, which is the whole point of a static modifier.
    const staticModifier = emissions.get("static_modifier");
    expect(staticModifier?.inlineSplices).toEqual(["modifier"]);
    expect(staticModifier?.code).toContain("hostScope: S;");
    expect(staticModifier?.code).toContain("modifiers?: ModifierClosure<NoInfer<S>>;");
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
      "randomEvents?: readonly {\n" +
        "/**\n" +
        " * Relative selection weight, as a whole number. A weight becomes the arm's\n" +
        " * key verbatim, and `random_events` keys its arms by an `int`. Duplicate\n" +
        " * weights are preserved as separate rows, and `0` is a row the game ships itself.\n" +
        " */\n" +
        "weight: number;\n" +
        "/** Event selected by this row. Omit it to emit the literal `0` no-op arm. */\n" +
        "event?: EventScopelessRef | string | EventSituationRef;\n" +
        "}[];"
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

  it("lowers a ref-keyed scalar map, including technology's open weight groups", () => {
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
    const technology = emissions.get("technology")!;
    expect(technology.code).toContain("modWeightIfGroupPicked?: Readonly<Record<string, number>>;");
    expect(technology.code).toContain(
      '{ key: "mod_weight_if_group_picked", member: "modWeightIfGroupPicked", shape: "scalarMap", form: "block" }'
    );
    expect(fieldNames(technology.emittedFields)).toContain("mod_weight_if_group_picked");
    // All scalar-map consumers now lower everything their rules declare.
    expect(shipSize?.unsupported).toEqual([]);
    expect(civic?.unsupported).toEqual([]);
    expect(technology.unsupported).toEqual([]);
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
    // a decision's concrete scope varies below CWT's common carrier parent, so
    // it takes a scope parameter rather than an asserted constant.
    expect(emissions.get("decision")?.code).toContain(
      'potential?: WithFrom<Trigger<NoInfer<S>>, NoInfer<S>, { readonly root: "carrier"; readonly from: "country" }>;'
    );
  });

  it("parameterises a registry whose scope is a property of the definition", () => {
    // CWT annotates the decision body with the common `carrier` parent, while
    // the same registry is concretely planet-scoped on a planet and ship-scoped
    // on a nomadic colony ship. The definition declares which subtype it is,
    // and every field at the common parent follows. `NoInfer` keeps `scope` the
    // sole inference site — inferring from contravariant positions lands
    // elsewhere entirely.
    const decision = emissions.get("decision")!;
    expect(decision.code).toContain('export type DecisionScope = "planet" | "ship";');
    expect(decision.code).toContain("export interface DecisionFields<S extends DecisionScope");
    expect(decision.code).toContain("  scope?: S;");
    expect(decision.code).toContain(
      'effect: EffectBlock<NoInfer<S>, { readonly root: "carrier"; readonly from: "country" }>;'
    );
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
          ? {
              ...field,
              scope: {
                this: "planet",
                root: null,
                from: null,
                fromfrom: null,
                fromfromfrom: null,
                fromfromfromfrom: null,
                prev: null,
                prevprev: null,
                prevprevprev: null,
                prevprevprevprev: null,
                replaces: false,
              },
            }
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
    expect(councilor?.unsupported).toEqual([]);
  });

  it("generates economic_category without registry-specific code", () => {
    // Same drift block as councilor (SDK-2), same source file.
    const economicCategory = emissions.get("economic_category");
    expect(economicCategory?.code).toContain("export interface EconomicCategoryDef");
    expect(economicCategory?.code).toContain(
      "triggeredCostModifier?: EconomicCategoryTriggeredCostModifier[];"
    );
    expect(economicCategory?.unsupported).toEqual([]);
  });

  it("lowers civic_or_origin's potential/possible onto the shared government_trigger block", () => {
    // civic_or_origin was blocked on the government_trigger alias category
    // (SDK-1): potential/possible splice it alongside ordinary text/always
    // siblings, the same "combinator" shape government_trigger's own OR/AND/
    // limit members use, so the overlay points both at the shared
    // GovernmentTriggerBlock rather than a Trigger.
    const civicOrOrigin = emissions.get("civic_or_origin");
    expect(civicOrOrigin?.code).toContain("export type CivicOrOriginDef<");
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
    // leader_background_job_weight (`{ <job> = int }`) was the one field left
    // on this registry's machinery backlog when it landed. `scalarMap` — built
    // once ship_size.min_upgrade_cost turned up needing the same shape —
    // retired it, so the backlog is now empty.
    expect(civicOrOrigin?.unsupported).toEqual([]);
    expect(fieldNames(civicOrOrigin!.emittedFields)).toContain("leader_background_job_weight");
  });

  it("widens unpinned-scope Trigger/WeightBlock fields to never, buying real scope back by overlay row (widenedLowering, SDK-33)", () => {
    // ship_size.potential_construction carries no `## replace_scopes` and no
    // overlay `scope` assertion — CWT genuinely does not say, so it stays
    // unchecked (`Trigger<never>`, the top of Trigger's contravariant
    // lattice) rather than the unsatisfiable `Trigger<ScopeName>`.
    const shipSize = emissions.get("ship_size");
    expect(shipSize?.code).toContain("potentialConstruction?: Trigger<never>;");
    // solar_system_initializer.usage_odds, tradition_category.desc.trigger and
    // civic_or_origin.swap_type.trigger are the same unpinned defect, but with
    // a `CONTENT_FIELD_OVERRIDES` `scope` row buying the checking back — see
    // overlay.ts for the corpus evidence (shape conformance, not a reading of
    // the rules alone). The last is a nested one: a struct's interior takes a
    // row at its dotted path exactly as a top-level field does.
    const solarSystemInitializer = emissions.get("solar_system_initializer");
    expect(solarSystemInitializer?.code).toContain('usageOdds?: number | WeightBlock<"system">;');
    const traditionCategory = emissions.get("tradition_category");
    expect(traditionCategory?.code).toContain('trigger?: Trigger<"country">;');
    const civicOrOrigin = emissions.get("civic_or_origin");
    expect(civicOrOrigin?.code).toContain('trigger: Trigger<"country">;');
  });

  it("generates component_set as a name_field registry without registry-specific code", () => {
    const componentSet = emissions.get("component_set");
    expect(componentSet?.code).toContain("export type ComponentSetDef<");
    // `required_component_set = yes` selects `subtype[required_component]`,
    // so the flag is the discriminant of the two arms (SDK-360).
    expect(
      interfaceMembers(componentSet?.code ?? "", "ComponentSetRequiredComponentFields")
    ).toContain("requiredComponentSet");
    expect(componentSet?.code).toMatch(
      /ComponentSetRequiredComponentFields[^]*?requiredComponentSet: true;/
    );
    expect(componentSet?.code).toMatch(
      /ComponentSetPlainFields[^]*?requiredComponentSet\?: false;/
    );
    expect(componentSet?.code).toContain("affectsTargetFocus?: boolean;");
    expect(componentSet?.unsupported).toEqual([]);
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
    expect(sectionTemplate?.unsupported).toEqual([]);
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
    expect(utility?.unsupported).not.toContain("resources (no declaration the emitter can lower)");
    expect(utility?.unsupported).not.toContain("modifier (no declaration the emitter can lower)");
    // SDK-85: weapon's arm is not utility's. target_weights, ai_tag_weight's
    // weapon redeclaration, can_destroy_stars and on_hit are declared inside
    // subtype[weapon_component_template] (components.cwt:184-332) and never
    // reach utility now that the body is partitioned per registry — neither as
    // an emitted member nor as an unsupported line, because there is no utility
    // declaration for either to come from.
    for (const member of ["targetWeights", "canDestroyStars", "onHit", "missileSpeed"]) {
      expect(utility?.code).not.toContain(`${member}?:`);
    }
    expect(utility?.unsupported).not.toContain(
      "target_weights (no declaration the emitter can lower)"
    );
    // ai_tag_weight survives because component_template declares it at the type
    // level too (components.cwt:140-141), above every subtype — the weapon arm
    // redeclares a field all three registries have.
    expect(utility?.code).toContain("aiTagWeight?: number;");

    const weapon = emissions.get("weapon_component_template");
    expect(weapon?.code).toContain("export interface WeaponComponentTemplateDef");
    // Splices economic_template_no_produce (components.cwt:189), not plain
    // economic_template like utility's own resources above — `produces` is
    // not game-legal here, so the row requests economicResourcesNoProduce
    // rather than economicResources and the member type has no `produces` arm.
    expect(weapon?.code).toContain('resources?: EconomicResourceBlockNoProduce<"ship">[];');
    expect(weapon?.code).toContain('shape: "economicResourcesNoProduce"');
    expect(weapon?.code).not.toContain('resources?: EconomicResourceBlock<"ship">[];');
    expect(weapon?.code).toContain("targetWeights?: Readonly<Record<string, number>>;");
    expect(weapon?.code).toContain(
      '{ key: "target_weights", member: "targetWeights", shape: "scalarMap", form: "block" }'
    );
    expect(weapon?.code).toContain('modifier?: ModifierClosure<"ship">;');
    expect(weapon?.code).toContain('shipDesignModifier?: ModifierClosure<"design">;');
    expect(fieldNames(weapon!.emittedFields)).toContain("resources");
    expect(fieldNames(weapon!.emittedFields)).toContain("modifier");
    expect(fieldNames(weapon!.emittedFields)).toContain("target_weights");
    // SDK-142: both aura clauses' `modifier` used to be the whole of weapon's
    // unsupported list — `modifier = single_alias_right[modifier_clause]`
    // (components.cwt:492, :529) with no overlay row to name its shape, where
    // utility's identical pair had one. The clause name now carries the shape,
    // so the list is empty and the two members exist, scoped by the clause's own
    // `## replace_scopes = { this = ship root = ship }`.
    expect(weapon?.unsupported).toEqual([]);
    expect(weapon?.code).toContain("export interface WeaponComponentTemplateFriendlyAura {");
    expect(interfaceMembers(weapon!.code, "WeaponComponentTemplateFriendlyAura")).toContain(
      "modifier"
    );
    expect(interfaceMembers(weapon!.code, "WeaponComponentTemplateHostileAura")).toContain(
      "modifier"
    );

    // strike_craft_component_template only declares resources and
    // ship_modifier (components.cwt:333-343) — no modifier,
    // ship_design_modifier, or either triggered variant, unlike weapon and
    // utility above. Since SDK-85 those four are absent outright rather than
    // reported unsupported: the shared CWT body is partitioned per registry
    // before flatten/mergeByName run, so weapon's and utility's declarations of
    // those names no longer fold into strike_craft's field groups at all.
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
    // Confirms the fields strike_craft genuinely does not declare are gone
    // rather than silently picking up weapon's/utility's shapes — and gone from
    // the unsupported list too, which only ever reports a declaration that
    // reached the emitter.
    // Read off the Def interface rather than the whole file: since SDK-142 the
    // aura structs one level down declare their own `modifier` member, which is
    // strike_craft's aura clause, not the top-level component field this asserts
    // is absent.
    const strikeCraftMembers = interfaceMembers(
      strikeCraft!.code,
      "StrikeCraftComponentTemplateDef"
    );
    for (const member of ["modifier", "targetWeights", "shipDesignModifier", "ftl"]) {
      expect(strikeCraftMembers).not.toContain(member);
    }
    expect(
      interfaceMembers(strikeCraft!.code, "StrikeCraftComponentTemplateFriendlyAura")
    ).toContain("modifier");
    expect(
      interfaceMembers(strikeCraft!.code, "StrikeCraftComponentTemplateHostileAura")
    ).toContain("modifier");
    for (const field of ["modifier", "target_weights", "ship_design_modifier"]) {
      expect(strikeCraft?.unsupported).not.toContain(
        `${field} (no declaration the emitter can lower)`
      );
    }

    // SDK-85: `size` is the clearest reading of the contamination. Weapon
    // declares it first in components.cwt, so before partitioning every
    // registry's member typed as `WeaponSlotSize | UtilitySlotSize` — including
    // utility, whose own declaration is `enum[utility_slot_size]`.
    expect(utility?.code).toContain("size?: UtilitySlotSize;");
    expect(weapon?.code).toContain("size?: WeaponSlotSize;");
    expect(strikeCraft?.code).toContain("size?: WeaponSlotSize;");

    // And nothing on these three is subtype-conditional any more: every arm
    // that survives partitioning is one this registry always has, so the
    // "Only when …" doc line flatten writes has no occasion to appear.
    for (const emission of [utility, weapon, strikeCraft]) {
      expect(emission?.code).not.toContain("Only when");
    }
  });

  it("generates ambient_object as a name_field registry keyed by name", () => {
    const ambientObject = emissions.get("ambient_object");
    expect(ambientObject?.code).toContain("export interface AmbientObjectDef");
    expect(ambientObject?.code).toContain("entity: ModelEntityRef | string;");
    expect(ambientObject?.code).toContain("showName?: boolean;");
    expect(ambientObject?.unsupported).toEqual([]);
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
      'shipSelectionWeight?: WithFrom<WeightBlock<"species">, "species", { readonly from: "country" }>;'
    );
    expect(graphicalCulture?.unsupported).toEqual([]);
  });

  it("cuts spriteType down to the plain-sprite subtype and keeps the game's own name", () => {
    // `type[sprite]` backs eight subtype keywords; `as: "normal"` selects the
    // plain one, so the flag, portrait, progressbar and piechart bodies stay
    // out. The name is `spriteType` — the keyword the game writes and the SDK
    // exposes — while the reference stays `sprite`, which is the only spelling
    // any `<sprite>` field asks for.
    const spriteType = emissions.get("spriteType");
    expect(spriteType?.code).toContain("export interface SpriteTypeDef");
    expect(spriteType?.code).toContain("textureFile?: AssetFileItem | string;");
    expect(spriteType?.code).toContain("parent?: SpriteRef | string;");
    expect(spriteType?.code).toContain("animation?: SpriteTypeAnimation[];");
    // The rules' own casing, which is what the corpus reader folds onto.
    expect(spriteType?.code).toContain("transParencecheck?: boolean;");
    expect(spriteType?.code).toContain("animationtextureFile?: AssetFileItem | string;");
    // The other seven subtypes' bodies, none of which is this registry's.
    for (const foreign of ["texture_size", "play_on_show", "colortwo", "is_hover"]) {
      expect(spriteType?.code, foreign).not.toContain(foreign);
    }
    expect(spriteType?.unsupported).toEqual([]);
  });

  it("lowers pdxparticle.type to a documented unchecked string", () => {
    // `type = <particle_type>` names the `.asset` half of gfx/particles, which
    // the SDK carries as opaque Assets and will never manifest — so the checked
    // arm of `ParticleTypeRef | string` is a brand nothing can mint. The
    // `uncheckedString` overlay row lowers it to `string`, drops the `refTypes`
    // that would send the fold looking for that registry, and says so on the
    // member a modder hovers.
    const pdxparticle = emissions.get("pdxparticle");
    expect(pdxparticle?.code).toContain("type: string;");
    expect(pdxparticle?.code).not.toContain("ParticleTypeRef");
    expect(pdxparticle?.code).toContain("Not checked: any string is accepted here.");
    expect(pdxparticle?.code).toContain(
      "The `<particle_type>` ids this names live in `.asset` files under `gfx/particles`"
    );
    expect(pdxparticle?.code).toContain(
      '{ key: "type", member: "type", shape: "value", form: "scalar", conversion: "identity" }'
    );
    expect(pdxparticle?.unsupported).toEqual([]);
  });

  it("lowers pdxmesh's repeated meshsettings and its own unchecked animation type", () => {
    const pdxmesh = emissions.get("pdxmesh");
    expect(pdxmesh?.code).toContain("meshsettings?: PdxmeshMeshsettings[];");
    // `filename[gfx/models]`, which the classifier reads as a path-shaped
    // string — left unknown these four were fields the registry could not author.
    expect(pdxmesh?.code).toContain("textureDiffuse?: string;");
    expect(pdxmesh?.code).toContain("textureWpo?: string;");
    // `$shader_effect` is the config's marker for a name in a `.shader` file,
    // not a value: 47 real shader names against a one-member literal union.
    expect(pdxmesh?.code).toContain('shader?: "$shader_effect" | string;');
    // The same dead-reference shape as pdxparticle.type, one level down.
    expect(pdxmesh?.code).not.toContain("ModelAnimationRef");
    expect(pdxmesh?.code).toContain(
      "The `<model_animation>` ids this names live in `.asset` files under `gfx/models`"
    );
    expect(pdxmesh?.unsupported).toEqual([]);
  });

  it("pins starbase_level's upgrade/downgrade triggers to starbase scope", () => {
    const starbaseLevel = emissions.get("starbase_level");
    expect(starbaseLevel?.code).toContain("export interface StarbaseLevelDef");
    expect(starbaseLevel?.code).toContain('upgradePossible?: Trigger<"starbase">;');
    expect(starbaseLevel?.code).toContain('downgradePotential?: Trigger<"starbase">;');
    expect(starbaseLevel?.code).toContain("collectsTrade?: boolean;");
    expect(starbaseLevel?.code).toContain("specialConstruction?: boolean;");
    expect(starbaseLevel?.unsupported).toEqual([]);
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
    expect(speciesClass?.unsupported).toEqual([]);
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
    expect(countryShipOfSizeLimit?.unsupported).toEqual([]);
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
    expect(solarSystem?.unsupported).toEqual([]);
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

  it("generates event chains and special projects through the generic content model", () => {
    const eventChain = emissions.get("event_chain");
    expect(eventChain?.code).toContain("export interface EventChainDef");
    expect(eventChain?.code).toContain(
      "counter?: Readonly<Record<string, EventChainCounterDefinition>>;"
    );
    expect(eventChain?.code).toContain("export interface EventChainCounterDefinition");
    expect(eventChain?.code).toContain("max?: number;");
    expect(eventChain?.code).toContain('abortTrigger?: Trigger<"country">;');
    expect(eventChain?.code).toContain('{ member: "title", pattern: "$_title", required: false }');
    expect(eventChain?.unsupported).toEqual([]);

    const specialProject = emissions.get("special_project");
    expect(specialProject?.code).toContain("export interface SpecialProjectDef");
    expect(specialProject?.code).toContain("eventChain?: EventChainRef | string;");
    expect(specialProject?.code).toContain("eventScope: E;");
    expect(specialProject?.code).toContain("SpecialProjectScopeOf<E>");
    expect(specialProject?.code).toContain('cost?: number | WeightBlock<"country">;');
    expect(specialProject?.code).toContain("conditionalDesc?: SpecialProjectDesc[];");
    expect(specialProject?.code).toContain('shape: "dual"');
  });

  it("lowers megastructure's economic, modifier, and mixed trigger-struct fields", () => {
    const megastructure = emissions.get("megastructure");
    expect(megastructure?.code).toContain("export type MegastructureDef<");
    // `resources` and `dismantle_cost` are the same declaration — a `category`
    // sibling beside the economic_template splice — that job.resources and
    // decision.resources already lower; only `resources` carries
    // `## cardinality = 0..inf`, so only it comes out an array.
    expect(megastructure?.code).toContain("resources?: EconomicResourceBlock<ScopeName>[];");
    expect(megastructure?.code).toContain("dismantleCost?: EconomicResourceBlock<ScopeName>;");
    // Four modifier splices, each pinned by its own `## replace_scopes` rather
    // than by an overlay `scope` assertion — a megastructure's station
    // modifier really does apply in megastructure scope.
    expect(megastructure?.code).toContain('countryModifier?: ModifierClosure<"country">;');
    expect(megastructure?.code).toContain('shipModifier?: ModifierClosure<"ship">;');
    expect(megastructure?.code).toContain('stationModifier?: ModifierClosure<"megastructure">;');
    // A list, not a single block — see the arity-assertion test above for the
    // corpus evidence that the rules' `0..1` is wrong here.
    expect(megastructure?.code).toContain(
      'triggeredCountryModifier?: TriggeredModifier<"country">[];'
    );
    // The build hooks are system-scoped with the building country as FROM, and
    // the type says so rather than flattening to one scope.
    expect(megastructure?.code).toContain(
      'possible?: WithFrom<Trigger<"system">, "system", { readonly root: "system"; readonly from: "country" }>;'
    );
    expect(megastructure?.code).toContain(
      'onBuildComplete?: EffectBlock<"system", { readonly root: "system"; readonly from: "country"; readonly fromfrom: "megastructure" }>;'
    );
    expect(megastructure?.code).toContain('potential?: Trigger<"country">;');
    // `upgrade_desc` is declared twice, `localisation` and the literal `hide`;
    // the two arms union without an overlay row. `hide` is an engine sentinel
    // rather than a key, so it survives beside the two authored forms of one
    // and rides through the resolution verbatim (SDK-303).
    expect(megastructure?.code).toContain('upgradeDesc?: LocalizationInput | "hide";');
    expect(megastructure?.code).toContain('locKeyLiterals: ["hide"]');
    // Every shipped megastructure is named in the build menu, so the slot is a
    // REQUIRED_LOCALISATION row and the member is not optional.
    expect(megastructure?.code).toContain("  name: LocalizedText;");
    expect(megastructure?.code).toContain('{ member: "name", pattern: "$", required: true }');
    expect(fieldNames(megastructure!.emittedFields)).toContain("resources");
    expect(fieldNames(megastructure!.emittedFields)).toContain("country_modifier");
    expect(megastructure?.code).toContain("placementRules?: MegastructurePlacementRules;");
    expect(megastructure?.code).toContain('planetPossible?: Trigger<"planet">;');
    expect(megastructure?.code).toContain("when?: Trigger<never>;");
    expect(megastructure?.code).toContain('shape: "triggerStruct"');
    expect(megastructure?.unsupported).toEqual([]);
  });

  it("lowers the common component and parameterised decision tooltip blocks", () => {
    for (const registry of [
      "utility_component_template",
      "weapon_component_template",
      "strike_craft_component_template",
    ]) {
      const code = emissions.get(registry)?.code;
      expect(code).toContain("customTooltip?: LocalizationInput | ");
      expect(code).toContain('shape: "triggerStruct"');
      expect(code).toContain("when?: Trigger<never>;");
    }
    const decision = emissions.get("decision");
    expect(decision?.code).toContain("customTooltip?: DecisionCustomTooltip<S>;");
    expect(decision?.code).toContain(
      'when?: WithFrom<Trigger<NoInfer<S>>, NoInfer<S>, { readonly root: "carrier"; readonly from: "country" }>;'
    );
    expect(decision?.nestedEmittedFields).toContainEqual({
      field: "decision.custom_tooltip.when",
      authoredPath: ["customTooltip"],
      shape: "trigger",
      repeated: false,
      clause: "trigger",
      scope: { parameter: ["planet", "ship"] },
    });
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
    expect(planet?.code).toContain(
      'initEffect?: EffectBlock<"planet", { readonly root: "country"; readonly prev: "system"; readonly prevprev: "system" }>;'
    );
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

  /**
   * The patch surface is generated, not hand-listed: a `CONTENT_PATCH_REGISTRIES`
   * row produces one optional member per field the transform can splice, in the
   * same forms the definition's own members take, plus one per declared
   * localisation slot. A member missing here would be a member of the API no
   * patch author can reach.
   */
  it("derives the patch type's membership from the emitted fields", () => {
    for (const registry of CONTENT_PATCH_REGISTRIES.keys()) {
      const emission = emissions.get(registry);
      const name = pascalCase(registry);
      const slots = [
        ...(emission?.code.matchAll(/\{ member: "(\w+)", pattern: "([^"]+)"/g) ?? []),
      ].map((match) => [match[1]!, match[2]!] as const);
      // The slots lead, then the body fields, and the two together are exactly
      // the definition's own members: nothing is dropped from the patch type.
      // A registry whose fields are subtype arms spreads those members over
      // the arm interfaces, so the comparison is by membership, not order.
      const fieldsMembers = new Set([
        ...interfaceMembers(emission?.code ?? "", `${name}Fields`),
        ...interfaceMembers(emission?.code ?? "", `${name}FieldsBase`),
        ...[
          ...(emission?.code.matchAll(
            /^export interface (\w+Fields)(?:<[^{]*>)? extends \w+FieldsBase/gm
          ) ?? []),
        ].flatMap((match) => interfaceMembers(emission?.code ?? "", match[1]!)),
      ]);
      expect(new Set(interfaceMembers(emission?.code ?? "", `${name}Patch`)), registry).toEqual(
        fieldsMembers
      );
      // Nothing is excluded any more — the slots that used to be are members,
      // each reported with the vanilla key its text replaces.
      expect(emission?.patchExclusions, registry).toEqual([]);
      expect(emission?.patchLocMembers, registry).toEqual(
        slots.map(
          ([member, pattern]) =>
            `${registry}.${member} — replacement text under ` +
            `\`${pattern.replace("$", "<vanilla id>")}\``
        )
      );
    }
  });

  it("emits no patch surface for a registry the overlay does not permit", () => {
    for (const [registry, emission] of emissions) {
      if (CONTENT_PATCH_REGISTRIES.has(registry)) {
        continue;
      }
      expect(emission.code, registry).not.toContain(
        `export interface ${pascalCase(registry)}Patch`
      );
      expect(emission.patchExclusions, registry).toEqual([]);
    }
  });
});

/**
 * Raw content definers are package-internal lowering primitives. They read
 * from committed output rather than re-emitted: `npm run codegen:check` is
 * what guarantees the file matches the emitter, so asserting against the file
 * also asserts against what ships.
 *
 * The claim is that all 36 raw definers are available from this one internal
 * module — 35 mechanical, one re-exported from the hand-written graft — and
 * that none registers anything. Capability methods and `feature()` own public
 * authoring and placement.
 */
describe("generated content definers", () => {
  const definers = readFileSync("packages/sdk/src/generated/content-definers.ts", "utf8");
  const capability = readFileSync("packages/sdk/src/generated/content-capability.ts", "utf8");

  it("emits one raw definer and one item union per manifest registry", () => {
    for (const manifest of CONTENT_MANIFEST) {
      const entry = manifest as ContentManifestEntry;
      const name = pascalCase(registryNameOf(entry));
      // A registry carrying a declared contract parameterises its item type by
      // the witness; the rest take no parameter.
      expect(definers, entry.type).toMatch(new RegExp(`export type ${name}Item(<| =)`));
      expect(definers, entry.type).toMatch(new RegExp(`\\bdefine${name}\\b`));
    }
    // 35 mechanical `export function defineX` plus the graft's re-export.
    expect(definers.match(/^export function define\w+</gm)).toHaveLength(
      CONTENT_MANIFEST.length - HAND_WRITTEN_CONTENT_DEFINERS.size
    );
    // HAND_WRITTEN_CONTENT_DEFINERS, the HAND_WRITTEN_TRIGGERS arrangement one
    // level up: no mechanical defineSituationType is emitted beside the graft,
    // because `targetScope` is a contract the rules describe nowhere.
    expect(HAND_WRITTEN_CONTENT_DEFINERS.has("situation_type")).toBe(true);
    expect(definers).toContain('export { defineSituationType } from "../content/situations.ts";');
    expect(definers).not.toContain("export function defineSituationType");
    expect(definers).not.toContain("defineSituationType<const Id");
    // The item type an author names has to carry the declared contract, or
    // annotating with it is how the contract gets dropped on the way to the
    // effect that checks it (SDK-181). The witness comes from the graft row
    // for a hand-written definer and from `declaredFrom` for a generated one.
    expect(definers).toContain(
      "export type SituationTypeItem<W extends ScopeName | undefined = ScopeName | undefined> ="
    );
    expect(definers).toMatch(/SituationTypeItem<[^>]*> =[\s\S]*?readonly targetScope: W/);
    expect(definers).toMatch(
      /export type SpecialProjectItem<\s*W extends SpecialProjectLocationScope \| undefined/
    );
    expect(definers).toMatch(/SpecialProjectItem<[\s\S]*?readonly locationScope: W/);
  });

  it("preserves a definition's literal id, snapshots its def, and registers nothing", () => {
    // `loc` is minted from the registry's own slot table rather than spelled
    // out per registry, so an item's references and the keys the fold
    // registers for the same definition come from one derivation (SDK-305).
    // The stored def is a snapshot, so mutating the object the author still
    // holds cannot change a later build (SDK-325).
    expect(definers).toContain(
      "export function defineTechnology<const Id extends string>(\n" +
        "  def: TechnologyDef<Id>\n" +
        '): ContentItem<"technology", TechnologyDef<Id>> {\n' +
        "  return {\n" +
        '    itemKind: "content",\n' +
        '    type: "technology",\n' +
        "    id: def.id,\n" +
        "    def: snapshotAuthoredValue(def),\n" +
        "    loc: contentLocalizationRefs(def.id, TECHNOLOGY_LOCALISATION),\n" +
        "  };\n" +
        "}"
    );
    // No collection, no item array, nothing pushed: a definer is a function
    // from a definition to a value, and that is the whole of it.
    expect(definers).not.toContain("items.push");
    expect(definers).not.toContain("makeCollection");
    expect(definers).not.toContain("Feature<");
  });

  it("emits one raw patchX per overlay row, plus addShipOfSizeLimits", () => {
    // Derived from the overlay rather than hand-listed: the emitted patchX set
    // is exactly the registries CONTENT_PATCH_REGISTRIES permits — a row is the
    // whole permission, and a registry without one gets no patch surface.
    expect(definers.match(/^export function patch\w+</gm)).toEqual(
      [...CONTENT_PATCH_REGISTRIES.keys()].map(
        (registry) => `export function patch${pascalCase(registry)}<`
      )
    );
    // The transform is generic and descriptor-driven: the definer hands it the
    // registry's own field table, and imports no per-registry hand symbol.
    expect(definers).toContain(
      "): TechnologyPatchItem {\n" +
        "  return {\n" +
        '    itemKind: "patch",\n' +
        "    patched: patchContent(\n" +
        "      technology,\n" +
        "      patch,\n" +
        '      "technology",\n' +
        "      TECHNOLOGY_FIELDS,\n" +
        "      TECHNOLOGY_LOCALISATION,\n" +
        "      prefix\n" +
        "    ),\n" +
        "  };"
    );
    // And a second registry's definer is the same call with its own name,
    // registry key, and tables — no per-registry hand symbol.
    expect(definers).toContain(
      "): BuildingPatchItem {\n" +
        "  return {\n" +
        '    itemKind: "patch",\n' +
        "    patched: patchContent(\n" +
        "      building,\n" +
        "      patch,\n" +
        '      "building",\n' +
        "      BUILDING_FIELDS,\n" +
        "      BUILDING_LOCALISATION,\n" +
        "      prefix\n" +
        "    ),\n" +
        "  };"
    );
    expect(definers).toContain('import { patchContent } from "../installation/vanilla/patch.ts";');
    expect(definers).not.toContain("transformTechnology");
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

  it("keeps capability helpers out of raw-definer exports and derives them from the manifest", () => {
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
    expect(capability).not.toContain("SituationTypeCapabilityDef");
    expect(capability).not.toContain("EventChainCapabilityDef");
    // `patchX` is a closure over the prefix, not a re-export: a patch mints
    // localisation keys from it, so the capability has to bind it the same way
    // it binds `mint` into every `defineX`.
    expect(capability).toContain(
      "    patchTechnology: <Source extends ParsedTechnology>(\n" +
        "      technology: Source,\n" +
        "      patch: (technology: Source) => TechnologyPatch\n" +
        "    ) => patchTechnology(technology, patch, prefix),"
    );
    expect(capability).toContain(
      "  prefix: P,\n  assertName: LogicalNameAsserter,\n  mintOwner: MintCapabilityOwner\n" +
        "): ContentCapabilityMethods<P, I> {"
    );
    // The shape mint's ownership record, not the item's own `minted` property.
    expect(capability).toContain("recordShapeMint(");
    expect(capability).toContain(
      'return shapeMinted(defineSpriteType(def), mintOwner, "spriteTextIcon");'
    );
    expect(capability).toContain("readonly addShipOfSizeLimits: typeof addShipOfSizeLimits;");
    expect(capability).toContain(
      "The capability mints and owns the full id; the returned branded reference"
    );
    expect(capability).toContain(
      "Unlike a capability definition method, it mints no id and owns no new content —"
    );
    expect(capability).toContain(
      "This is an id-less additive contribution, not a capability-owned definition."
    );
  });

  it("keeps raw constructors internal while the vocabulary entry exports XItem unions type-only", () => {
    const vocabulary = readFileSync("packages/sdk/src/stellaris.ts", "utf8");

    expect(vocabulary).toContain('export type * from "./generated/content-definers.ts";');
    expect(vocabulary).not.toContain('export * from "./generated/content-definers.ts";');
    expect(vocabulary).not.toContain("export { defineTechnology");
    expect(vocabulary).not.toContain("export { patchTechnology");
    expect(vocabulary).not.toContain("export { addShipOfSizeLimits");
  });

  it("gives every generated registry a handle definer beside its definer", () => {
    // The acceptance measure for SDK-290, read off the manifest rather than a
    // list kept here: a registry cannot land without a handle, because a
    // definition that has to name its own id is otherwise stuck retyping the
    // mint rule as an unchecked string.
    const generated = CONTENT_MANIFEST.map(registryNameOf).filter(
      (registry) => !HAND_WRITTEN_CONTENT_DEFINERS.has(registry)
    );
    const declared = new Set(
      [...capability.matchAll(/^ {2}(\w+)Handle[<(]/gm)].map((match) => match[1]!)
    );

    for (const registry of generated) {
      expect(declared).toContain(camelCase(pascalCase(registry)));
    }
    // The two hand-written grafts carry their own, in their own modules.
    for (const [registry, graft] of HAND_WRITTEN_CONTENT_DEFINERS) {
      const module = readFileSync(`packages/sdk/src/${graft.module.replace("../", "")}`, "utf8");
      expect(module).toContain(
        `${camelCase(pascalCase(registry))}Handle<const Name extends string>(`
      );
    }
    // A patch mints no id, so it has nothing to hand out early.
    expect(declared).not.toContain("patchTechnology");
  });

  it("derives every nested identity table from repeated-struct metadata", () => {
    const nestedByRegistry = CONTENT_MANIFEST.map((manifest) => {
      const registry = registryNameOf(manifest);
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
    }).filter(
      (entry) => entry.members.length > 0 && !HAND_WRITTEN_CONTENT_DEFINERS.has(entry.registry)
    );

    expect(nestedByRegistry).toEqual([
      { registry: "tradition", members: ["traditionSwap"] },
      { registry: "ascension_perk", members: ["traditionSwap"] },
    ]);
    for (const { registry, members } of nestedByRegistry) {
      const table = `${constantCase(pascalCase(registry))}_NESTED_DEFINITION_MEMBERS`;
      expect(capability).toContain(
        `const ${table} = [${members.map((member) => JSON.stringify(member)).join(", ")}] as const;`
      );
      // Declaration, plus the handle binding and the eager binding — each
      // builds its own closure over the table, and the eager one is
      // `handle(name).define(def)`, so the assertion still runs exactly once
      // per definition.
      expect(capability.match(new RegExp(`\\b${table}\\b`, "g"))).toHaveLength(3);
    }
    expect(capability).toContain("function assertNestedDefinitionIds(");
  });
});
