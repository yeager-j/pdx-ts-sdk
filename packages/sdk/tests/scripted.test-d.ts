/**
 * What a scripted binding's parameters accept, held against the real emitted
 * surface.
 *
 * The claim worth pinning here is the one `[[FLAG] ... ]` makes.
 * `add_random_trait_evopred` writes its whole body inside `[[SPECIES] ... ]`
 * and substitutes `$TAG$` only in there, so the two names are a choice rather
 * than two independent optional parameters: both or neither. The package used
 * to type them `SPECIES?` and `TAG?`, which accepted `{ SPECIES: "x" }` — a
 * call that activates the region and then emits a body whose every `$TAG$` has
 * nothing to substitute.
 *
 * These are the two definitions in vanilla 4.4.6 shaped this way, so this is
 * the whole population rather than a sample.
 */

import { describe, expectTypeOf, it } from "vitest";

import { scriptedEffect, scriptedTrigger } from "../src/stellaris.ts";

const addRandomTraitEvopred = scriptedEffect("add_random_trait_evopred", "species");
const anyRandomTraitEvopred = scriptedTrigger("any_available_random_trait_by_tag_evopred", "any");

describe("a region's parameters", () => {
  it("may all be omitted, which leaves the region inactive", () => {
    expectTypeOf(addRandomTraitEvopred).toBeCallableWith();
    expectTypeOf(addRandomTraitEvopred).toBeCallableWith({});
    expectTypeOf(anyRandomTraitEvopred).toBeCallableWith();
    expectTypeOf(anyRandomTraitEvopred).toBeCallableWith({});
  });

  it("may all be supplied, which activates it", () => {
    expectTypeOf(addRandomTraitEvopred).toBeCallableWith({ SPECIES: "this", TAG: "organic" });
    expectTypeOf(anyRandomTraitEvopred).toBeCallableWith({ SPECIES: "this", TAG: "organic" });
  });

  it("cannot be activated without them", () => {
    // @ts-expect-error activating the region leaves `$TAG$` unsubstituted
    addRandomTraitEvopred({ SPECIES: "this" });
    // @ts-expect-error the same, through the boolean the SDK widens every parameter to
    addRandomTraitEvopred({ SPECIES: true });
    // @ts-expect-error the trigger half of the same definition shape
    anyRandomTraitEvopred({ SPECIES: "this" });
  });

  it("cannot be supplied without activating it", () => {
    // `$TAG$` is substituted only inside the region, so passing it alone
    // writes a key the game never reads.
    // @ts-expect-error the region is off, so there is no `$TAG$` to substitute
    addRandomTraitEvopred({ TAG: "organic" });
    // @ts-expect-error the trigger half of the same definition shape
    anyRandomTraitEvopred({ TAG: "organic" });
  });
});

describe("an ordinary parameter bag", () => {
  it("still widens to the forms a parameter may take", () => {
    // The `never` branch must not cost the widening everywhere else.
    const byTag = scriptedTrigger("any_available_random_trait_by_tag", "any");

    expectTypeOf(byTag).toBeCallableWith({ TAG: "organic", NOTTAG: "robotic" });
    expectTypeOf(byTag).toBeCallableWith({ TAG: true, NOTTAG: 1 });
  });

  it("still requires what has no default", () => {
    const byTag = scriptedTrigger("any_available_random_trait_by_tag", "any");

    // @ts-expect-error NOTTAG has no default and is substituted unconditionally
    byTag({ TAG: "organic" });
  });
});
