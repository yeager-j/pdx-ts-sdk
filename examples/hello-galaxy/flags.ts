import { countryFlags } from "@pdx-ts/sdk/stellaris";

/**
 * Flags this mod sets and reads.
 *
 * Declaring them buys autocomplete and, because each value set is branded, a
 * planet flag passed to `hasCountryFlag` is a compile error.
 *
 * This module lives *outside* `features/` for cohesion. A feature module may
 * expose ordinary reusable exports too, but only its `feature` export, through
 * its line in `features.ts`, controls placement.
 */
export const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");
