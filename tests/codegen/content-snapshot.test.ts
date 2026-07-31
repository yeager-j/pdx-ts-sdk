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
    emitter.beginFile();
    const emission = emitContentType(emitter, type, body);
    emitter.endFile();
    return [manifest.type, emission] as const;
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
      expect(emissions.get(manifest.type)?.emittedFields).toEqual(
        CONTENT_EMITTED_FIELDS[manifest.type]
      );
      expect(emissions.get(manifest.type)?.unsupported).toEqual([]);
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
  });

  it("emits reusable economic and triggered-modifier blocks", () => {
    const edict = emissions.get("edict");
    expect(edict?.code).toContain('resources?: EconomicResourceBlock<"country">[];');
    expect(edict?.code).toContain('triggeredCountryModifier?: TriggeredModifier<"country">[];');
    expect(edict?.code).toContain('shape: "economicResources"');
    expect(edict?.code).toContain('shape: "triggeredModifierBlock"');
    expect(edict?.code).toContain("isWartimeEdict?: true;");
  });

  it("collapses duplicate localization patterns without hiding them", () => {
    const agenda = emissions.get("agenda");
    expect(agenda?.code).toContain("name: string;");
    expect(agenda?.code).toContain("desc?: string;");
    expect(agenda?.code).not.toContain("councilAgendaName");
    expect(agenda?.localisationAliases).toEqual([
      "agenda.localisation.council_agenda_name duplicates name at council_agenda_$_name",
      "agenda.localisation.council_agenda_desc duplicates desc at council_agenda_$_desc",
    ]);
  });

  it("reports representative omitted fields for every registry", () => {
    expect(emissions.get("technology")?.unemittedFields).toContain("technology.technology_swap");
    expect(emissions.get("building")?.unemittedFields).toContain("building.on_built");
    expect(emissions.get("tradition")?.unemittedFields).toContain(
      "tradition.tradition_swap.on_enabled"
    );
    expect(emissions.get("tradition_category")?.unemittedFields).toContain(
      "tradition_category.desc"
    );
    expect(emissions.get("agenda")?.unemittedFields).toEqual([]);
    expect(emissions.get("edict")?.unemittedFields).toEqual([]);
  });
});
