import type { PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expectTypeOf, it } from "vitest";

import type { TechnologyDef } from "../src/generated/technology.ts";
import { defineTechnology, makeScope, scriptedEffect, scriptedTrigger } from "../src/index.ts";
import {
  and,
  hasCountryFlag,
  hasGlobalFlag,
  hasPlanetFlag,
  hiddenTrigger,
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
function neverSlot(_t: Trigger<never>): void {}

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

  it("ergonomics: a.and(b) is a method now, not a compile error", () => {
    // SDK-53: `Trigger` had no methods, so `someTrigger.and(other)` used to
    // fail with "Property 'and' does not exist on type 'Trigger<...>'" —
    // the friction was a type error, not a runtime one.
    const combined = hasCountryFlag("x").and(hasGlobalFlag("y"));
    expectTypeOf(combined).toExtend<Trigger<"country">>();
    countrySlot(hasCountryFlag("x").and(hasGlobalFlag("y")));
    // @ts-expect-error — has_planet_flag is not valid in country scope; the fluent form is checked the same as and()
    countrySlot(hasCountryFlag("x").and(hasPlanetFlag("y")));
  });

  it("ergonomics: .and() infers the combined scope from every operand, not just the receiver", () => {
    // A first version bound `.and()`'s type parameter to `Trigger`'s own S,
    // fixed by whatever the receiver happened to be instantiated at — so
    // `hasGlobalFlag("x").and(hasCountryFlag("y"))` (a universal receiver,
    // a country-scoped operand) rejected a conjunction the free and() built
    // fine, purely because of argument order. `.and()` now declares its own
    // method type parameter, inferred from `this` and every operand
    // together, the same simultaneous inference and() itself uses.
    const wideFirst = hasGlobalFlag("x").and(hasCountryFlag("y"));
    const narrowFirst = hasCountryFlag("y").and(hasGlobalFlag("x"));
    const free = and(hasGlobalFlag("x"), hasCountryFlag("y"));
    expectTypeOf(wideFirst).toEqualTypeOf(free);
    expectTypeOf(narrowFirst).toEqualTypeOf(free);
    countrySlot(wideFirst);
    countrySlot(narrowFirst);
  });

  it("ergonomics: .and() still rejects a genuinely incompatible conjunction", () => {
    // Two triggers from disjoint scopes cannot legally co-occur — inferring
    // the combined scope from every operand must not loosen this into
    // compiling. `and()`'s existing behavior is the baseline: both forms
    // reject the same conjunction, with the same kind of error.
    // @ts-expect-error — "planet" and "country" have no common scope
    hasPlanetFlag("z").and(hasCountryFlag("y"));
    // @ts-expect-error — and() rejects the identical conjunction the same way
    and(hasPlanetFlag("z"), hasCountryFlag("y"));
  });

  it("re-confirms Trigger's contravariant brand after .and()'s signature change", () => {
    // PR #18 depends on this variance behavior, so it is worth pinning
    // directly rather than only exercising it indirectly through and().
    neverSlot(hasCountryFlag("x")); // Trigger<never> accepts any trigger...
    neverSlot(hasPlanetFlag("y"));
    neverSlot(yearsPassed(">=", 5));
    // @ts-expect-error — ...but a concrete scope slot still rejects the wrong one
    countrySlot(hasPlanetFlag("y"));
  });

  it("keeps hidden_trigger and hidden_effect at the scope that encloses them", () => {
    // Both hide from tooltips and neither changes scope, so each is checked at
    // the scope it sits in — the same rule as any other condition or effect
    // written there, which is the point of hiding being a tooltip concern.
    const hidden = hiddenTrigger(hasCountryFlag("x"), isAtWar());
    expectTypeOf(hidden).toExtend<Trigger<"country">>();
    countrySlot(hiddenTrigger(hasCountryFlag("x")));
    // @ts-expect-error — a planet condition is no more legal hidden than shown
    countrySlot(hiddenTrigger(hasPlanetFlag("y")));

    const planet = makeScope<"planet">([]);
    planet.hiddenEffect((scope) => {
      scope.setPlanetFlag("still_a_planet");
      // @ts-expect-error — hiding an effect does not move it to country scope
      scope.setCountryFlag("country_only");
    });
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

describe("scope safety for scripted bindings", () => {
  it("rejects a country-asserted binding where a planet trigger is required", () => {
    // The binding is an ordinary `Trigger` once called, so the contravariant
    // brand does the work — nothing about scripted triggers needs its own
    // checking mechanism.
    planetSlot(scriptedTrigger("pd_habitability_check", "planet")());
    // @ts-expect-error — a country assertion does not fit a planet slot
    planetSlot(scriptedTrigger("is_fallen_empire", "country")());
  });

  it("lets `any` fit everywhere, which is what makes it the opt-out", () => {
    const anywhere = scriptedTrigger("some_trigger", "any");
    countrySlot(anywhere());
    planetSlot(anywhere());
    situationSlot(anywhere());
  });

  it("still infers the narrow scope when an `any` binding joins a combinator", () => {
    // `and` intersects its operands' scopes, and a universal operand is the
    // identity — so reaching for the opt-out on one condition does not widen
    // the clause around it.
    expectTypeOf(and(scriptedTrigger("some_trigger", "any")(), hasCountryFlag("x"))).toEqualTypeOf<
      Trigger<"country">
    >();
  });

  it("rejects a wrong-scope effect call at `run`", () => {
    const sink: PdxEntry[] = [];
    const countryOnly = scriptedEffect("set_merchant_government_effect", "country");
    makeScope<"country">(sink).run(countryOnly());
    // @ts-expect-error — a country-scoped effect cannot run in a planet closure
    makeScope<"planet">(sink).run(countryOnly());
  });

  it("keeps a trigger out of `run` and an effect call out of a condition", () => {
    const sink: PdxEntry[] = [];
    // @ts-expect-error — a Trigger is not a scripted effect call
    makeScope<"country">(sink).run(hasCountryFlag("x"));
    // @ts-expect-error — a scripted effect call is not a condition
    countrySlot(scriptedEffect("some_effect", "country")());
  });
});
