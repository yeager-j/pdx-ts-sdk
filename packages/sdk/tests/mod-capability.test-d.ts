import { describe, expectTypeOf, it } from "vitest";

import {
  createMod,
  type CapabilityEventItem,
  type ContentItem,
  type IdProfile,
  type MintedContentId,
  type ModCapability,
} from "../src/index.ts";
import {
  always,
  currentSituationApproach,
  currentStage,
  type ComponentSetRequiredComponentRef,
  type ScopeRef,
  type SituationTypeDef,
  type TraditionDef,
} from "../src/stellaris.ts";

const profile = {
  technology: "invention",
  building: "building",
  tradition: "tradition",
  traditionCategory: "tradition_category",
  ascensionPerk: "ascension_perk",
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

describe("mod capability types", () => {
  it("preserves attribute-selected component-set subtype references", () => {
    const mod = createMod({
      name: "Component sets",
      prefix: "component_set_types",
      supportedVersion: "4.4.*",
    });
    const required = mod.componentSet("reactor", { requiredComponentSet: true });
    const ordinary = mod.componentSet("weapon", {});
    const acceptsRequired = (_set: ComponentSetRequiredComponentRef): void => {};

    acceptsRequired(required);
    expectTypeOf(required.def.requiredComponentSet).toEqualTypeOf<true>();
    // @ts-expect-error — an ordinary component set does not carry the required-component subtype.
    acceptsRequired(ordinary);
  });

  it("mints exact default and custom ids without accepting caller ids", () => {
    const defaults = createMod({
      name: "Defaults",
      prefix: "default_types",
      supportedVersion: "4.4.*",
    });
    const defaultTechnology = defaults.technology("theory", {
      name: "Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expectTypeOf(defaultTechnology.id).toEqualTypeOf<"default_types_tech_theory">();
    expectTypeOf(defaultTechnology.id).toEqualTypeOf<
      MintedContentId<"default_types", typeof defaults.ids, "technology", "theory">
    >();
    defaults.technology("reject_id", {
      // @ts-expect-error — the capability, rather than the caller, owns id minting.
      id: "default_types_tech_forged",
      name: "Reject",
      area: "physics",
      tier: 1,
      category: "particles",
    });

    const custom = createMod(
      { name: "Custom", prefix: "custom_types", supportedVersion: "4.4.*" },
      { ids: profile }
    );
    const customTechnology = custom.technology("theory", {
      name: "Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expectTypeOf(customTechnology.id).toEqualTypeOf<"custom_types_invention_theory">();
  });

  it("preserves registry references, namespaces, and FROM witnesses", () => {
    const mod = createMod({ name: "Events", prefix: "event_types", supportedVersion: "4.4.*" });
    const theory = mod.technology("theory", {
      name: "Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    mod.technology("application", {
      name: "Application",
      area: "physics",
      tier: 2,
      category: "particles",
      prerequisites: [theory],
    });
    const building = mod.building("lab", {
      name: "Lab",
      baseBuildtime: 10,
      category: "research",
      icon: "building_research_lab_1",
      buildingSets: ["research"],
      canBuild: true,
      prerequisites: [theory],
    });
    mod.technology("wrong_registry", {
      name: "Wrong registry",
      area: "physics",
      tier: 1,
      category: "particles",
      // @ts-expect-error — technology prerequisites reject references from another registry.
      prerequisites: [building],
    });
    const root = mod.namespace();
    const nested = mod.namespace("chain");
    const rootEvent = root.country(1, { hideWindow: true, isTriggeredOnly: true });
    const fromPlanet = nested.country(2, {
      scopes: { from: "planet" },
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (_country, ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"planet">>();
      },
    });
    const needsCountryFrom = nested.planet(3, {
      scopes: { from: "country" },
      hideWindow: true,
      isTriggeredOnly: true,
    });
    root.country(4, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.everyOwnedPlanet({}, (planet) => {
          planet.planetEvent({ id: needsCountryFrom, scopes: { from: ctx.root } });
          // @ts-expect-error — the target's FROM contract requires a country witness.
          planet.planetEvent({ id: needsCountryFrom });
        });
      },
    });
    expectTypeOf(rootEvent).toEqualTypeOf<
      CapabilityEventItem<"event_types", "", 1, "country", {}>
    >();
    expectTypeOf(rootEvent.id).toEqualTypeOf<"event_types.1">();
    expectTypeOf(fromPlanet.id).toEqualTypeOf<"event_types_chain.2">();
    expectTypeOf(rootEvent.scope).toEqualTypeOf<"country">();
    expectTypeOf(rootEvent.scopes).toEqualTypeOf<{}>();
    expectTypeOf(fromPlanet.scopes).toEqualTypeOf<{ from: "planet" }>();
  });

  it("makes config, tags, and profile readonly", () => {
    const mod = createMod(
      {
        name: "Readonly",
        prefix: "readonly_types",
        supportedVersion: "4.4.*",
        tags: ["Technologies"],
      },
      { ids: profile }
    );
    // @ts-expect-error — config is a snapshot.
    mod.config.prefix = "other";
    // @ts-expect-error — tags cannot mutate after capability creation.
    mod.config.tags?.push("Other");
    // @ts-expect-error — profile segments cannot mutate after capability creation.
    mod.ids.technology = "other";
  });

  it("rejects foreign capability placement and legacy collections", () => {
    const alpha = createMod({ name: "Alpha", prefix: "alpha_types", supportedVersion: "4.4.*" });
    const beta = createMod({ name: "Beta", prefix: "beta_types", supportedVersion: "4.4.*" });
    const alphaFeature = alpha.feature("empty", []);
    // @ts-expect-error — branded features cannot cross capabilities.
    beta.compile([alphaFeature]);
    // @ts-expect-error — the legacy collection shape is not a capability feature.
    alpha.compile([{ itemKind: "feature", stem: "legacy", items: [] }]);
  });

  it("keeps generic packs, content scope, and handwritten situations coherent", () => {
    function pack<P extends string, I extends IdProfile>(mod: ModCapability<P, I>) {
      const first = mod.technology("first", {
        name: "First",
        area: "physics",
        tier: 1,
        category: "particles",
      });
      return mod.feature("pack", [first]);
    }
    const alpha = createMod({ name: "Alpha", prefix: "generic_alpha", supportedVersion: "4.4.*" });
    const beta = createMod({ name: "Beta", prefix: "generic_beta", supportedVersion: "4.4.*" });
    expectTypeOf(pack(alpha).items[0]!.id).toEqualTypeOf<"generic_alpha_tech_first">();
    expectTypeOf(pack(beta).items[0]!.id).toEqualTypeOf<"generic_beta_tech_first">();

    const mod = createMod({ name: "Content", prefix: "content_types", supportedVersion: "4.4.*" });
    const decision = mod.decision("planet", {
      scope: "planet",
      name: "Planet",
      effect: (planet) => planet.log("planet"),
    });
    expectTypeOf(decision.id).toEqualTypeOf<"content_types_decision_planet">();
    mod.decision("wrong_scope", {
      scope: "planet",
      name: "Wrong",
      // @ts-expect-error — decisions declared for planets cannot record country effects.
      effect: (country) => country.setCountryFlag("wrong"),
    });
    const situation = mod.situationType("mood", {
      name: "Mood",
      targetScope: "country",
      monthlyProgress: { base: 1 },
      approach: {
        content_types_calm: {
          name: "Calm",
          icon: "GFX_situation_approach",
          iconBackground: "GFX_situation_approach_bg",
          allow: currentStage("content_types_stage"),
        },
      },
      stages: {
        content_types_stage: {
          name: "Stage",
          icon: "GFX_situation_stage",
          iconBackground: "GFX_situation_stage_bg",
          potential: currentSituationApproach("content_types_calm"),
        },
      },
      abortTrigger: always(),
    });
    expectTypeOf(situation).toEqualTypeOf<
      ContentItem<"situation_type", SituationTypeDef<"content_types_situation_type_mood">> & {
        readonly targetScope: "country";
      }
    >();
  });

  it("preserves capability nested ids in the returned content type", () => {
    const mod = createMod({ name: "Nested", prefix: "nested_types", supportedVersion: "4.4.*" });
    const tradition = mod.tradition("harmony", {
      name: "Harmony",
      traditionSwap: { nested_types_renewal: { name: "Renewal" } },
    });
    expectTypeOf(tradition).toEqualTypeOf<
      ContentItem<"tradition", TraditionDef<"nested_types_tradition_harmony">>
    >();
  });
});
