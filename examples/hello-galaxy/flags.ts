import { countryFlags } from "@pdx-ts/sdk";

/**
 * Flags this mod sets and reads.
 *
 * Declaring them buys autocomplete and, because each value set is branded, a
 * planet flag passed to `hasCountryFlag` is a compile error.
 *
 * This module lives *outside* `content/`, because everything a discovered
 * module exports is registered — so shared values that are not definitions
 * live beside the content directory rather than in it. The content modules
 * import this one; importing a value is not exporting it.
 */
export const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");
