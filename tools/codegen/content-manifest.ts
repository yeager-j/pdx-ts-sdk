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
  { type: "technology", source: "common/technologies_consolidated.cwt" },
  { type: "building", source: "common/buildings.cwt" },
  { type: "tradition", source: "common/traditions.cwt" },
  { type: "tradition_category", source: "common/traditions.cwt" },
  { type: "ascension_perk", source: "common/ascension_perks.cwt" },
  { type: "agenda", source: "common/council_agendas.cwt" },
  { type: "edict", source: "common/edicts.cwt" },
  { type: "decision", source: "common/decisions.cwt" },
  { type: "job", source: "common/pop_jobs.cwt" },
  {
    type: "global_ship_design",
    source: "common/global_ship_designs.cwt",
    keyword: "ship_design",
  },
  {
    type: "component_template",
    source: "common/components.cwt",
    keyword: "utility_component_template",
    as: "utility_component_template",
  },
  {
    type: "component_template",
    source: "common/components.cwt",
    keyword: "weapon_component_template",
    as: "weapon_component_template",
  },
  {
    type: "component_template",
    source: "common/components.cwt",
    keyword: "strike_craft_component_template",
    as: "strike_craft_component_template",
  },
  { type: "opinion_modifier", source: "common/modifiers.cwt" },
  { type: "static_modifier", source: "common/modifiers.cwt" },
  { type: "scripted_modifier", source: "common/scripted_modifiers.cwt" },
  { type: "casus_belli", source: "common/casus_belli_and_war_goals.cwt" },
  { type: "war_goal", source: "common/casus_belli_and_war_goals.cwt" },
  { type: "agreement_preset", source: "common/agreements.cwt" },
  { type: "bombardment_stance", source: "common/bombardment_stances.cwt" },
  { type: "archaeological_site_type", source: "common/archaeology.cwt" },
  { type: "situation_type", source: "common/situations.cwt" },
  {
    type: "scripted_loc",
    source: "common/scripted_loc.cwt",
    keyword: "defined_text",
  },
] as const satisfies readonly ContentManifestEntry[];
