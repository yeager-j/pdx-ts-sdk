/**
 * The probe's vanilla input: a hand-written structural clone of
 * `tech_gene_tailoring` (`common/technology/00_soc_tech.txt`), the nastiest
 * realistic technology in the install. Every construct is replicated
 * shape-for-shape — cross-file scripted variables, a file-local variable used
 * inside `description_parameters`, `gateway`, a `feature_flags` list,
 * `technology_swap` with a nested trigger, `potential` with `OR`, a
 * `weight_modifier` with an inline comment and six nested `modifier` blocks,
 * `ai_weight` — under different names, because the repo cannot ship
 * Paradox's text. Formatting is vanilla's: tabs, blank lines, comments.
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
