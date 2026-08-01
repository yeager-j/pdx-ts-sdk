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
});
