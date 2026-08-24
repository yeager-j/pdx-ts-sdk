import { describe, expectTypeOf, it } from "vitest";

import { withScriptCtx } from "../src/script/effects/recorder.ts";
import type { ScopeRef, ScopeValue, ScriptCtx } from "../src/script/effects/types.ts";
import {
  capitalScope,
  exists,
  hasCountryFlag,
  owner,
  target,
  type ScopeName,
  type Trigger,
} from "../src/script/triggers.ts";

const country = withScriptCtx<
  "country",
  { readonly root: "country"; readonly from: "country" },
  ScriptCtx<"country", { readonly root: "country"; readonly from: "country" }>
>({}, (ctx) => ctx);
const planet = withScriptCtx<"planet", { readonly root: "planet" }, ScriptCtx<"planet">>(
  {},
  (ctx) => ctx
);

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

/**
 * `target` is the one link codegen declines (`output_scope = any`), so its
 * value form is hand-written alongside its condition form and its scope is
 * asserted rather than read — see `script/triggers.ts`.
 */
describe("the declined target link in value position (SDK-129)", () => {
  it("takes the landing scope from the author's assertion", () => {
    expectTypeOf(target<"country">()).toEqualTypeOf<ScopeValue<"country">>();
    expectTypeOf(target()).toEqualTypeOf<ScopeValue<ScopeName>>();
  });

  it("never lets the expected type do the asserting for the author", () => {
    // The regression the split value overloads exist to prevent: with one
    // `<S = ScopeName>` signature, `S` inferred from the annotation here and a
    // bare call silently claimed a planet nobody asserted.
    // @ts-expect-error — an unasserted target is ScopeName-wide, and the brand
    // is covariant, so it does not assign where a specific scope is required
    const inferred: ScopeValue<"planet"> = target();
    expectTypeOf(inferred).toEqualTypeOf<ScopeValue<"planet">>();
    // Written out, the same assignment is exactly what the contract allows.
    const asserted: ScopeValue<"planet"> = target<"planet">();
    expectTypeOf(asserted).toEqualTypeOf<ScopeValue<"planet">>();
    // Still wide in a context that would happily have narrowed it.
    expectTypeOf<ScopeValue<ScopeName>>().toEqualTypeOf(target());
  });

  it("stays relative, so there is no block to open", () => {
    // @ts-expect-error — `target` means whatever the enclosing situation
    // targets, so no ScopeRef: its type cannot promise a scope for a block
    target<"country">().effects(() => {});
    expectTypeOf(target<"country">()).not.toExtend<ScopeRef<"country">>();
  });

  it("keeps the condition overload resolving on the same symbol", () => {
    expectTypeOf(target(hasCountryFlag("ascended"))).toExtend<Trigger<"situation">>();
    expectTypeOf(target(hasCountryFlag("ascended"))).toExtend<Trigger<"spy_network">>();
  });

  it("flows into every trigger that takes a ScopeValue", () => {
    expectTypeOf(exists(target())).toExtend<Trigger<"situation">>();
  });
});
