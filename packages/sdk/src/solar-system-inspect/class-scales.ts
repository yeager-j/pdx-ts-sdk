/**
 * Per-class render scale factors from the installed game's
 * `common/planet_classes` (`entity_scale`), pinned to Stellaris Pegasus
 * 4.4.6. The install-gated calibration suite verifies this table against the
 * game files, so a game update that moves a scale fails a test instead of
 * silently drifting.
 *
 * A body's rendered size is roughly its gameplay `size` scaled by the
 * class's `entity_scale`; classes not listed here use the standard scale.
 */

/** `@planet_standard_scale`: the entity scale ordinary planets use. */
export const STANDARD_ENTITY_SCALE = 11;

/** `entity_scale` for every vanilla class that departs from the standard. */
export const CLASS_ENTITY_SCALES: Readonly<Record<string, number>> = {
  pc_a_star: 20,
  pc_asteroid: 1.5,
  pc_astral_scar: 1,
  pc_b_star: 20,
  pc_black_hole: 20,
  pc_cosmogenesis_world: 1,
  pc_crystal_asteroid: 14,
  pc_crystal_habitat: 1,
  pc_cutholoid: 1.5,
  pc_cybrex: 1,
  pc_f_star: 20,
  pc_g_star: 20,
  pc_gas_giant: 14,
  pc_habitat: 1,
  pc_habitat_shielded: 1,
  pc_ice_asteroid: 1.5,
  pc_junk: 1,
  pc_k_star: 20,
  pc_m_giant_star: 20,
  pc_m_star: 20,
  pc_neutron_star: 20,
  pc_protostar: 15,
  pc_pulsar: 20,
  pc_rare_crystal_asteroid: 1.5,
  pc_rift_star: 6,
  pc_ringworld_habitable: 1,
  pc_ringworld_habitable_damaged: 1,
  pc_ringworld_seam: 1,
  pc_ringworld_seam_damaged: 1,
  pc_ringworld_shielded: 1,
  pc_ringworld_tech: 1,
  pc_ringworld_tech_damaged: 1,
  pc_shattered_ring_habitable: 1,
  pc_t_star: 30,
  pc_toxoid_star: 20,
  pc_warden_guardian: 1,
};

/**
 * Classes whose render size ignores gameplay `size`
 * (`fixed_entity_scale = yes`).
 */
export const FIXED_SCALE_CLASSES: ReadonlySet<string> = new Set([
  "pc_cosmogenesis_world",
  "pc_crystal_habitat",
  "pc_cybrex",
  "pc_habitat",
  "pc_habitat_shielded",
  "pc_ringworld_habitable",
  "pc_ringworld_habitable_damaged",
  "pc_ringworld_seam",
  "pc_ringworld_seam_damaged",
  "pc_ringworld_shielded",
  "pc_ringworld_tech",
  "pc_ringworld_tech_damaged",
  "pc_shattered_ring_habitable",
  "pc_warden_guardian",
]);

/**
 * The system view rescales planet sprites per camera zoom step
 * (`PLANET_SCALE_SYSTEM` in the defines, 0.325 to 0.75). Star entities keep
 * their size, so the model pins the zoomed-out step where whole-system
 * comparisons happen.
 */
export const SYSTEM_VIEW_PLANET_SCALE = 0.75;

/** Extra render scale the game applies to moons (`MOON_SCALE` define). */
export const MOON_RENDER_SCALE = 0.7;

/**
 * Classes rendered as stellar objects: they use star-kind styling and are
 * exempt from the per-zoom planet rescale.
 */
export const STAR_CLASSES: ReadonlySet<string> = new Set([
  "pc_a_star",
  "pc_b_star",
  "pc_black_hole",
  "pc_f_star",
  "pc_g_star",
  "pc_k_star",
  "pc_m_giant_star",
  "pc_m_star",
  "pc_neutron_star",
  "pc_protostar",
  "pc_pulsar",
  "pc_rift_star",
  "pc_t_star",
  "pc_toxoid_star",
]);

/**
 * Screenshot-measured render corrections for entities whose visual size the
 * text files do not capture. The black hole's accretion visuals render well
 * beyond its `entity_scale`; measured from a live trinary overlay.
 */
export const RENDER_CORRECTIONS: Readonly<Record<string, number>> = {
  pc_black_hole: 1.3,
};

/**
 * The planet class behind each `class: "star"` entry, per system star class
 * and star position: binaries and trinaries list one `planet = { key }` per
 * star, in order, in `common/star_classes`. The n-th star entry of a system
 * is assumed to take the n-th key.
 */
export const STAR_CLASS_PLANET_CLASSES: Readonly<Record<string, readonly string[]>> = {
  sc_a: ["pc_a_star"],
  sc_b: ["pc_b_star"],
  sc_binary_1: ["pc_a_star", "pc_pulsar"],
  sc_binary_10: ["pc_a_star", "pc_t_star"],
  sc_binary_2: ["pc_b_star", "pc_neutron_star"],
  sc_binary_3: ["pc_m_giant_star", "pc_b_star"],
  sc_binary_4: ["pc_m_giant_star", "pc_f_star"],
  sc_binary_5: ["pc_b_star", "pc_b_star"],
  sc_binary_6: ["pc_m_star", "pc_g_star"],
  sc_binary_7: ["pc_k_star", "pc_f_star"],
  sc_binary_8: ["pc_g_star", "pc_f_star"],
  sc_binary_9: ["pc_a_star", "pc_f_star"],
  sc_black_hole: ["pc_black_hole"],
  sc_crisis_binary_1: ["pc_m_giant_star", "pc_pulsar"],
  sc_crisis_binary_10: ["pc_m_star", "pc_t_star"],
  sc_crisis_binary_2: ["pc_m_giant_star", "pc_neutron_star"],
  sc_crisis_binary_5: ["pc_m_star", "pc_b_star"],
  sc_crisis_binary_7_8_9: ["pc_m_star", "pc_f_star"],
  sc_crisis_trinary_1: ["pc_m_star", "pc_m_star", "pc_k_star"],
  sc_crisis_trinary_2: ["pc_m_giant_star", "pc_a_star", "pc_f_star"],
  sc_crisis_trinary_3: ["pc_m_star", "pc_f_star", "pc_g_star"],
  sc_crisis_trinary_4: ["pc_m_giant_star", "pc_k_star", "pc_t_star"],
  sc_f: ["pc_f_star"],
  sc_g: ["pc_g_star"],
  sc_k: ["pc_k_star"],
  sc_m: ["pc_m_star"],
  sc_m_giant: ["pc_m_giant_star"],
  sc_neutron_star: ["pc_neutron_star"],
  sc_pulsar: ["pc_pulsar"],
  sc_rift_star: ["pc_rift_star"],
  sc_t: ["pc_t_star"],
  sc_toxoid_star: ["pc_toxoid_star"],
  sc_trinary_1: ["pc_g_star", "pc_m_star", "pc_k_star"],
  sc_trinary_2: ["pc_b_star", "pc_a_star", "pc_f_star"],
  sc_trinary_3: ["pc_k_star", "pc_f_star", "pc_g_star"],
  sc_trinary_4: ["pc_b_star", "pc_k_star", "pc_t_star"],
};

/** Every main-sequence `pc_*_star` shares this scale. */
const STAR_ENTITY_SCALE = 20;

/**
 * The class's render scale relative to a standard planet. A `class: "star"`
 * entry resolves to the system's star class, and every ordinary star class
 * scales at 20.
 */
export function classScaleFactor(className: string | undefined): number {
  if (className === undefined) {
    return 1;
  }
  if (className === "star") {
    return STAR_ENTITY_SCALE / STANDARD_ENTITY_SCALE;
  }
  const scale = CLASS_ENTITY_SCALES[className];
  const correction = RENDER_CORRECTIONS[className] ?? 1;
  return (scale === undefined ? 1 : scale / STANDARD_ENTITY_SCALE) * correction;
}

/**
 * The render scale for the n-th `class: "star"` entry of a system, resolved
 * through the system's star class. Unknown or random-list star classes use
 * the ordinary star scale.
 */
export function starEntryScaleFactor(starClass: string, starIndex: number): number {
  const keys = STAR_CLASS_PLANET_CLASSES[starClass];
  if (keys === undefined || keys.length === 0) {
    return STAR_ENTITY_SCALE / STANDARD_ENTITY_SCALE;
  }
  const planetClass = keys[Math.min(starIndex, keys.length - 1)]!;
  return classScaleFactor(planetClass);
}
