import { describe, expectTypeOf, it } from "vitest";

import type { TechnologyDef } from "../src/generated/technology.ts";
import { defineTechnology } from "../src/index.ts";
import {
  and,
  hasCountryFlag,
  hasGlobalFlag,
  hasPlanetFlag,
  isAtWar,
  overlord,
  owner,
  target,
  yearsPassed,
  type ScopeName,
  type Trigger,
} from "../src/triggers.ts";

function countrySlot(_t: Trigger<"country">): void {}
function planetSlot(_t: Trigger<"planet">): void {}
function situationSlot(_t: Trigger<"situation">): void {}

describe("scope safety", () => {
  it("rejects a planet-scoped trigger where a country trigger is required", () => {
    // @ts-expect-error — has_planet_flag is not valid in country scope
    countrySlot(hasPlanetFlag("ideal_world"));
  });

  it("rejects a planet-scoped trigger in a technology potential", () => {
    const def: TechnologyDef = {
      id: "mymod_tech_x",
      name: "X",
      cost: 100,
      area: "physics",
      tier: 1,
      category: "particles",
      // @ts-expect-error — potential runs in country scope
      potential: hasPlanetFlag("ideal_world"),
    };
    void def;
  });

  it("accepts universal triggers in narrower slots", () => {
    countrySlot(hasGlobalFlag("x"));
    countrySlot(yearsPassed(">=", 10));
    countrySlot(hasCountryFlag("y"));
  });

  it("infers the scope intersection for and()", () => {
    const combined = and(hasCountryFlag("x"), hasGlobalFlag("y"));
    expectTypeOf(combined).toExtend<Trigger<"country">>();
  });

  it("keeps universal triggers universal under combinators", () => {
    const combined = and(hasGlobalFlag("x"), yearsPassed(">", 5));
    expectTypeOf(combined).toExtend<Trigger<ScopeName>>();
  });

  it("accepts a scope link wherever one of its input scopes is required", () => {
    // owner's condition runs in country scope; the result is valid in planet
    // (and 24 other) scopes, so it fits a planet slot by contravariance.
    planetSlot(owner(isAtWar()));
    countrySlot(owner(hasCountryFlag("x")));
  });

  it("rejects a condition outside the link's output scope", () => {
    // @ts-expect-error — owner lands in country scope; has_planet_flag is planet-scoped
    planetSlot(owner(hasPlanetFlag("ideal_world")));
  });

  it("rejects a scope link used outside its input scopes", () => {
    // @ts-expect-error — overlord only navigates from country scope
    planetSlot(overlord(isAtWar()));
  });

  it("checks the asserted target link's condition against the assertion", () => {
    situationSlot(target<"country">(isAtWar()));
    // @ts-expect-error — the author asserted a country target; a planet trigger does not fit
    situationSlot(target<"country">(hasPlanetFlag("x")));
    // @ts-expect-error — target only navigates from situation/spy_network/espionage_operation/agreement
    countrySlot(target<"country">(isAtWar()));
  });

  it("poisons truthiness so triggers cannot be used in a build-time if", () => {
    const t = hasGlobalFlag("x");
    // @ts-expect-error — TS2774: condition is always true; triggers are not booleans
    if (t) {
      void 0;
    }
  });
});

describe("content ids", () => {
  const techDef = {
    name: "X",
    cost: 100,
    area: "physics",
    tier: 1,
    category: "particles",
  } as const;

  it("preserves the id's literal type through the definer", () => {
    const tech = defineTechnology({ ...techDef, id: "mymod_tech_x" });
    expectTypeOf(tech.id).toEqualTypeOf<"mymod_tech_x">();
  });

  it("leaves prefix compliance to the build-time warning", () => {
    // The class API constrained every id to the `mymod_${string}` pattern type
    // its `Mod<P>` generic carried, so an unprefixed id was a compile error.
    // A definer knows no prefix — the mod config is only read at `buildMod` —
    // so the same ids type-check here and surface as a `missing-prefix`
    // warning on the built value instead (tests/pure-api.test.ts pins it).
    const foreign = defineTechnology({ ...techDef, id: "othermod_tech_x" });
    expectTypeOf(foreign.id).toEqualTypeOf<"othermod_tech_x">();
    const bare = defineTechnology({ ...techDef, id: "mymod" });
    expectTypeOf(bare.id).toEqualTypeOf<"mymod">();
  });
});
