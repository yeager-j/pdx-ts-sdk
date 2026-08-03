/**
 * Scopes worked out by hand, from the vanilla bodies and the scopes the CWT
 * rules declare for the primitives in them, BEFORE the analysis was run over
 * them. This is the probe's control: an implementation that agrees with a
 * mechanical hand-application of its own stated rules is doing what it claims.
 *
 * Each entry records the derivation, so a disagreement is adjudicable rather
 * than a matter of which side to trust. Three of these (`is_fallen_empire`,
 * `has_crisis_stage`, `can_colonize_planet_trigger`) were smoke-tested while
 * the plumbing was being wired, and their entries say so — they are weaker
 * evidence than the rest and are kept for the shapes they cover.
 *
 * `"universal"` is not a weak answer here. It is the honest one, and it is
 * exactly today's `Trigger<ScopeName>`.
 */

import type { RuleScopes } from "./scope-tables.ts";

export interface GoldenEntry {
  readonly name: string;
  readonly scopes: RuleScopes;
  /** How the scopes were derived by hand. */
  readonly derivation: string;
}

export const GOLDEN_TRIGGERS: readonly GoldenEntry[] = [
  {
    name: "is_fallen_empire",
    scopes: ["country"],
    derivation:
      "OR of two is_country_type (country). OR unions its arms, both country. " +
      "Smoke-tested during wiring — the ticket's own example.",
  },
  {
    name: "is_regular_empire",
    scopes: ["country"],
    derivation:
      "OR of five is_country_type (country) = country; AND NOT{has_ethic} " +
      "(country, dlc_recommendation, leader, pop_faction, pop_group). " +
      "country ∩ that = country.",
  },
  {
    name: "is_homicidal",
    scopes: ["country"],
    derivation:
      "OR of five has_valid_civic (country) and has_menace_perk (country). " +
      "A body of nothing but one OR, every arm country.",
  },
  {
    name: "is_free_robot",
    scopes: ["country", "leader", "pop_group"],
    derivation:
      "has_trait (country, dlc_recommendation, leader, pop_group, species) ∩ " +
      "`exists = owner` (universal, a scalar value — nothing to descend into) ∩ " +
      "the owner link's input scopes. dlc_recommendation and species are not " +
      "owner inputs, so they drop. The body inside `owner = { ... }` is country " +
      "and contributes nothing. Wider than the comment's 'the pop is a free " +
      "robot' — correctly so, since nothing in the body forbids the others.",
  },
  {
    name: "system_has_dyson_sphere",
    scopes: [
      "ambient_object",
      "archaeological_site",
      "army",
      "astral_rift",
      "bypass",
      "carrier",
      "colony",
      "country",
      "debris",
      "deposit",
      "first_contact",
      "fleet",
      "leader",
      "megastructure",
      "planet",
      "pop_group",
      "ship",
      "starbase",
      "system",
    ],
    derivation:
      "One statement, `solar_system = { ... }`. The link contributes its input " +
      "scopes and everything inside runs in system scope. The name says system; " +
      "the rules say the navigation is legal from nineteen scopes, and the " +
      "analysis says only what the rules say.",
  },
  {
    name: "country_has_habitability_and_housing",
    scopes: ["country"],
    derivation:
      "has_country_flag (country) ∩ any_owned_planet (country, sector). " +
      "The [[HABITABILITY]] and [[HOUSING]] blocks sit inside the pushed planet " +
      "scope and are conditional besides — twice excluded.",
  },
  {
    name: "is_valid_crystal_splitter_system",
    scopes: ["system"],
    derivation:
      "NOR intersects: `exists = starbase` (universal) ∩ is_star_class " +
      "(carrier, planet, ship, system) ∩ has_star_flag (dlc_recommendation, " +
      "system) = system. Then any_system_planet (system). = system.",
  },
  {
    name: "is_lonely_hive_mind_pop",
    scopes: ["country", "dlc_recommendation", "leader", "pop_group", "species"],
    derivation:
      "has_trait's scopes, and nothing else: the OR has an arm reached through " +
      "`from`, which is the caller's scope and therefore unconstraining, and the " +
      "second `from = { ... }` likewise. Union with an unconstrained arm is " +
      "unconstrained — which is why OR must union and not intersect.",
  },
  {
    name: "can_colonize_planet_trigger",
    scopes: ["carrier", "colony", "planet", "ship"],
    derivation:
      "custom_tooltip is transparent (universal, splices at the enclosing " +
      "scope), so has_carrier_flag (carrier, colony, planet, ship) reaches the " +
      "top. `$SCOPE$? = { ... }` is a parameterized key and contributes nothing. " +
      "Smoke-tested during wiring.",
  },
  {
    name: "has_crisis_stage",
    scopes: "universal",
    derivation:
      "has_global_flag is universal. The `$STAGE|1$` substitution is in the " +
      "value, not the key, so the key still reads — and it still says nothing " +
      "about scope. Smoke-tested during wiring.",
  },
];

export const GOLDEN_EFFECTS: readonly GoldenEntry[] = [
  {
    name: "set_merchant_government_effect",
    scopes: ["country"],
    derivation:
      "`if`'s limit clause runs in the enclosing scope, so has_civic (country) " +
      "reaches the top, as do change_government and shift_ethic.",
  },
  {
    name: "achieve_ftl_effect",
    scopes: ["country"],
    derivation:
      "country_event, remove_country_flag, set_country_type, set_origin — all " +
      "country. The capital_scope navigation inside the first `if`'s limit " +
      "contributes its own input scopes, which include country.",
  },
];
