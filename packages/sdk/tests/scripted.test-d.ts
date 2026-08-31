/**
 * What a scripted binding's parameters accept.
 *
 * Two claims, and they need different evidence. The first is what vanilla
 * actually publishes, held against the real emitted surface. The second is what
 * the SDK does with a parameter it must refuse — machinery no vanilla
 * definition exercises today, so it is held against a hand-written shape.
 */

import { describe, expectTypeOf, it } from "vitest";

import type { ScriptedTriggerArgs } from "../src/script/scripted.ts";
import { scriptedEffect, scriptedTrigger } from "../src/stellaris.ts";

/**
 * `add_random_trait_evopred` writes `[[SPECIES] ... $TAG$ ... ]` beside
 * `[[!SPECIES] ... $TAG$ ... ]`. Exactly one branch always runs, so `$TAG$` is
 * always substituted whatever the caller does with `SPECIES`.
 *
 * The package used to type both optional, which accepted `{}` and emitted a
 * body with `$TAG$` unresolved. `TAG` is required now, and `SPECIES` stays the
 * ordinary optional flag it is — reading the negated region as if it were
 * presence-activated would instead tie the two together and refuse
 * `{ TAG: "organic" }`, which is the common call.
 */
const addRandomTraitEvopred = scriptedEffect("add_random_trait_evopred", "species");
const anyRandomTraitEvopred = scriptedTrigger("any_available_random_trait_by_tag_evopred", "any");

describe("a parameter both branches of a negated region pair substitute", () => {
  it("may be passed alone, without the flag", () => {
    expectTypeOf(addRandomTraitEvopred).toBeCallableWith({ TAG: "organic" });
    expectTypeOf(anyRandomTraitEvopred).toBeCallableWith({ TAG: "organic" });
  });

  it("may be passed with the flag", () => {
    expectTypeOf(addRandomTraitEvopred).toBeCallableWith({ SPECIES: "this", TAG: "organic" });
    expectTypeOf(anyRandomTraitEvopred).toBeCallableWith({ SPECIES: "this", TAG: "organic" });
  });

  it("cannot be left out, whichever branch runs", () => {
    // @ts-expect-error `$TAG$` is substituted either way, so it has no default
    addRandomTraitEvopred({});
    // @ts-expect-error the flag alone still leaves `$TAG$` unresolved
    addRandomTraitEvopred({ SPECIES: "this" });
    // @ts-expect-error the trigger half of the same definition shape
    anyRandomTraitEvopred({ SPECIES: "this" });
  });
});

/**
 * A region with no negated twin: `[[FLAG] ... $NAME$ ... ]` alone.
 *
 * `NAME` is reachable only when `FLAG` is supplied, so the two are a choice and
 * the package emits a union of call shapes. Vanilla 4.4.6 contains none, so
 * this is held against the shape the emitter produces rather than against a
 * generated type — the machinery is real and untested otherwise.
 */
type Regioned =
  | { readonly FLAG?: never; readonly NAME?: never }
  | { readonly FLAG: string | number; readonly NAME: string | number };

declare function regioned(...args: ScriptedTriggerArgs<Regioned>): void;

describe("a region whose parameters only it reaches", () => {
  it("may be left inactive", () => {
    expectTypeOf(regioned).toBeCallableWith();
    expectTypeOf(regioned).toBeCallableWith({});
  });

  it("may be activated with what it needs", () => {
    expectTypeOf(regioned).toBeCallableWith({ FLAG: "yes", NAME: "flag_name" });
  });

  it("cannot be activated without it", () => {
    // @ts-expect-error activating the region leaves `$NAME$` unsubstituted
    regioned({ FLAG: "yes" });
    // The widening every parameter gets must not reopen the branch a shape
    // closed: `FLAG?: never` widened to `boolean` would accept this.
    // @ts-expect-error the same call, through the boolean form
    regioned({ FLAG: true });
  });

  it("cannot supply what the inactive region would have substituted", () => {
    // @ts-expect-error the region is off, so nothing would substitute `$NAME$`
    regioned({ NAME: "flag_name" });
  });
});

describe("an ordinary parameter bag", () => {
  const byTag = scriptedTrigger("any_available_random_trait_by_tag", "any");

  it("still widens to the forms a parameter may take", () => {
    // The `never` branch must not cost the widening everywhere else.
    expectTypeOf(byTag).toBeCallableWith({ TAG: "organic", NOTTAG: "robotic" });
    expectTypeOf(byTag).toBeCallableWith({ TAG: true, NOTTAG: 1 });
  });

  it("still requires what has no default", () => {
    // @ts-expect-error NOTTAG has no default and is substituted unconditionally
    byTag({ TAG: "organic" });
  });
});
