import { describe, expectTypeOf, it } from "vitest";

import { scriptCtx } from "../src/script/effects/recorder.ts";
import type { ScopeRef, ScopeValue } from "../src/script/effects/types.ts";
import { capitalScope, hasCountryFlag, owner, type Trigger } from "../src/script/triggers.ts";

const country = scriptCtx<"country", "country">();
const planet = scriptCtx<"planet", undefined>();

describe("scope links in value position", () => {
  it("hands ROOT over as an openable ref at the block's own scope", () => {
    expectTypeOf(country.root).toEqualTypeOf<ScopeRef<"country">>();
    expectTypeOf(planet.root).toEqualTypeOf<ScopeRef<"planet">>();
  });

  it("keeps an absolute base openable through the navigation", () => {
    expectTypeOf(owner(country.from)).toEqualTypeOf<ScopeRef<"country">>();
    expectTypeOf(owner(country.root)).toEqualTypeOf<ScopeRef<"country">>();
    owner(country.from).effects((c) => c.setCountryFlag("navigated"));
  });

  it("keeps a relative base a plain value, with no block to open", () => {
    expectTypeOf(owner(country.self)).toEqualTypeOf<ScopeValue<"country">>();
    // @ts-expect-error — `this.owner` is relative, so there is no scope its
    // type can promise the block's contents would run in
    owner(country.self).effects(() => {});
  });

  it("constrains the parameter by the link's input scopes, not the result", () => {
    expectTypeOf(capitalScope(country.self)).toEqualTypeOf<ScopeValue<"colony">>();
    // @ts-expect-error — capital_scope navigates from a country, not a planet
    capitalScope(planet.self);
  });

  it("leaves the trigger form on the same symbol untouched", () => {
    expectTypeOf(owner(hasCountryFlag("ascended"))).toExtend<Trigger<"planet">>();
    expectTypeOf(owner(hasCountryFlag("ascended"))).toExtend<Trigger<"country">>();
  });
});
