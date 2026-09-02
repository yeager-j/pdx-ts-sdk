/**
 * A reference position accepts three object forms — a scope value, a
 * localization reference, and a content reference — and `refId` used to treat
 * everything else that reached it as the third, reading an `id` that was not
 * there. An object with no `id` came back `undefined` and was written out as
 * the word `undefined`, naming content that cannot exist (SDK-324's sibling,
 * SDK-333).
 *
 * The generated types make each of these a compile error, so every case below
 * is what an erased type or a cast can still deliver: JavaScript call sites,
 * `as never`, and values assembled by hand.
 */

import { describe, expect, it } from "vitest";

import { createMod, render } from "../src/index.ts";
import { localizationScalar, refId, toScalar } from "../src/script/scalar.ts";
import { external, vanilla } from "../src/stellaris.ts";

const mod = createMod({
  name: "Reference refusal tests",
  prefix: "ref_test",
  supportedVersion: "4.0.*",
});

describe("refId", () => {
  it("refuses an object that is no reference at all", () => {
    expect(() => refId({} as never)).toThrow(/is not a reference/);
  });

  it("refuses an object whose id is not a string", () => {
    expect(() => refId({ id: 42 } as never)).toThrow(/is not a reference/);
  });

  it("says what a reference position would have read", () => {
    expect(() => refId({ technology: "tech_lasers_1" } as never)).toThrow(
      /Write a content reference .*, a scope value .*, a localization reference, or the id as a bare string\./s
    );
  });

  it("still unwraps each of the three reference forms", () => {
    expect(refId({ id: "tech_lasers_1" })).toBe("tech_lasers_1");
    expect(refId(external.localization("some_key"))).toBe("some_key");
    // A `vanilla.*` trie is a Proxy over a bare function, so the refinement
    // has to read `id` rather than probe for it: `typeof` on the Proxy
    // reflects the function target.
    expect(refId(vanilla.technology("tech_lasers_1"))).toBe("tech_lasers_1");
    expect(refId(vanilla.staticModifier.deficit.food_deficit)).toBe("food_deficit");
  });

  it("passes plain values through untouched", () => {
    expect(refId("tech_lasers_1")).toBe("tech_lasers_1");
    expect(refId(7)).toBe(7);
    expect(refId(true)).toBe(true);
  });
});

describe("a reference position that has a better message keeps it", () => {
  it("localizationScalar names the field and the forms it takes", () => {
    expect(() => localizationScalar({}, "custom_tooltip.fail_text")).toThrow(
      /"custom_tooltip\.fail_text" was given \{\}, which names no localization key/
    );
  });

  it("toScalar names the effect argument", () => {
    expect(() => toScalar({})).toThrow(/Cannot serialize \{\} as an effect argument/);
  });
});

describe("generic content lowering", () => {
  it("refuses a non-reference in a reference list and names the member", () => {
    const feature = mod.feature(undefined, [
      mod.technology("resonance", {
        cost: 100,
        weight: 100,
        name: "Resonance",
        area: "physics",
        tier: 1,
        category: "particles",
        prerequisites: [{} as never],
      }),
    ]);

    expect(() => render(mod.compile([feature]))).toThrow(
      /"prerequisites" was given \{\}, which is not a reference/
    );
  });

  it("still lowers the reference forms the member accepts", () => {
    const base = mod.technology("base", {
      cost: 100,
      weight: 100,
      name: "Base",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const derived = mod.technology("derived", {
      cost: 100,
      weight: 100,
      name: "Derived",
      area: "physics",
      tier: 2,
      category: "particles",
      prerequisites: [base, "tech_lasers_1", vanilla.technology("tech_lasers_2")],
    });

    const rendered = render(mod.compile([mod.feature(undefined, [base, derived])])).get(
      "common/technology/ref_test_technology.txt"
    );
    expect(rendered).toContain(
      'prerequisites = { "ref_test_tech_base" "tech_lasers_1" "tech_lasers_2" }'
    );
  });
});
