/**
 * Test vanilla input for the typed surface. `TECH_FILE`/`VARS_FILE` are a
 * hand-written structural clone of `tech_gene_tailoring`, the
 * nastiest realistic technology in the install. `OR_TECH_FILE` adds the
 * construct the probe's parser had to refuse — `prerequisites = { ref OR =
 * { ... } }`, the mixed container five vanilla files use — which the
 * package AST carries as ordinary data.
 *
 * `BUILDING_FILE` is the second registry's equivalent: a structural clone of
 * the shapes vanilla buildings actually write that the technology fixture has
 * no example of — repeated `triggered_planet_modifier` blocks, a `planet_limit`
 * written as a bare number in one building and as a block in the other (CWT
 * declares both, so the field lowers to a dual), plus a file-local `@variable`,
 * `prerequisites` and `upgrades`.
 *
 * `MEGASTRUCTURE_FILE` is the third, and it is here for the shapes the first
 * two have no example of: an `economic_template` block (`resources`, with
 * repeated `cost` arms and an `upkeep`), a nested `struct` written inline
 * (`entity_offset`), an upgrade chain through `upgrade_from`, repeated
 * `triggered_country_modifier` blocks written the way vanilla writes them
 * (bare modifier names, no `modifier = { ... }` wrapper), and
 * `placement_rules` — a field the emitter declines (SDK-84), so a patch has to
 * carry it through untouched or lose it.
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

/** Shaped like `common/buildings/04_pop_assembly_buildings.txt`. */
export const BUILDING_FILE = `# ##################
# Refinery
# ##################

@pp_refinery_buildtime = 480

building_pp_refinery = {
	base_buildtime = @pp_refinery_buildtime
	category = manufacturing
	icon = building_pp_refinery

	potential = {
		exists = owner
		has_upgraded_capital = yes
	}

	allow = {
		has_major_upgraded_capital = yes
	}

	prerequisites = { "tech_gene_forging" }
	upgrades = { building_pp_refinery_2 }

	planet_limit = 1

	triggered_planet_modifier = {
		potential = {
			exists = owner
		}
		modifier = {
			planet_jobs_produces_mult = 0.1
		}
	}

	triggered_planet_modifier = {
		potential = {
			has_modifier = pp_storm_touched
		}
		modifier = {
			planet_jobs_upkeep_mult = -0.05
		}
	}

	ai_weight = {
		weight = 5
	}
}

building_pp_refinery_2 = {
	base_buildtime = @pp_refinery_buildtime
	category = manufacturing
	icon = building_pp_refinery_2

	building_sets = { pp_refinery_set }
	prerequisites = { "tech_gene_forging" }

	planet_limit = {
		base = 1
		modifier = {
			add = 1
			has_ascension_perk = ap_engineered_evolution
		}
	}

	triggered_planet_modifier = {
		potential = {
			always = yes
		}
		modifier = {
			planet_jobs_produces_mult = 0.2
		}
	}
}
`;

/** Shaped like `common/megastructures/03_think_tank.txt` and `22_shroud_seal.txt`. */
export const MEGASTRUCTURE_FILE = `# ##################
# Resonance Array
# ##################

@pp_array_buildtime = 1800
@pp_array_offset_y = -20

megastructure_pp_array_0 = {
	entity = "pp_array_construction_entity"
	construction_entity = "pp_array_construction_entity"
	portrait = "GFX_megastructure_construction_background"
	place_entity_on_planet_plane = no
	entity_offset = { x = 0 y = @pp_array_offset_y }
	build_time = @pp_array_buildtime

	resources = {
		category = megastructures
		cost = {
			unity = 5000
		}
		cost = {
			trigger = {
				country_uses_bio_ships = yes
			}
			alloys = 5000
			mult = 0.5
		}

		upkeep = {
			energy = 5
		}
	}

	custom_tooltip_requirements = "MEGASTRUCTURE_TOOLTIP_REQUIREMENTS_ONE_PER_COUNTRY"
	prerequisites = { "tech_pp_resonance" }

	potential = {
		has_technology = tech_pp_resonance
	}

	possible = {
		hidden_trigger = {
			exists = starbase
		}
		custom_tooltip = {
			fail_text = "requires_inside_border"
			is_inside_border = from
		}
	}

	placement_rules = {
		planet_possible = {
			NOT = {
				is_planet_class = pc_gas_giant
			}
		}
	}

	ai_weight = {
		weight = @pp_boost
	}
}

megastructure_pp_array_1 = {
	entity = "pp_array_entity"
	construction_entity = "pp_array_construction_entity"
	portrait = "GFX_megastructure_pp_array_background"
	place_entity_on_planet_plane = no
	build_time = @pp_array_buildtime
	upgrade_from = { megastructure_pp_array_0 }

	resources = {
		category = megastructures
		cost = {
			unity = 10000
		}

		upkeep = {
			energy = 10
		}
	}

	triggered_country_modifier = {
		potential = {
			owner? = {
				has_technology = tech_pp_resonance
			}
		}
		country_naval_cap_add = 10
	}

	triggered_country_modifier = {
		potential = {
			always = yes
		}
		all_technology_research_speed = 0.05
	}

	ai_weight = {
		weight = 5
		modifier = {
			factor = 2
			from = {
				has_ascension_perk = ap_galactic_wonders
			}
		}
	}
}
`;
