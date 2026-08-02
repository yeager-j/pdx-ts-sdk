/**
 * Test vanilla input for the promoted surface. `TECH_FILE`/`VARS_FILE` are
 * copied from `design/parser-probe/fixture.ts` (the design record stays
 * frozen): a hand-written structural clone of `tech_gene_tailoring`, the
 * nastiest realistic technology in the install. `OR_TECH_FILE` adds the
 * construct the probe's parser had to refuse — `prerequisites = { ref OR =
 * { ... } }`, the mixed container five vanilla files use — which the
 * package AST carries as ordinary data.
 */

export const TECH_FILE = `# ##################
# Gene Forging
# ##################

@tech_gene_forging_POINTS = 2

tech_gene_forging = {
	cost = @t3cost
	area = society
	tier = 3
	category = { biology }
	prerequisites = { "tech_helix_mapping" }
	weight = @t3weight

	gateway = biological

	modifier = {
		description = tech_gene_forging_modifier_desc
		description_parameters = {
			POINTS = @tech_gene_forging_POINTS
		}
		BIOLOGICAL_species_trait_points_add = @tech_gene_forging_POINTS
	}

	feature_flags = {
		modify_traits
		pop_self_modification
	}

	technology_swap = {
		name = tech_gene_forging_overtuned
		inherit_icon = yes
		inherit_effects = no

		trigger = {
			has_origin = origin_overtuned
		}
	}

	potential = {
		OR = {
			is_machine_empire = no
			has_civic = civic_machine_assimilator
			has_civic = civic_machine_servitor
		}
		is_natural_design_empire = no
	}

	weight_modifier = {
		factor = 2.0	# genetech needs to be a bit more common
		modifier = {
			factor = 1.25
			is_hive_empire = yes
		}
		modifier = {
			factor = 1.25
			is_xenophile = yes
		}
		modifier = {
			factor = 1.25
			has_origin = origin_necrophage
			has_trait = trait_necrophage
		}
		modifier = {
			factor = 2
			has_relic = r_pox_sample
		}
		modifier = {
			factor = 0
			is_individual_machine = yes
			NOT = {
				any_owned_species = {
					is_organic_species = yes
				}
			}
		}
		modifier = {
			factor = @pp_boost
			has_ascension_perk = ap_engineered_evolution
		}
	}

	ai_weight = {
		modifier = {
			factor = 2
			has_origin = origin_necrophage
			has_trait = trait_necrophage
		}
		modifier = {
			factor = @pp_boost
			has_ascension_perk = ap_engineered_evolution
		}
	}
}
`;

/** Shaped like `common/scripted_variables/00_scripted_variables.txt`. */
export const VARS_FILE = `# Parser-probe scripted variables.

@t3cost = 4000
@t3weight = 65
@pp_boost = 10
`;

/**
 * Shaped like the OR-prerequisites in `00_eng_weapon_tech.txt`
 * (`prerequisites = { tech_stingers OR = { ... } }`).
 */
export const OR_TECH_FILE = `tech_pp_missiles_2 = {
	cost = 100
	area = engineering
	tier = 1
	category = { propulsion }
	prerequisites = { tech_pp_missiles_1 OR = { tech_pp_lasers_1 tech_pp_mass_drivers_1 } }
}
`;
