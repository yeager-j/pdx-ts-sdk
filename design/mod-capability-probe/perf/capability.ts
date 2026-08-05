import { defineSituationType } from "../../../packages/sdk/src/content/situations.ts";
import type { ContentItem } from "../../../packages/sdk/src/content/types.ts";
import type { AgreementPresetDef } from "../../../packages/sdk/src/generated/agreement-preset.ts";
import type { AmbientObjectDef } from "../../../packages/sdk/src/generated/ambient-object.ts";
import type { ArchaeologicalSiteTypeDef } from "../../../packages/sdk/src/generated/archaeological-site-type.ts";
import type { AscensionPerkDef } from "../../../packages/sdk/src/generated/ascension-perk.ts";
import type { BombardmentStanceDef } from "../../../packages/sdk/src/generated/bombardment-stance.ts";
import type { CasusBelliDef } from "../../../packages/sdk/src/generated/casus-belli.ts";
import type { CivicOrOriginDef } from "../../../packages/sdk/src/generated/civic-or-origin.ts";
import type { ComponentSetDef } from "../../../packages/sdk/src/generated/component-set.ts";
import type { CouncilorDef } from "../../../packages/sdk/src/generated/councilor.ts";
import type { CountryShipOfSizeLimitDef } from "../../../packages/sdk/src/generated/country-ship-of-size-limit.ts";
import type { DecisionDef, DecisionScope } from "../../../packages/sdk/src/generated/decision.ts";
import type { EconomicCategoryDef } from "../../../packages/sdk/src/generated/economic-category.ts";
import type { GlobalShipDesignDef } from "../../../packages/sdk/src/generated/global-ship-design.ts";
import type { GraphicalCultureDef } from "../../../packages/sdk/src/generated/graphical-culture.ts";
import type { JobDef } from "../../../packages/sdk/src/generated/job.ts";
import type { OpinionModifierDef } from "../../../packages/sdk/src/generated/opinion-modifier.ts";
import type { ScriptedLocDef } from "../../../packages/sdk/src/generated/scripted-loc.ts";
import type { ScriptedModifierDef } from "../../../packages/sdk/src/generated/scripted-modifier.ts";
import type { SectionTemplateDef } from "../../../packages/sdk/src/generated/section-template.ts";
import type { ShipSizeDef } from "../../../packages/sdk/src/generated/ship-size.ts";
import type { SolarSystemInitializerDef } from "../../../packages/sdk/src/generated/solar-system-initializer.ts";
import type { SpeciesClassDef } from "../../../packages/sdk/src/generated/species-class.ts";
import type { StarbaseLevelDef } from "../../../packages/sdk/src/generated/starbase-level.ts";
import type { StaticModifierDef } from "../../../packages/sdk/src/generated/static-modifier.ts";
import type { StrikeCraftComponentTemplateDef } from "../../../packages/sdk/src/generated/strike-craft-component-template.ts";
import type { UtilityComponentTemplateDef } from "../../../packages/sdk/src/generated/utility-component-template.ts";
import type { WarGoalDef } from "../../../packages/sdk/src/generated/war-goal.ts";
import type { WeaponComponentTemplateDef } from "../../../packages/sdk/src/generated/weapon-component-template.ts";
import { createMod, stellarisIds, type ModCapability, type ProbeIdProfile } from "../capability.ts";
import { names } from "./names.ts";

type FullIdProfile = ProbeIdProfile & {
  readonly agreementPreset: "agreement_preset";
  readonly ambientObject: "ambient_object";
  readonly archaeologicalSiteType: "archaeological_site_type";
  readonly ascensionPerk: "ascension_perk";
  readonly bombardmentStance: "bombardment_stance";
  readonly casusBelli: "casus_belli";
  readonly civicOrOrigin: "civic_or_origin";
  readonly componentSet: "component_set";
  readonly councilor: "councilor";
  readonly countryShipOfSizeLimit: "country_ship_of_size_limit";
  readonly decision: "decision";
  readonly economicCategory: "economic_category";
  readonly globalShipDesign: "global_ship_design";
  readonly graphicalCulture: "graphical_culture";
  readonly job: "job";
  readonly opinionModifier: "opinion_modifier";
  readonly scriptedLoc: "scripted_loc";
  readonly scriptedModifier: "scripted_modifier";
  readonly sectionTemplate: "section_template";
  readonly shipSize: "ship_size";
  readonly situationType: "situation_type";
  readonly solarSystemInitializer: "solar_system_initializer";
  readonly speciesClass: "species_class";
  readonly starbaseLevel: "starbase_level";
  readonly staticModifier: "static_modifier";
  readonly strikeCraftComponentTemplate: "strike_craft_component_template";
  readonly utilityComponentTemplate: "utility_component_template";
  readonly warGoal: "war_goal";
  readonly weaponComponentTemplate: "weapon_component_template";
};

type MintId<
  P extends string,
  I extends FullIdProfile,
  K extends keyof I,
  N extends string,
> = `${P}_${I[K] & string}_${N}`;

type ExtraContentMethods<P extends string, I extends FullIdProfile> = {
  agreementPreset<const N extends string>(
    name: N,
    def: Omit<AgreementPresetDef<MintId<P, I, "agreementPreset", N>>, "id">
  ): ContentItem<"agreement_preset", AgreementPresetDef<MintId<P, I, "agreementPreset", N>>>;
  ambientObject<const N extends string>(
    name: N,
    def: Omit<AmbientObjectDef<MintId<P, I, "ambientObject", N>>, "id">
  ): ContentItem<"ambient_object", AmbientObjectDef<MintId<P, I, "ambientObject", N>>>;
  archaeologicalSiteType<const N extends string>(
    name: N,
    def: Omit<ArchaeologicalSiteTypeDef<MintId<P, I, "archaeologicalSiteType", N>>, "id">
  ): ContentItem<
    "archaeological_site_type",
    ArchaeologicalSiteTypeDef<MintId<P, I, "archaeologicalSiteType", N>>
  >;
  ascensionPerk<const N extends string>(
    name: N,
    def: Omit<AscensionPerkDef<MintId<P, I, "ascensionPerk", N>>, "id">
  ): ContentItem<"ascension_perk", AscensionPerkDef<MintId<P, I, "ascensionPerk", N>>>;
  bombardmentStance<const N extends string>(
    name: N,
    def: Omit<BombardmentStanceDef<MintId<P, I, "bombardmentStance", N>>, "id">
  ): ContentItem<"bombardment_stance", BombardmentStanceDef<MintId<P, I, "bombardmentStance", N>>>;
  casusBelli<const N extends string>(
    name: N,
    def: Omit<CasusBelliDef<MintId<P, I, "casusBelli", N>>, "id">
  ): ContentItem<"casus_belli", CasusBelliDef<MintId<P, I, "casusBelli", N>>>;
  civicOrOrigin<const N extends string>(
    name: N,
    def: Omit<CivicOrOriginDef<MintId<P, I, "civicOrOrigin", N>>, "id">
  ): ContentItem<"civic_or_origin", CivicOrOriginDef<MintId<P, I, "civicOrOrigin", N>>>;
  componentSet<const N extends string>(
    name: N,
    def: Omit<ComponentSetDef<MintId<P, I, "componentSet", N>>, "id">
  ): ContentItem<"component_set", ComponentSetDef<MintId<P, I, "componentSet", N>>>;
  councilor<const N extends string>(
    name: N,
    def: Omit<CouncilorDef<MintId<P, I, "councilor", N>>, "id">
  ): ContentItem<"councilor", CouncilorDef<MintId<P, I, "councilor", N>>>;
  countryShipOfSizeLimit<const N extends string>(
    name: N,
    def: Omit<CountryShipOfSizeLimitDef<MintId<P, I, "countryShipOfSizeLimit", N>>, "id">
  ): ContentItem<
    "country_ship_of_size_limit",
    CountryShipOfSizeLimitDef<MintId<P, I, "countryShipOfSizeLimit", N>>
  >;
  decision<const N extends string, S extends DecisionScope = "planet">(
    name: N,
    def: Omit<DecisionDef<MintId<P, I, "decision", N>, S>, "id">
  ): ContentItem<"decision", DecisionDef<MintId<P, I, "decision", N>, never>>;
  economicCategory<const N extends string>(
    name: N,
    def: Omit<EconomicCategoryDef<MintId<P, I, "economicCategory", N>>, "id">
  ): ContentItem<"economic_category", EconomicCategoryDef<MintId<P, I, "economicCategory", N>>>;
  globalShipDesign<const N extends string>(
    name: N,
    def: Omit<GlobalShipDesignDef<MintId<P, I, "globalShipDesign", N>>, "id">
  ): ContentItem<"global_ship_design", GlobalShipDesignDef<MintId<P, I, "globalShipDesign", N>>>;
  graphicalCulture<const N extends string>(
    name: N,
    def: Omit<GraphicalCultureDef<MintId<P, I, "graphicalCulture", N>>, "id">
  ): ContentItem<"graphical_culture", GraphicalCultureDef<MintId<P, I, "graphicalCulture", N>>>;
  job<const N extends string>(
    name: N,
    def: Omit<JobDef<MintId<P, I, "job", N>>, "id">
  ): ContentItem<"job", JobDef<MintId<P, I, "job", N>>>;
  opinionModifier<const N extends string>(
    name: N,
    def: Omit<OpinionModifierDef<MintId<P, I, "opinionModifier", N>>, "id">
  ): ContentItem<"opinion_modifier", OpinionModifierDef<MintId<P, I, "opinionModifier", N>>>;
  scriptedLoc<const N extends string>(
    name: N,
    def: Omit<ScriptedLocDef<MintId<P, I, "scriptedLoc", N>>, "id">
  ): ContentItem<"scripted_loc", ScriptedLocDef<MintId<P, I, "scriptedLoc", N>>>;
  scriptedModifier<const N extends string>(
    name: N,
    def: Omit<ScriptedModifierDef<MintId<P, I, "scriptedModifier", N>>, "id">
  ): ContentItem<"scripted_modifier", ScriptedModifierDef<MintId<P, I, "scriptedModifier", N>>>;
  sectionTemplate<const N extends string>(
    name: N,
    def: Omit<SectionTemplateDef<MintId<P, I, "sectionTemplate", N>>, "id">
  ): ContentItem<"section_template", SectionTemplateDef<MintId<P, I, "sectionTemplate", N>>>;
  shipSize<const N extends string>(
    name: N,
    def: Omit<ShipSizeDef<MintId<P, I, "shipSize", N>>, "id">
  ): ContentItem<"ship_size", ShipSizeDef<MintId<P, I, "shipSize", N>>>;
  situationType<
    const N extends string,
    T extends import("../../../packages/sdk/src/generated/scopes.ts").ScopeName | undefined =
      undefined,
    const A extends string = never,
    const S extends string = never,
  >(
    name: N,
    def: Omit<
      Parameters<typeof defineSituationType<MintId<P, I, "situationType", N>, T, A, S>>[0],
      "id"
    >
  ): ReturnType<typeof defineSituationType<MintId<P, I, "situationType", N>, T, A, S>>;
  solarSystemInitializer<const N extends string>(
    name: N,
    def: Omit<SolarSystemInitializerDef<MintId<P, I, "solarSystemInitializer", N>>, "id">
  ): ContentItem<
    "solar_system_initializer",
    SolarSystemInitializerDef<MintId<P, I, "solarSystemInitializer", N>>
  >;
  speciesClass<const N extends string>(
    name: N,
    def: Omit<SpeciesClassDef<MintId<P, I, "speciesClass", N>>, "id">
  ): ContentItem<"species_class", SpeciesClassDef<MintId<P, I, "speciesClass", N>>>;
  starbaseLevel<const N extends string>(
    name: N,
    def: Omit<StarbaseLevelDef<MintId<P, I, "starbaseLevel", N>>, "id">
  ): ContentItem<"starbase_level", StarbaseLevelDef<MintId<P, I, "starbaseLevel", N>>>;
  staticModifier<const N extends string>(
    name: N,
    def: Omit<StaticModifierDef<MintId<P, I, "staticModifier", N>>, "id">
  ): ContentItem<"static_modifier", StaticModifierDef<MintId<P, I, "staticModifier", N>>>;
  strikeCraftComponentTemplate<const N extends string>(
    name: N,
    def: Omit<
      StrikeCraftComponentTemplateDef<MintId<P, I, "strikeCraftComponentTemplate", N>>,
      "id"
    >
  ): ContentItem<
    "strike_craft_component_template",
    StrikeCraftComponentTemplateDef<MintId<P, I, "strikeCraftComponentTemplate", N>>
  >;
  utilityComponentTemplate<const N extends string>(
    name: N,
    def: Omit<UtilityComponentTemplateDef<MintId<P, I, "utilityComponentTemplate", N>>, "id">
  ): ContentItem<
    "utility_component_template",
    UtilityComponentTemplateDef<MintId<P, I, "utilityComponentTemplate", N>>
  >;
  warGoal<const N extends string>(
    name: N,
    def: Omit<WarGoalDef<MintId<P, I, "warGoal", N>>, "id">
  ): ContentItem<"war_goal", WarGoalDef<MintId<P, I, "warGoal", N>>>;
  weaponComponentTemplate<const N extends string>(
    name: N,
    def: Omit<WeaponComponentTemplateDef<MintId<P, I, "weaponComponentTemplate", N>>, "id">
  ): ContentItem<
    "weapon_component_template",
    WeaponComponentTemplateDef<MintId<P, I, "weaponComponentTemplate", N>>
  >;
};

const perfIds = {
  ...stellarisIds,
  agreementPreset: "agreement_preset",
  ambientObject: "ambient_object",
  archaeologicalSiteType: "archaeological_site_type",
  ascensionPerk: "ascension_perk",
  bombardmentStance: "bombardment_stance",
  casusBelli: "casus_belli",
  civicOrOrigin: "civic_or_origin",
  componentSet: "component_set",
  councilor: "councilor",
  countryShipOfSizeLimit: "country_ship_of_size_limit",
  decision: "decision",
  economicCategory: "economic_category",
  globalShipDesign: "global_ship_design",
  graphicalCulture: "graphical_culture",
  job: "job",
  opinionModifier: "opinion_modifier",
  scriptedLoc: "scripted_loc",
  scriptedModifier: "scripted_modifier",
  sectionTemplate: "section_template",
  shipSize: "ship_size",
  situationType: "situation_type",
  solarSystemInitializer: "solar_system_initializer",
  speciesClass: "species_class",
  starbaseLevel: "starbase_level",
  staticModifier: "static_modifier",
  strikeCraftComponentTemplate: "strike_craft_component_template",
  utilityComponentTemplate: "utility_component_template",
  warGoal: "war_goal",
  weaponComponentTemplate: "weapon_component_template",
} as const satisfies FullIdProfile;

type Capability = ModCapability<"perf_probe", typeof perfIds> &
  ExtraContentMethods<"perf_probe", typeof perfIds>;
const capability = createMod(
  { name: "Perf Probe", prefix: "perf_probe", supportedVersion: "4.4.*" },
  { ids: perfIds }
) as Capability;

const fixture = "fixture";
type Fixture = typeof fixture;
type Id<K extends keyof typeof perfIds> = MintId<"perf_probe", typeof perfIds, K, Fixture>;

export const completeSurface = [
  capability.technology(
    fixture,
    {} as Omit<
      import("../../../packages/sdk/src/generated/technology.ts").TechnologyDef<Id<"technology">>,
      "id"
    >
  ),
  capability.building(
    fixture,
    {} as Omit<
      import("../../../packages/sdk/src/generated/building.ts").BuildingDef<Id<"building">>,
      "id"
    >
  ),
  capability.tradition(
    fixture,
    {} as Omit<
      import("../../../packages/sdk/src/generated/tradition.ts").TraditionDef<Id<"tradition">>,
      "id"
    >
  ),
  capability.traditionCategory(
    fixture,
    {} as Omit<
      import("../../../packages/sdk/src/generated/tradition-category.ts").TraditionCategoryDef<
        Id<"traditionCategory">
      >,
      "id"
    >
  ),
  capability.ascensionPerk(fixture, {} as Omit<AscensionPerkDef<Id<"ascensionPerk">>, "id">),
  capability.agenda(
    fixture,
    {} as Omit<
      import("../../../packages/sdk/src/generated/agenda.ts").AgendaDef<Id<"agenda">>,
      "id"
    >
  ),
  capability.edict(
    fixture,
    {} as Omit<import("../../../packages/sdk/src/generated/edict.ts").EdictDef<Id<"edict">>, "id">
  ),
  capability.decision(fixture, {} as Omit<DecisionDef<Id<"decision">, "planet">, "id">),
  capability.job(fixture, {} as Omit<JobDef<Id<"job">>, "id">),
  capability.globalShipDesign(
    fixture,
    {} as Omit<GlobalShipDesignDef<Id<"globalShipDesign">>, "id">
  ),
  capability.utilityComponentTemplate(
    fixture,
    {} as Omit<UtilityComponentTemplateDef<Id<"utilityComponentTemplate">>, "id">
  ),
  capability.weaponComponentTemplate(
    fixture,
    {} as Omit<WeaponComponentTemplateDef<Id<"weaponComponentTemplate">>, "id">
  ),
  capability.strikeCraftComponentTemplate(
    fixture,
    {} as Omit<StrikeCraftComponentTemplateDef<Id<"strikeCraftComponentTemplate">>, "id">
  ),
  capability.shipSize(fixture, {} as Omit<ShipSizeDef<Id<"shipSize">>, "id">),
  capability.opinionModifier(fixture, {} as Omit<OpinionModifierDef<Id<"opinionModifier">>, "id">),
  capability.staticModifier(fixture, {} as Omit<StaticModifierDef<Id<"staticModifier">>, "id">),
  capability.scriptedModifier(
    fixture,
    {} as Omit<ScriptedModifierDef<Id<"scriptedModifier">>, "id">
  ),
  capability.casusBelli(fixture, {} as Omit<CasusBelliDef<Id<"casusBelli">>, "id">),
  capability.warGoal(fixture, {} as Omit<WarGoalDef<Id<"warGoal">>, "id">),
  capability.agreementPreset(fixture, {} as Omit<AgreementPresetDef<Id<"agreementPreset">>, "id">),
  capability.bombardmentStance(
    fixture,
    {} as Omit<BombardmentStanceDef<Id<"bombardmentStance">>, "id">
  ),
  capability.archaeologicalSiteType(
    fixture,
    {} as Omit<ArchaeologicalSiteTypeDef<Id<"archaeologicalSiteType">>, "id">
  ),
  capability.situationType(
    fixture,
    {} as Omit<Parameters<typeof defineSituationType<Id<"situationType">>>[0], "id">
  ),
  capability.scriptedLoc(fixture, {} as Omit<ScriptedLocDef<Id<"scriptedLoc">>, "id">),
  capability.councilor(fixture, {} as Omit<CouncilorDef<Id<"councilor">>, "id">),
  capability.economicCategory(
    fixture,
    {} as Omit<EconomicCategoryDef<Id<"economicCategory">>, "id">
  ),
  capability.civicOrOrigin(fixture, {} as Omit<CivicOrOriginDef<Id<"civicOrOrigin">>, "id">),
  capability.componentSet(fixture, {} as Omit<ComponentSetDef<Id<"componentSet">>, "id">),
  capability.sectionTemplate(fixture, {} as Omit<SectionTemplateDef<Id<"sectionTemplate">>, "id">),
  capability.ambientObject(fixture, {} as Omit<AmbientObjectDef<Id<"ambientObject">>, "id">),
  capability.graphicalCulture(
    fixture,
    {} as Omit<GraphicalCultureDef<Id<"graphicalCulture">>, "id">
  ),
  capability.starbaseLevel(fixture, {} as Omit<StarbaseLevelDef<Id<"starbaseLevel">>, "id">),
  capability.speciesClass(fixture, {} as Omit<SpeciesClassDef<Id<"speciesClass">>, "id">),
  capability.countryShipOfSizeLimit(
    fixture,
    {} as Omit<CountryShipOfSizeLimitDef<Id<"countryShipOfSizeLimit">>, "id">
  ),
  capability.solarSystemInitializer(
    fixture,
    {} as Omit<SolarSystemInitializerDef<Id<"solarSystemInitializer">>, "id">
  ),
] as const;

type ExpectedTechnologyId = `perf_probe_tech_${(typeof names)[number]}`;
export const technologies = names.map((name) =>
  capability.technology(name, {
    name,
    area: "physics",
    tier: 1,
    category: "particles",
  })
);
const ids: ExpectedTechnologyId[] = technologies.map((technology) => technology.id);
void ids;
