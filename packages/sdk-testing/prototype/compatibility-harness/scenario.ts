import type { Locator, Script } from "./contract.ts";

/** Fixed experiment inputs; amendments require a reason and reruns of earlier adapters. */
export const scripts: Readonly<Record<string, Script>> = {
  mark: { scope: "country", kind: "effect", body: "set_country_flag = sdk446_effect" },
  marked: { scope: "country", kind: "condition", body: "has_country_flag = sdk446_effect" },
  human: { scope: "country", kind: "condition", body: "is_ai = no" },
  colony: { scope: "planet", kind: "condition", body: "is_colony = yes" },
  uncolonized: { scope: "planet", kind: "condition", body: "is_colony = no" },
  missing: { scope: "country", kind: "condition", body: "has_country_flag = sdk446_absent" },
  duplicate: { scope: "planet", kind: "condition", body: "has_planet_flag = sdk446_duplicate" },
  removeCountry: { scope: "country", kind: "effect", body: "destroy_country = yes" },
  removePlanet: { scope: "planet", kind: "effect", body: "remove_planet = yes" },
  replaceCountry: {
    scope: "country",
    kind: "effect",
    body: "create_country = { type = global_event effect = { save_global_event_target_as = sdk446_country } }",
  },
  replacePlanet: {
    scope: "planet",
    kind: "effect",
    body: "solar_system = { spawn_planet = { class = pc_barren size = 10 orbit_distance = 20 init_effect = { save_global_event_target_as = sdk446_planet } } }",
  },
};
/** Recipes used identically on every adapter. Fixture targets must exist before launch returns. */
export const locators = {
  player: { kind: "player", scope: "country" },
  colony: { kind: "target", scope: "planet", name: "sdk446_colony" },
  planet: { kind: "target", scope: "planet", name: "sdk446_planet" },
  country: { kind: "target", scope: "country", name: "sdk446_country" },
  missing: { kind: "unique", scope: "country", condition: "missing" },
  wrongKind: { kind: "target", scope: "country", name: "sdk446_colony" },
  duplicate: { kind: "unique", scope: "planet", condition: "duplicate" },
} as const satisfies Record<string, Locator>;
/** Deliberate time changes, including the bounded removal window. */
export const days = { advance: 3, removal: 1, removalLimit: 10 } as const;
