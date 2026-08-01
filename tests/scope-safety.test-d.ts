import { describe, expectTypeOf, it } from "vitest";

import type { TechnologyDef } from "../src/generated/technology.ts";
import { Mod } from "../src/mod.ts";
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

describe("prefix enforcement", () => {
  const techDef = {
    name: "X",
    cost: 100,
    area: "physics",
    tier: 1,
    category: "particles",
  } as const;

  it("infers the prefix as a literal type from the config", () => {
    const mod = new Mod({ name: "M", prefix: "mymod", supportedVersion: "4.0.*" });
    expectTypeOf(mod).toExtend<Mod<"mymod">>();
  });

  it("rejects technology ids that do not start with the mod prefix", () => {
    const mod = new Mod({ name: "M", prefix: "mymod", supportedVersion: "4.0.*" });
    // @ts-expect-error — id must match `mymod_${string}`
    mod.defineTechnology({ ...techDef, id: "othermod_tech_x" });
    // @ts-expect-error — the bare prefix without the underscore separator is not enough
    mod.defineTechnology({ ...techDef, id: "mymod" });
  });

  it("accepts technology ids carrying the mod prefix", () => {
    const mod = new Mod({ name: "M", prefix: "mymod", supportedVersion: "4.0.*" });
    mod.defineTechnology({ ...techDef, id: "mymod_tech_x" });
  });
});
