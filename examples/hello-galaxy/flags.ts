import { countryFlags } from "@pdx-ts/sdk";

/**
 * Flags this mod sets and reads.
 *
 * Declaring them buys autocomplete and, because each value set is branded, a
 * planet flag passed to `hasCountryFlag` is a compile error.
 *
 * This module lives *outside* `content/` for cohesion. Discovered feature
 * modules may expose ordinary reusable exports, but only their named `feature`
 * export controls placement.
 */
export const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");
