import { describe, expect, it } from "vitest";

import { CONTENT_MANIFEST } from "../../tools/codegen/content-manifest.ts";
import { loadRules } from "../../tools/codegen/cwt/rules.ts";
import { emitContentType } from "../../tools/codegen/emit/content-type.ts";
import { Emitter } from "../../tools/codegen/emit/types.ts";
import { CONTENT_EMITTED_FIELDS } from "../../tools/codegen/overlay.ts";

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

  it("emits exactly each registry's curated field list", () => {
    for (const manifest of CONTENT_MANIFEST) {
      const registry = (manifest as { as?: string }).as ?? manifest.type;
      expect(emissions.get(registry)?.emittedFields, registry).toEqual(
        CONTENT_EMITTED_FIELDS[registry]
      );
      expect(emissions.get(registry)?.unsupported, registry).toEqual([]);
    }
  });

  it("carries a registry's body scope into trigger fields", () => {
    expect(emissions.get("building")?.code).toContain('allow?: Trigger<"colony">;');
    expect(emissions.get("building")?.code).toContain('potential?: Trigger<"colony">;');
  });

  it("emits nested definitions as data-driven field tables", () => {
    const tradition = emissions.get("tradition");
    expect(tradition?.code).toContain("export interface TraditionSwapDef");
    expect(tradition?.code).toContain('shape: "nested"');
    expect(tradition?.code).toContain("fields: TRADITION_SWAP_FIELDS");
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
    expect(perk?.code).toContain("export interface AscensionPerkSwapDef");
    expect(perk?.code).toContain('potential?: Trigger<"country">;');
    expect(perk?.code).toContain('modifier?: ModifierClosure<"country">;');
    expect(perk?.code).toContain('shape: "nested"');
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
    // Only one `desc` member survives even though the rules declare it twice.
    expect(job?.code?.match(/\bdesc\??: string;/g)).toHaveLength(1);
    expect(job?.code).not.toContain("conditionString");
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

  it("sorts an omitted field into review, declined, or machinery", () => {
    // A field the emitter can lower is waiting on review; one it cannot is
    // waiting on the emitter. Keeping them apart is the point of the buckets:
    // the first is an overlay edit, the second is a code change.
    expect(emissions.get("building")?.reviewQueue).toContain("building.on_built");
    expect(emissions.get("building")?.machineryBacklog).not.toContain("building.on_built");

    expect(emissions.get("decision")?.machineryBacklog).toContain("decision.custom_tooltip");
    expect(emissions.get("job")?.machineryBacklog).toContain("job.swappable_data");
    expect(emissions.get("job")?.machineryBacklog).toContain("job.triggered_tags");
    expect(emissions.get("job")?.machineryBacklog).toContain(
      "job.triggered_planet_pop_group_modifier_for_species"
    );

    // Nested omissions are reported as machinery: the probe only lowers
    // top-level fields.
    expect(emissions.get("tradition")?.machineryBacklog).toContain(
      "tradition.tradition_swap.on_enabled"
    );
  });

  it("keeps declined fields out of the review queue, with their reason", () => {
    const decision = emissions.get("decision");
    expect(decision?.reviewQueue).not.toContain("decision.sound");
    expect(decision?.declinedFields.join("\n")).toContain("decision.sound — cosmetic");

    const job = emissions.get("job");
    expect(job?.reviewQueue).not.toContain("job.auto_generate_description");
    expect(job?.declinedFields.join("\n")).toContain("boolean[]");
  });

  it("reports coverage against what the emitter can lower", () => {
    // Registries with nothing left to review are the finished state, and must
    // stay at full coverage as the emitter grows.
    for (const name of ["ascension_perk", "agenda", "edict"] as const) {
      const emission = emissions.get(name);
      expect(emission?.reviewQueue, name).toEqual([]);
      expect(emission?.declinedFields, name).toEqual([]);
      expect(emission?.coverage.emitted, name).toBe(emission?.coverage.lowerable);
    }

    // building is the opposite end: most of what it could emit is unreviewed.
    const building = emissions.get("building");
    expect(building?.coverage.emitted).toBeLessThan(building!.coverage.lowerable / 2);
  });
});
