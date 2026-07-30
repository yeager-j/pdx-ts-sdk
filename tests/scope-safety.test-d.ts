import { describe, expectTypeOf, it } from "vitest";

import { Mod } from "../src/mod.ts";
import type { TechnologyDef } from "../src/tech.ts";
import {
  and,
  hasCountryFlag,
  hasGlobalFlag,
  hasPlanetFlag,
  yearsPassed,
  type ScopeName,
  type Trigger,
} from "../src/triggers.ts";

function countrySlot(_t: Trigger<"country">): void {}

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
