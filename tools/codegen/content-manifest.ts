/**
 * The content registries the SDK deliberately exposes.
 *
 * This is an allowlist, not filesystem discovery: adding a registry is a
 * public-interface decision and must bring reviewed field overlays and
 * goldens with it.
 */
export interface ContentManifestEntry {
  readonly type: string;
  readonly source: string;
  /**
   * The registry name in the plural, snake_case, naming its collection factory:
   * `technologies` becomes `createTechnologies`.
   *
   * Written out rather than derived because English pluralization is not a
   * function of the singular — `technology`/`technologies`,
   * `species_class`/`species_classes` and `casus_belli`/`casus_belli` all
   * follow different rules, and a pluralizer that got one wrong would rename an
   * exported function for everyone. One explicit column costs 34 lines once.
   */
  readonly plural: string;
  /**
   * The literal top-level key, for registries CWT marks with `name_field` —
   * where the key is a repeated keyword and the id lives in a body field.
   *
   * Declared here rather than derived because CWT does not reliably carry it.
   * `global_ship_design` states `## type_key_filter = ship_design`, but
   * `section_template` and `ambient_object` state nothing at all while vanilla
   * writes `ship_section_template` and `ambient_object` — so a rule like
   * "fall back to the type name" would be right for one and silently wrong for
   * the other. Codegen verifies whatever is written here against any filter the
   * rules do declare.
   */
  readonly keyword?: string;
  /**
   * Generated name, when one CWT type backs several registries. Three keywords
   * share `type[component_template]`, and a weapon slot should not accept a
   * utility template, so each gets its own branded type and `defineX`.
   */
  readonly as?: string;
}

export const CONTENT_MANIFEST = [
  { type: "technology", plural: "technologies", source: "common/technologies_consolidated.cwt" },
  { type: "building", plural: "buildings", source: "common/buildings.cwt" },
  { type: "tradition", plural: "traditions", source: "common/traditions.cwt" },
  { type: "tradition_category", plural: "tradition_categories", source: "common/traditions.cwt" },
  { type: "ascension_perk", plural: "ascension_perks", source: "common/ascension_perks.cwt" },
  { type: "agenda", plural: "agendas", source: "common/council_agendas.cwt" },
  { type: "edict", plural: "edicts", source: "common/edicts.cwt" },
  { type: "decision", plural: "decisions", source: "common/decisions.cwt" },
  { type: "job", plural: "jobs", source: "common/pop_jobs.cwt" },
  {
    type: "global_ship_design",
    plural: "global_ship_designs",
    source: "common/global_ship_designs.cwt",
    keyword: "ship_design",
  },
  {
    type: "component_template",
    plural: "utility_component_templates",
    source: "common/components.cwt",
    keyword: "utility_component_template",
    as: "utility_component_template",
  },
  {
    type: "component_template",
    plural: "weapon_component_templates",
    source: "common/components.cwt",
    keyword: "weapon_component_template",
    as: "weapon_component_template",
  },
  {
    type: "component_template",
    plural: "strike_craft_component_templates",
    source: "common/components.cwt",
    keyword: "strike_craft_component_template",
    as: "strike_craft_component_template",
  },
  { type: "ship_size", plural: "ship_sizes", source: "common/ship_sizes.cwt" },
  { type: "opinion_modifier", plural: "opinion_modifiers", source: "common/modifiers.cwt" },
  { type: "static_modifier", plural: "static_modifiers", source: "common/modifiers.cwt" },
  {
    type: "scripted_modifier",
    plural: "scripted_modifiers",
    source: "common/scripted_modifiers.cwt",
  },
  // Latin: `casus` is fourth-declension, so the nominative plural is spelled
  // exactly like the singular — `createCasusBelli` returns a collection, not one
  // casus belli, and vanilla's own directory is `common/casus_belli`.
  { type: "casus_belli", plural: "casus_belli", source: "common/casus_belli_and_war_goals.cwt" },
  { type: "war_goal", plural: "war_goals", source: "common/casus_belli_and_war_goals.cwt" },
  { type: "agreement_preset", plural: "agreement_presets", source: "common/agreements.cwt" },
  {
    type: "bombardment_stance",
    plural: "bombardment_stances",
    source: "common/bombardment_stances.cwt",
  },
  {
    type: "archaeological_site_type",
    plural: "archaeological_site_types",
    source: "common/archaeology.cwt",
  },
  { type: "situation_type", plural: "situation_types", source: "common/situations.cwt" },
  {
    type: "scripted_loc",
    plural: "scripted_locs",
    source: "common/scripted_loc.cwt",
    keyword: "defined_text",
  },
  { type: "councilor", plural: "councilors", source: "common/governments.cwt" },
  {
    type: "economic_category",
    plural: "economic_categories",
    source: "common/economic_categories.cwt",
  },
  // The registry name is a coordination ("a civic or an origin"), so the plural
  // pluralizes both halves the way it is spoken: civics or origins.
  { type: "civic_or_origin", plural: "civics_or_origins", source: "common/governments.cwt" },
  {
    type: "component_set",
    plural: "component_sets",
    source: "common/components.cwt",
    keyword: "component_set",
  },
  {
    type: "section_template",
    plural: "section_templates",
    source: "common/section_templates.cwt",
    keyword: "ship_section_template",
  },
  {
    type: "ambient_object",
    plural: "ambient_objects",
    source: "common/ambient_objects.cwt",
    keyword: "ambient_object",
  },
  {
    type: "graphical_culture",
    plural: "graphical_cultures",
    source: "common/graphical_cultures.cwt",
  },
  {
    type: "starbase_level",
    plural: "starbase_levels",
    source: "common/starbases_consolidated.cwt",
  },
  { type: "species_class", plural: "species_classes", source: "common/species_consolidated.cwt" },
  {
    type: "country_ship_of_size_limit",
    plural: "country_ship_of_size_limits",
    source: "common/country_limits.cwt",
  },
] as const satisfies readonly ContentManifestEntry[];
