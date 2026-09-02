/**
 * The content registries the SDK deliberately exposes.
 *
 * This is an allowlist, not filesystem discovery: adding a registry is a
 * public-interface decision and must bring reviewed field overlays and
 * goldens with it.
 */

import type { ContentType } from "../cwt/rules.ts";

/**
 * One content registry selected for SDK generation.
 * The row identifies its CWT source and any deliberate registry naming or layout policy.
 */
export interface ContentManifestEntry {
  /** The CWT `type[...]` declaration that defines the registry. */
  readonly type: string;
  /** Path, relative to the vendored CWT config root, of the file that declares the type. */
  readonly source: string;
  /**
   * Segment inserted between the mod prefix and a logical definition name.
   * Omit it when the registry name is already the established id segment.
   */
  readonly idSegment?: string;
  /**
   * Literal top-level definition key when the id lives in a body field.
   * It is explicit because CWT does not consistently declare a reliable type-key filter.
   * Any positive filter that CWT does declare must match this key.
   */
  readonly keyword?: string;
  /**
   * CWT subtype used when one type backs several distinct SDK registries.
   * It must name a declared subtype so generated definitions satisfy the matching reference brand.
   */
  readonly as?: string;
  /**
   * SDK registry name override when the game's established name differs from the CWT type name.
   * It renames generated symbols and files without selecting a subtype or changing references.
   * The name must be a distinct, unique identifier stem; resolve it through {@link registryNameOf}.
   */
  readonly name?: string;
  /**
   * Uses a navigable trie and checked-call form for a registry too large for a flat completion union.
   * Trie layout remains the responsibility of the install-derived vanilla generator.
   */
  readonly oversized?: true;
}

/**
 * Resolves the canonical generated registry name used by every manifest consumer.
 * An explicit name overrides the subtype name, which overrides the CWT type name.
 */
export function registryNameOf(entry: ContentManifestEntry): string {
  return entry.name ?? entry.as ?? entry.type;
}

/**
 * The complete allowlist of content registries exposed through SDK authoring.
 * Each row selects one reviewed CWT type or subtype for generation.
 */
export const CONTENT_MANIFEST = [
  { type: "technology", source: "common/technologies_consolidated.cwt", idSegment: "tech" },
  { type: "building", source: "common/buildings.cwt" },
  { type: "tradition", source: "common/traditions.cwt" },
  { type: "tradition_category", source: "common/traditions.cwt" },
  { type: "ascension_perk", source: "common/ascension_perks.cwt" },
  {
    type: "ascension_perk_category",
    source: "common/ascension_perk_categories.cwt",
  },
  { type: "resource", source: "common/strategic_resources.cwt" },
  { type: "crisis_path", source: "common/crisis_paths.cwt" },
  { type: "crisis_level", source: "common/crisis.cwt" },
  { type: "crisis_objective", source: "common/crisis.cwt" },
  { type: "menace_perk", source: "common/crisis.cwt" },
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
  { type: "relic", source: "common/archaeology.cwt" },
  { type: "mission", source: "common/missions.cwt" },
  { type: "mission_category", source: "common/missions.cwt" },
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
    // No `idSegment`: all three GFX registries carry a `MINT_SHAPE_OVERLAYS`
    // row instead, which is what says they have no segment to override.
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

/** A vanilla reference registry exposed by the SDK but not available as authored content. */
export interface VanillaRefExtra {
  /** The CWT reference type exposed in the generated `vanilla.*` namespace. */
  readonly type: string;
  /** Path, relative to the vendored CWT config root, of the declaring file. */
  readonly source: string;
  /** Top-level install keyword for types whose id lives in a name field. */
  readonly keyword?: string;
  /** Uses a navigable trie because a flat completion union is too large for editors. */
  readonly oversized?: true;
}

/** Reference-only vanilla registries that have no SDK content-definition capability. */
export const VANILLA_REF_EXTRAS = [
  { type: "sound", source: "sound/sound.cwt", keyword: "sound", oversized: true },
  {
    type: "sound_effect",
    source: "sound/sound.cwt",
    keyword: "soundeffect",
    oversized: true,
  },
  { type: "situation_log_category", source: "common/situation_logs.cwt" },
  { type: "star_class", source: "common/star_classes.cwt" },
  { type: "planet_class", source: "common/planet_classes.cwt" },
  { type: "deposit", source: "common/deposits_and_planetary_features.cwt", oversized: true },
  { type: "anomaly_category", source: "common/anomalies.cwt", oversized: true },
  { type: "planet_modifier", source: "common/modifiers.cwt" },
  { type: "asteroid_belt_type", source: "common/asteroid_belts.cwt" },
  { type: "country_type", source: "common/country_types.cwt" },
] as const satisfies readonly VanillaRefExtra[];

const REGISTRY_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Validates a resolved registry name and records it for duplicate detection.
 * It rejects illegal identifier stems, redundant explicit names, and names already in `seen`.
 */
export function assertAndRecordRegistryName(
  entry: ContentManifestEntry,
  registry: string,
  seen: Set<string>
): void {
  if (!REGISTRY_NAME.test(registry)) {
    throw new Error(
      `The manifest resolves type[${entry.type}] to registry name "${registry}", which is not ` +
        "a legal identifier stem"
    );
  }
  if (entry.name !== undefined && entry.name === (entry.as ?? entry.type)) {
    throw new Error(
      `The manifest's name "${entry.name}" for type[${entry.type}] is what the row already ` +
        "resolves to, so the rename says nothing — drop it"
    );
  }
  if (seen.has(registry)) {
    throw new Error(
      `Two manifest rows resolve to the registry name "${registry}", so they would generate ` +
        "over each other"
    );
  }
  seen.add(registry);
}

/**
 * Resolves the positive CWT key filter that constrains a manifest keyword.
 * The type-level filter takes precedence over the selected subtype; absent and negated filters
 * impose no positive keyword constraint and return `null`.
 */
export function effectiveKeyFilter(
  type: ContentType,
  subtypeName: string | undefined
): {
  /** Positive top-level definition key required by the filter. */
  readonly key: string;
  /** CWT declaration that supplied the filter, for validation diagnostics. */
  readonly source: string;
} | null {
  if (type.keyFilter !== null) {
    return type.keyFilter.negated
      ? null
      : { key: type.keyFilter.key, source: `type[${type.name}]` };
  }
  if (subtypeName === undefined) {
    return null;
  }
  const subtype = type.subtypes.find((candidate) => candidate.name === subtypeName);
  if (subtype?.keyFilter == null || subtype.keyFilter.negated) {
    return null;
  }
  return {
    key: subtype.keyFilter.key,
    source: `type[${type.name}] subtype[${subtypeName}]`,
  };
}
