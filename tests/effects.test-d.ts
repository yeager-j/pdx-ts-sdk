/**
 * Scope safety over the GENERATED effect interfaces — the same claims the
 * probe pinned against its hand-written samples, now held against the real
 * emitted surface.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import { describe, it } from "vitest";

import { eventTarget, makeScope } from "../src/effect-core.ts";
import { planetFlags } from "../src/generated/value-sets.ts";
import { isAtWar } from "../src/triggers.ts";

const sink: PdxEntry[] = [];
const flags = planetFlags("effects_type_test_flag");

describe("generated effect scope safety", () => {
  it("rejects an effect outside its declared scopes", () => {
    const country = makeScope<"country">(sink);
    // @ts-expect-error — destroy_colony is declared for colony/planet/ship/carrier, not country
    country.destroyColony();
  });

  it("rejects a wrong-scope trigger in an iterator's limit", () => {
    const country = makeScope<"country">(sink);
    // @ts-expect-error — isAtWar is country-scoped; every_owned_planet's limit runs in planet scope
    country.everyOwnedPlanet({ limit: isAtWar() }, () => {});
  });

  it("rejects saving a target under the wrong declared scope", () => {
    const target = eventTarget<"country">("wrong_scope_target");
    const country = makeScope<"country">(sink);
    country.everyOwnedPlanet({}, (planet) => {
      // @ts-expect-error — the target was declared as a country target; this save site is a planet
      planet.saveEventTargetAs(target);
    });
  });

  it("rejects a flag from another value set", () => {
    const country = makeScope<"country">(sink);
    // @ts-expect-error — set_country_flag takes a CountryFlag, not a PlanetFlag
    country.setCountryFlag(flags.effects_type_test_flag);
  });

  it("types the pushed scope of a generated iterator", () => {
    const country = makeScope<"country">(sink);
    country.everyOwnedPlanet({}, (planet) => {
      planet.destroyColony();
    });
  });
});
