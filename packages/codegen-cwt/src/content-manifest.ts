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
   * Conventional id segment the mod capability mints between its prefix and
   * a logical definition name. Omit it when the registry name is already the
   * established spelling.
   */
  readonly idSegment?: string;
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
   *
   * It must name a subtype the CWT type declares, and codegen fails if it does
   * not: the split is by subtype, and the subtype is what the rules call the
   * registry in a reference (`<component_template.utility_component_template>`).
   * A name of our own invention here would brand definitions with a reference
   * no field asks for, leaving them unable to reach any of them.
   */
  readonly as?: string;
  /**
   * Generated name, when the SDK's name for a registry is the game's own
   * definition keyword rather than the CWT type name. `type[sprite]`'s entries
   * are written `spriteType = { ... }` and every modder calls them sprite
   * types, so `mod.spriteType` is the name that reads as the game's.
   *
   * Unlike {@link as} this asserts nothing about the rules — it does not select
   * a subtype, does not change which body is emitted, and does not change the
   * reference the definitions satisfy. It only renames, so the one thing
   * codegen checks is that the new name is a legal identifier stem, that it
   * differs from the name it replaces, and that no two registries end up
   * sharing one. Read it through {@link registryNameOf}, never by hand.
   */
  readonly name?: string;
  /**
   * Marks a registry whose vanilla id count blows out a completion menu, so
   * the generated `vanilla.*` namespace gives it the navigable trie plus
   * checked-call form instead of a flat literal-union parameter — the same
   * two-tier split `VANILLA_REF_EXTRAS` declares below.
   *
   * Only the yes-or-no belongs here. How the trie is arranged is a fact about
   * the *install's* directories, so it lives with the generator that reads
   * them (`@pdx-ts/codegen-vanilla`'s `BucketLayout`) and never reaches the
   * SDK: every trie navigates buckets to a leaf spelling the id verbatim, so
   * the runtime behaviour is the same for all of them. The two sides are
   * pinned together by a type test over `keyof VanillaTries`.
   */
  readonly oversized?: true;
}

/**
 * The generated registry name of one manifest row.
 *
 * Five derivations need this answer — the codegen content loop, the
 * `vanilla.*` namespace, the corpus measurements, the vanilla identifier
 * package's rows, and the fixture file stems — and a registry that spelled
 * itself differently in any of them would silently measure, check, or emit
 * against a registry that does not exist. So the precedence is written once:
 * an outright {@link ContentManifestEntry.name} wins, then the
 * {@link ContentManifestEntry.as} subtype rename, then the CWT type name.
 */
export function registryNameOf(entry: ContentManifestEntry): string {
  return entry.name ?? entry.as ?? entry.type;
}

export const CONTENT_MANIFEST = [
  { type: "technology", source: "common/technologies_consolidated.cwt", idSegment: "tech" },
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
  { type: "ship_size", source: "common/ship_sizes.cwt" },
  { type: "opinion_modifier", source: "common/modifiers.cwt" },
  // >2,000 ids in vanilla; gets the trie + checked-call form.
  { type: "static_modifier", source: "common/modifiers.cwt", oversized: true },
  {
    type: "scripted_modifier",
    source: "common/scripted_modifiers.cwt",
  },
  { type: "casus_belli", source: "common/casus_belli_and_war_goals.cwt" },
  { type: "war_goal", source: "common/casus_belli_and_war_goals.cwt" },
  { type: "agreement_preset", source: "common/agreements.cwt" },
  {
    type: "bombardment_stance",
    source: "common/bombardment_stances.cwt",
  },
  {
    type: "archaeological_site_type",
    source: "common/archaeology.cwt",
  },
  { type: "situation_type", source: "common/situations.cwt" },
  {
    type: "scripted_loc",
    source: "common/scripted_loc.cwt",
    keyword: "defined_text",
  },
  { type: "councilor", source: "common/governments.cwt" },
  {
    type: "economic_category",
    source: "common/economic_categories.cwt",
  },
  { type: "civic_or_origin", source: "common/governments.cwt" },
  {
    type: "component_set",
    source: "common/components.cwt",
    keyword: "component_set",
  },
  {
    type: "section_template",
    source: "common/section_templates.cwt",
    keyword: "ship_section_template",
  },
  {
    type: "ambient_object",
    source: "common/ambient_objects.cwt",
    keyword: "ambient_object",
  },
  {
    type: "graphical_culture",
    source: "common/graphical_cultures.cwt",
  },
  {
    type: "starbase_level",
    source: "common/starbases_consolidated.cwt",
  },
  { type: "species_class", source: "common/species_consolidated.cwt" },
  {
    type: "country_ship_of_size_limit",
    source: "common/country_limits.cwt",
  },
  {
    type: "solar_system_initializer",
    source: "common/solar_system_initializers.cwt",
  },
  { type: "event_chain", source: "common/event_chains.cwt" },
  {
    type: "special_project",
    source: "common/special_projects.cwt",
    keyword: "special_project",
  },
  { type: "megastructure", source: "common/megastructures.cwt" },
  // The three GFX registries. Each writes `.gfx` rather than `.txt` and sits
  // inside a root envelope its CWT type declares (`spriteTypes`, `objectTypes`),
  // both of which the layout half of the descriptor already carries.
  //
  // `as: "normal"` selects the plain-sprite subtype — the other seven are flag,
  // portrait, progressbar and kin, each a different body — while `name` supplies
  // the spelling the game and every modder use for it. `>2,000 ids` twice over:
  // ~8.5k sprites and ~3.2k meshes both get the trie.
  {
    type: "sprite",
    source: "interface/sprites.cwt",
    name: "spriteType",
    as: "normal",
    keyword: "spriteType",
    // The registry name is the game's camelCase keyword, and a minted id
    // segment must be lowercase snake_case (`assertIdProfile`), so this is the
    // one row where the default segment cannot be the registry name.
    idSegment: "sprite_type",
    oversized: true,
  },
  {
    type: "model_mesh",
    source: "gfx/model_entities.cwt",
    name: "pdxmesh",
    keyword: "pdxmesh",
    oversized: true,
  },
  {
    type: "particle",
    source: "gfx/particles.cwt",
    name: "pdxparticle",
    keyword: "pdxparticle",
  },
] as const satisfies readonly ContentManifestEntry[];

/**
 * Ref-only registries the generated `vanilla.*` namespace (SDK-12) covers
 * beyond `CONTENT_MANIFEST`: CWT `<type>` references with real vanilla-defined
 * ids, but not content types the SDK writes a `defineX` for — the SDK only
 * ever refers to a sound or a planet class, never authors one.
 *
 * `oversized` marks the two-tier editor-perf split: a navigable trie plus a checked-call
 * form instead of a flat literal-union parameter, because these registries'
 * real id counts (~5.9k sound names, ~3.6k deposits) blow out a completion menu
 * the way `resource`'s handful do not.
 */
export interface VanillaRefExtra {
  readonly type: string;
  /** The CWT file that declares the referenced type. */
  readonly source: string;
  /** Top-level install keyword for types whose id lives in a name field. */
  readonly keyword?: string;
  readonly oversized?: true;
}

export const VANILLA_REF_EXTRAS = [
  { type: "sound", source: "sound/sound.cwt", keyword: "sound", oversized: true },
  {
    type: "sound_effect",
    source: "sound/sound.cwt",
    keyword: "soundeffect",
    oversized: true,
  },
  { type: "resource", source: "common/strategic_resources.cwt" },
  { type: "situation_log_category", source: "common/situation_logs.cwt" },
  { type: "star_class", source: "common/star_classes.cwt" },
  { type: "planet_class", source: "common/planet_classes.cwt" },
  { type: "deposit", source: "common/deposits_and_planetary_features.cwt", oversized: true },
  { type: "anomaly_category", source: "common/anomalies.cwt", oversized: true },
  { type: "planet_modifier", source: "common/modifiers.cwt" },
  { type: "asteroid_belt_type", source: "common/asteroid_belts.cwt" },
] as const satisfies readonly VanillaRefExtra[];
