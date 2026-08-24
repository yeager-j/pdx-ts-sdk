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
  return scale === undefined ? 1 : scale / STANDARD_ENTITY_SCALE;
}
