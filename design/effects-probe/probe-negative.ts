/**
 * The negative half of the probe: one `@ts-expect-error` per safety claim.
 * If any annotation stops firing, `npm run typecheck` fails — the claims are
 * pinned, not assumed. Nothing here runs; every case is wrapped in a function
 * that is never called, so the file is inert at runtime.
 *
 * Each case was also checked by hand for the QUALITY of the error message a
 * modder would see with the annotation removed; findings are recorded in the
 * probe verdict.
 */

import { countryFlags, planetFlags } from "../../src/generated/value-sets.ts";
import { hasCountryFlag, isAtWar } from "../../src/triggers.ts";
import { eventTarget } from "./effect-core.ts";
import { defineCountryEvent, definePlanetEvent } from "./events-sample.ts";
import { aftershock } from "./probe.ts";

const NS = "hello_probe_negative";

const countryTarget = eventTarget<"country">("neg_country_target");
const planetFlag = planetFlags("neg_planet_flag");
const countryFlag = countryFlags("neg_country_flag");

/** Claim 1: a planet effect does not exist on CountryScope. */
export function wrongScopeEffect(): void {
  defineCountryEvent(NS, {
    id: 10,
    immediate: (country) => {
      // @ts-expect-error — addDeposit is a planet effect; CountryScope has no such method
      country.addDeposit("d_minerals_1");
    },
  });
}

/** Claim 2: an iterator's `limit` rejects a trigger from the wrong scope. */
export function wrongScopeLimit(): void {
  defineCountryEvent(NS, {
    id: 11,
    immediate: (country) => {
      // @ts-expect-error — isAtWar is country-scoped; every_owned_planet's limit runs in planet scope
      country.everyOwnedPlanet({ limit: isAtWar() }, () => {});
    },
  });
}

/** Claim 3: trigger truthiness is poisoned — `if (someTrigger)` cannot compile. */
export function triggerTruthiness(): void {
  const condition = hasCountryFlag(countryFlag.neg_country_flag);
  // @ts-expect-error — a trigger is an in-game condition, not a build-time boolean
  if (condition) {
    return;
  }
}

/** Claim 4: saving a target under the wrong declared scope is rejected. */
export function wrongScopeTargetSave(): void {
  defineCountryEvent(NS, {
    id: 12,
    immediate: (country) => {
      country.everyOwnedPlanet({}, (planet) => {
        // @ts-expect-error — the target was declared as a country target; this save site is a planet
        planet.saveEventTargetAs(countryTarget);
      });
    },
  });
}

/** Claim 5: firing an event that declared `from:` requires a matching witness. */
export function fromContractUnwitnessed(): void {
  definePlanetEvent(NS, {
    id: 13,
    immediate: (planet) => {
      // @ts-expect-error — aftershock declared from: "country"; firing it needs a country FROM witness
      planet.planetEvent({ id: aftershock, days: 5 });
    },
  });
}

/** Claim 5b: a witness of the wrong scope does not satisfy the contract. */
export function fromContractWrongWitness(): void {
  definePlanetEvent(NS, {
    id: 14,
    immediate: (planet, ctx) => {
      // @ts-expect-error — ctx.self is a planet ref; aftershock's FROM contract wants a country
      planet.planetEvent({ id: aftershock, from: ctx.self, days: 5 });
    },
  });
}

/** Claim 6: value sets stay distinct — a planet flag is not a country flag. */
export function wrongFlagKind(): void {
  defineCountryEvent(NS, {
    id: 15,
    immediate: (country) => {
      // @ts-expect-error — set_country_flag takes a CountryFlag, not a PlanetFlag
      country.setCountryFlag(planetFlag.neg_planet_flag);
    },
  });
}

/** Claim 7: an undeclared FROM is unusable, not silently any-typed. */
export function undeclaredFrom(): void {
  defineCountryEvent(NS, {
    id: 16,
    immediate: (country, ctx) => {
      // @ts-expect-error — this event declared no `from:`; ctx.from is an inert sentinel, not a ScopeRef
      country.within(ctx.from, () => {});
    },
  });
}
