import { describe, expect, it } from "vitest";

import { createMod, render, type IdProfile, type ModCapability } from "../src/index.ts";
import { viewFromFiles } from "../src/installation/vanilla/view.ts";
import {
  always,
  currentSituationApproach,
  currentStage,
  hasAscensionPerk,
  not,
} from "../src/stellaris.ts";

const COMPLETE_PROFILE = {
  technology: "tech",
  building: "building",
  tradition: "tradition",
  traditionCategory: "tradition_category",
  ascensionPerk: "ascension_perk",
  ascensionPerkCategory: "ascension_perk_category",
  resource: "resource",
  crisisPath: "crisis_path",
  crisisLevel: "crisis_level",
  crisisObjective: "crisis_objective",
  menacePerk: "menace_perk",
  agenda: "agenda",
  edict: "edict",
  decision: "decision",
  job: "job",
  globalShipDesign: "global_ship_design",
  utilityComponentTemplate: "utility_component_template",
  weaponComponentTemplate: "weapon_component_template",
  strikeCraftComponentTemplate: "strike_craft_component_template",
  shipSize: "ship_size",
  opinionModifier: "opinion_modifier",
  staticModifier: "static_modifier",
  scriptedModifier: "scripted_modifier",
  casusBelli: "casus_belli",
  warGoal: "war_goal",
  agreementPreset: "agreement_preset",
  bombardmentStance: "bombardment_stance",
  archaeologicalSiteType: "archaeological_site_type",
  relic: "relic",
  mission: "mission",
  missionCategory: "mission_category",
  situationType: "situation_type",
  scriptedLoc: "scripted_loc",
  councilor: "councilor",
  economicCategory: "economic_category",
  civicOrOrigin: "civic_or_origin",
  componentSet: "component_set",
  sectionTemplate: "section_template",
  ambientObject: "ambient_object",
  graphicalCulture: "graphical_culture",
  starbaseLevel: "starbase_level",
  speciesClass: "species_class",
  countryShipOfSizeLimit: "country_ship_of_size_limit",
  solarSystemInitializer: "solar_system_initializer",
  eventChain: "event_chain",
  specialProject: "special_project",
  megastructure: "megastructure",
  // No GFX registries: `spriteType`, `pdxmesh` and `pdxparticle` mint
  // segmentless names (SDK-121), so they are not `IdProfile` members and a
  // profile naming one no longer compiles.
} as const satisfies IdProfile;

function mod() {
  return createMod({
    name: "Nested capability",
    prefix: "nested_capability",
    supportedVersion: "4.4.*",
  });
}

describe("mod capability purity and ids", () => {
  it("snapshots config and tags, freezes the capability, and defers placement until feature", () => {
    const tags = ["Technologies"];
    const config = { name: "Snapshot", prefix: "snapshot_mod", supportedVersion: "4.4.*", tags };
    const capability = createMod(config);
    const omitted = capability.technology("omitted", {
      name: "Omitted",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    config.prefix = "mutated_after_create";
    tags.push("Mutated");

    expect(Object.isFrozen(capability)).toBe(true);
    expect(Object.isFrozen(capability.config)).toBe(true);
    expect(Object.isFrozen(capability.config.tags)).toBe(true);
    expect(Object.isFrozen(capability.ids)).toBe(true);
    expect(capability.config.tags).toEqual(["Technologies"]);
    expect(omitted.id).toBe("snapshot_mod_tech_omitted");
    expect(
      render(capability.compile([])).has("common/technology/snapshot_mod_technology.txt")
    ).toBe(false);
    expect(
      render(capability.compile([capability.feature("included", [omitted])])).has(
        "common/technology/snapshot_mod_included.txt"
      )
    ).toBe(true);
  });

  it("mints custom-profile ids and rejects incomplete, extra, and invalid profiles", () => {
    const custom = createMod(
      { name: "Custom", prefix: "custom_mod", supportedVersion: "4.4.*" },
      { ids: { ...COMPLETE_PROFILE, technology: "invention" } }
    );
    expect(Object.isFrozen(custom.ids)).toBe(true);
    expect(
      custom.technology("theory", {
        name: "Theory",
        area: "physics",
        tier: 1,
        category: "particles",
      }).id
    ).toBe("custom_mod_invention_theory");
    expect(() =>
      createMod(
        { name: "Bad", prefix: "bad_profile", supportedVersion: "4.4.*" },
        { ids: { technology: "tech" } as IdProfile }
      )
    ).toThrow("Id profile must provide exactly one");
    expect(() =>
      createMod(
        { name: "Extra", prefix: "extra_profile", supportedVersion: "4.4.*" },
        { ids: { ...COMPLETE_PROFILE, extra: "extra" } as IdProfile }
      )
    ).toThrow("Id profile must provide exactly one");
    expect(() =>
      createMod(
        { name: "Invalid", prefix: "invalid_profile", supportedVersion: "4.4.*" },
        { ids: { ...COMPLETE_PROFILE, technology: "not valid" } }
      )
    ).toThrow('Id profile segment "technology: not valid" must be lowercase snake_case');
  });

  it("rejects invalid logical names and namespaces before definitions", () => {
    const capability = createMod({ name: "Names", prefix: "names_mod", supportedVersion: "4.4.*" });
    expect(() => capability.namespace("Bad.Name")).toThrow(
      'Event namespace "names_mod_Bad.Name" must be lowercase snake_case'
    );
    expect(() =>
      capability.technology("Not a name", {
        name: "Invalid",
        area: "physics",
        tier: 1,
        category: "particles",
      })
    ).toThrow('Logical content name "Not a name" must be lowercase snake_case');
    expect(capability.namespace().namespace).toBe("names_mod");
  });
});

function reusablePack<P extends string, I extends IdProfile>(capability: ModCapability<P, I>) {
  const theory = capability.technology("pack_theory", {
    name: "Pack Theory",
    area: "physics",
    tier: 1,
    category: "particles",
  });
  const application = capability.technology("pack_application", {
    name: "Pack Application",
    area: "physics",
    tier: 2,
    category: "particles",
    prerequisites: [theory],
  });
  return capability.feature("pack", [theory, application]);
}

describe("mod capability composition", () => {
  it("rejects an invalid id before minting a capability event handle", () => {
    const events = createMod({
      name: "Event numbers",
      prefix: "event_numbers",
      supportedVersion: "4.4.*",
    }).namespace();
    expect(() => events.countryHandle(Number.NaN)).toThrow(/non-negative safe integer/);
  });

  it("authors a generic pack under two literal prefixes", () => {
    const alpha = createMod({ name: "Alpha", prefix: "alpha_mod", supportedVersion: "4.4.*" });
    const beta = createMod({ name: "Beta", prefix: "beta_mod", supportedVersion: "4.4.*" });
    const alphaFile = render(alpha.compile([reusablePack(alpha)])).get(
      "common/technology/alpha_mod_pack.txt"
    );
    const betaFile = render(beta.compile([reusablePack(beta)])).get(
      "common/technology/beta_mod_pack.txt"
    );
    expect(alphaFile).toContain("alpha_mod_tech_pack_theory");
    expect(alphaFile).toContain('prerequisites = { "alpha_mod_tech_pack_theory" }');
    expect(betaFile).toContain("beta_mod_tech_pack_theory");
    expect(betaFile).toContain('prerequisites = { "beta_mod_tech_pack_theory" }');
  });

  it("defines cyclic event handles with actual ids and no placeholders", () => {
    const capability = createMod({
      name: "Cycles",
      prefix: "cycle_mod",
      supportedVersion: "4.4.*",
    });
    const events = capability.namespace("chain");
    const first = events.countryHandle(1);
    const second = events.countryHandle(2);
    const firstDefinition = first.define({
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: second }),
    });
    const secondDefinition = second.define({
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: first }),
    });
    const source = render(
      capability.compile([capability.feature("chain", [firstDefinition, secondDefinition])])
    ).get("events/cycle_mod_chain.txt");
    expect(first.id).toBe("cycle_mod_chain.1");
    expect(second.id).toBe("cycle_mod_chain.2");
    expect(first.scope).toBe("country");
    expect(first.scopes).toEqual({});
    expect(source).toContain("id = cycle_mod_chain.1");
    expect(source).toContain("id = cycle_mod_chain.2");
    expect(source).not.toContain("placeholder");
  });

  it("mints a content id through a handle before its definition exists", () => {
    const capability = createMod({
      name: "Handles",
      prefix: "handle_mod",
      supportedVersion: "4.4.*",
    });
    const spelltech = capability.ascensionPerkHandle("spelltech");

    expect(spelltech.id).toBe("handle_mod_ascension_perk_spelltech");
    // The eager method is `handle(name).define(def)`, so both mint the same id.
    expect(capability.ascensionPerk("spelltech", { name: "Spelltech" }).id).toBe(spelltech.id);
  });

  it("rejects an invalid logical name before minting a content handle", () => {
    const capability = createMod({
      name: "Handles",
      prefix: "handle_mod",
      supportedVersion: "4.4.*",
    });
    // Eager, like the event handle's id check — the mint site is where the
    // author can see which name was wrong.
    expect(() => capability.ascensionPerkHandle("Not Snake Case")).toThrow(/snake_case/);
  });

  it("defines a self-excluding ascension perk through its own handle", () => {
    const capability = createMod({
      name: "Self",
      prefix: "self_mod",
      supportedVersion: "4.4.*",
    });
    const spelltech = capability.ascensionPerkHandle("spelltech");
    const perk = spelltech.define({
      name: "Spelltech",
      potential: not(hasAscensionPerk(spelltech)),
    });
    const source = render(capability.compile([capability.feature("perks", [perk])])).get(
      "common/ascension_perks/self_mod_perks.txt"
    );

    expect(source).toContain("self_mod_ascension_perk_spelltech = {");
    expect(source).toContain("has_ascension_perk = self_mod_ascension_perk_spelltech");
    expect(source).not.toContain("placeholder");
  });

  it("defines cyclic content handles with actual ids and no placeholders", () => {
    const capability = createMod({
      name: "Cycles",
      prefix: "cycle_mod",
      supportedVersion: "4.4.*",
    });
    const first = capability.ascensionPerkHandle("first");
    const second = capability.ascensionPerkHandle("second");
    const firstPerk = first.define({ name: "First", potential: not(hasAscensionPerk(second)) });
    const secondPerk = second.define({ name: "Second", potential: not(hasAscensionPerk(first)) });
    const source = render(
      capability.compile([capability.feature("perks", [firstPerk, secondPerk])])
    ).get("common/ascension_perks/cycle_mod_perks.txt");

    expect(first.id).toBe("cycle_mod_ascension_perk_first");
    expect(second.id).toBe("cycle_mod_ascension_perk_second");
    expect(source).toContain("has_ascension_perk = cycle_mod_ascension_perk_second");
    expect(source).toContain("has_ascension_perk = cycle_mod_ascension_perk_first");
    expect(source).not.toContain("placeholder");
  });

  it("rejects a referenced handle whose definition never entered the build", () => {
    const capability = createMod({
      name: "Dangling",
      prefix: "dangling_mod",
      supportedVersion: "4.4.*",
    });
    const undefinedPerk = capability.ascensionPerkHandle("never_defined");
    const perk = capability.ascensionPerk("present", {
      name: "Present",
      potential: not(hasAscensionPerk(undefinedPerk)),
    });

    // The existing dangling-reference guard already covers a minted-but-never-
    // defined handle: its id carries the prefix and matches no vanilla perk.
    expect(() => capability.compile([capability.feature("perks", [perk])])).toThrow(
      /"dangling_mod_ascension_perk_never_defined".*no such ascension_perk is among the features/s
    );
  });

  it("control: the same reference resolves once the handle is defined", () => {
    const capability = createMod({
      name: "Resolved",
      prefix: "resolved_mod",
      supportedVersion: "4.4.*",
    });
    const target = capability.ascensionPerkHandle("target");
    const perk = capability.ascensionPerk("present", {
      name: "Present",
      potential: not(hasAscensionPerk(target)),
    });

    expect(() =>
      capability.compile([capability.feature("perks", [perk, target.define({ name: "Target" })])])
    ).not.toThrow();
  });

  it("rejects two placed definitions minted from one handle", () => {
    const capability = createMod({
      name: "Twice",
      prefix: "twice_mod",
      supportedVersion: "4.4.*",
    });
    const perk = capability.ascensionPerkHandle("once");

    // `define` is pure and holds no state, so this is the same refusal calling
    // `mod.ascensionPerk` twice with one name already earns.
    expect(() =>
      capability.compile([
        capability.feature("perks", [perk.define({ name: "A" }), perk.define({ name: "B" })]),
      ])
    ).toThrow(/Duplicate ascension_perk id/);
  });

  it("fans a feature across registries while keeping definition identity independent of stem", () => {
    const capability = createMod({
      name: "Layout",
      prefix: "layout_mod",
      supportedVersion: "4.4.*",
    });
    const technology = capability.technology("stable", {
      name: "Stable",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const building = capability.building("one", {
      name: "One",
      baseBuildtime: 10,
      category: "research",
      icon: "building_research_lab_1",
      buildingSets: ["research"],
      canBuild: true,
    });
    const mixed = render(capability.compile([capability.feature("mixed", [technology, building])]));
    const alpha = render(capability.compile([capability.feature("alpha", [technology])]));
    const beta = render(capability.compile([capability.feature("beta", [technology])]));
    expect(mixed.has("common/technology/layout_mod_mixed.txt")).toBe(true);
    expect(mixed.has("common/buildings/layout_mod_mixed.txt")).toBe(true);
    expect(technology.id).toBe("layout_mod_tech_stable");
    expect(alpha.get("common/technology/layout_mod_alpha.txt")).toBe(
      beta.get("common/technology/layout_mod_beta.txt")
    );
  });

  it("rejects foreign features, forged collections, and foreign content, events, and on-actions", () => {
    const alpha = createMod({ name: "Alpha", prefix: "alpha_mod", supportedVersion: "4.4.*" });
    const beta = createMod({ name: "Beta", prefix: "beta_mod", supportedVersion: "4.4.*" });
    const betaTechnology = beta.technology("theory", {
      name: "Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expect(() => alpha.compile([beta.feature("theory", [betaTechnology])] as never)).toThrow(
      'Feature does not belong to mod prefix "alpha_mod"'
    );
    expect(() =>
      alpha.compile([{ itemKind: "feature", stem: "forged", items: [] }] as never)
    ).toThrow('Feature does not belong to mod prefix "alpha_mod"');
    const samePrefix = createMod({ name: "Again", prefix: "alpha_mod", supportedVersion: "4.4.*" });
    expect(() => samePrefix.compile([alpha.feature("empty", [])])).toThrow(
      'Feature does not belong to mod prefix "alpha_mod"'
    );
    const foreignContent = {
      itemKind: "content" as const,
      type: "technology" as const,
      id: "other_tech_x",
      def: { id: "other_tech_x" },
    };
    const foreignEvent = { itemKind: "event" as const, namespace: "other", id: "other.1" };
    const foreignOnAction = { itemKind: "on-action" as const, events: [foreignEvent] };
    expect(() => alpha.feature("foreign", [foreignContent] as never)).toThrow(
      'Content id "other_tech_x" does not belong to mod prefix "alpha_mod"'
    );
    expect(() => alpha.feature("foreign", [foreignEvent] as never)).toThrow(
      'Event namespace "other" does not belong to mod prefix "alpha_mod"'
    );
    expect(() => alpha.feature("foreign", [foreignOnAction] as never)).toThrow(
      'On-action event namespace "other" does not belong to mod prefix "alpha_mod"'
    );
  });

  it("keeps patch and ship-of-size contributions on the capability surface", () => {
    const capability = createMod({
      name: "Contributions",
      prefix: "contrib_mod",
      supportedVersion: "4.4.*",
    });
    const limit = capability.countryShipOfSizeLimit("titan", {
      shipTypes: ["ship_size_titan"],
      base: 80,
      show: always(),
    });
    const files = render(
      capability.compile([
        capability.feature(undefined, [limit, capability.addShipOfSizeLimits([limit])]),
      ])
    );
    expect(
      files.get("common/country_limits/ship_of_size_limits/contrib_mod_ship_of_size_limits.txt")
    ).toContain("contrib_mod_country_ship_of_size_limit_titan");
    expect(
      files.get("common/country_limits/ownership_limits/contrib_mod_ownership_limits.txt")
    ).toContain(
      "default = {\n\tship_of_size_limits = { contrib_mod_country_ship_of_size_limit_titan }\n}"
    );
  });

  it("rejects a patch minted by one capability and placed in another's feature", () => {
    // A patch keeps vanilla's id, so it has no id of its own to hold to the
    // prefix — which is why placing one was exempt from the ownership check
    // entirely. It is not identity-free any more: the capability binds its
    // prefix into `patchX`, and every localisation key the patch mints comes
    // from it, so a foreign patch would write another mod's keys into this
    // one's output. Nothing else would notice.
    const vanilla = viewFromFiles({
      "common/technology/pp_tech.txt": "tech_probe = {\n\tarea = physics\n\ttier = 1\n}\n",
    });
    const alpha = createMod({ name: "Alpha", prefix: "alpha_mod", supportedVersion: "4.4.*" });
    const beta = createMod({ name: "Beta", prefix: "beta_mod", supportedVersion: "4.4.*" });
    const alphaPatch = alpha.patchTechnology(
      vanilla.definition("technology", "tech_probe"),
      () => ({
        name: "Renamed by Alpha",
        weightModifier: { modifiers: [{ factor: 2, desc: "Because.", descKey: "because" }] },
      })
    );

    expect(() => beta.feature(undefined, [alphaPatch])).toThrow(
      'The technology patch of "tech_probe" was created by the capability for mod prefix ' +
        '"alpha_mod", not "beta_mod"'
    );
    // And the same item in its own capability's feature still builds, keys and
    // all — the check is ownership, not a new restriction on patching.
    const files = render(alpha.compile([alpha.feature(undefined, [alphaPatch])]));
    expect(files.get("localisation/english/alpha_mod_l_english.yml")).toContain(
      "alpha_mod_tech_probe_weight_modifier_because"
    );
    expect(files.get("localisation/replace/english/alpha_mod_l_english.yml")).toContain(
      'tech_probe:0 "Renamed by Alpha"'
    );
  });
});

describe("mod capability nested identities", () => {
  it("preserves capability-owned nested definition ids", () => {
    const capability = mod();
    const tradition = capability.tradition("harmony", {
      name: "Harmony",
      traditionSwap: { nested_capability_renewal: { name: "Renewal" } },
    });
    expect(Object.keys(tradition.def.traditionSwap ?? {})).toEqual(["nested_capability_renewal"]);
    expect(
      render(capability.compile([capability.feature("traditions", [tradition])])).get(
        "common/traditions/nested_capability_traditions.txt"
      )
    ).toContain("name = nested_capability_renewal");
  });

  it("rejects unprefixed and invalid nested definition ids", () => {
    expect(() =>
      mod().tradition("harmony", {
        name: "Harmony",
        traditionSwap: { renewal: { name: "Renewal" } },
      })
    ).toThrow('Nested definition id "renewal" does not belong to mod prefix "nested_capability"');
    expect(() =>
      mod().tradition("harmony", {
        name: "Harmony",
        traditionSwap: { "not a valid id": { name: "Renewal" } },
      })
    ).toThrow('Nested definition id "not a valid id" must be lowercase snake_case');
  });

  it("preserves situation stage and approach ids referenced in the same definition", () => {
    const capability = mod();
    const situation = capability.situationType("mood", {
      name: "Mood",
      monthlyProgress: { base: 1 },
      stages: {
        nested_capability_stage: {
          name: "Stage",
          icon: "GFX_situation_stage",
          iconBackground: "GFX_situation_stage_bg",
          potential: currentSituationApproach("nested_capability_calm"),
        },
      },
      approach: {
        nested_capability_calm: {
          name: "Calm",
          icon: "GFX_situation_approach",
          iconBackground: "GFX_situation_approach_bg",
          allow: currentStage("nested_capability_stage"),
        },
      },
    });
    const rendered = render(
      capability.compile([capability.feature("situations", [situation])])
    ).get("common/situations/nested_capability_situations.txt");
    expect(rendered).toContain("current_situation_approach = nested_capability_calm");
    expect(rendered).toContain("current_stage = nested_capability_stage");
  });
});
