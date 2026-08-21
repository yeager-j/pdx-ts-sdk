import {
  pluralize,
  propertyAccess,
  propertyName,
  referencesIdentifier,
} from "@pdx-ts/codegen-cwt/naming";
import { describe, expect, it } from "vitest";

describe("pluralize", () => {
  it("appends s to a name that does not already end in one", () => {
    expect(pluralize("countryFlag")).toBe("countryFlags");
    expect(pluralize("planetFlag")).toBe("planetFlags");
  });

  it("leaves a name that already ends in s alone", () => {
    // The two value sets that motivated the rule. Both arrived with the solar
    // system initializer registry and spelled themselves `customStarNamess`
    // under the unconditional append this replaced, so the only standing
    // evidence otherwise is two lines of committed generated output.
    expect(pluralize("customStarNames")).toBe("customStarNames");
    expect(pluralize("customPlanetNames")).toBe("customPlanetNames");
  });
});

describe("propertyName", () => {
  it("leaves a plain identifier bare", () => {
    expect(propertyName("mult")).toBe("mult");
  });

  it("quotes a name that starts with a digit", () => {
    expect(propertyName("90_day")).toBe('"90_day"');
  });

  it("quotes a name with a dash", () => {
    expect(propertyName("some-dashed-key")).toBe('"some-dashed-key"');
  });
});

describe("propertyAccess", () => {
  it("emits dot access for a plain identifier", () => {
    expect(propertyAccess("args", "mult")).toBe("args.mult");
  });

  it("emits bracket access for a name that is not a plain identifier", () => {
    expect(propertyAccess("args", "90Day")).toBe('args["90Day"]');
  });
});

describe("referencesIdentifier", () => {
  it("matches a name used as its own type", () => {
    expect(referencesIdentifier("modifier?: ModifierBlock;", "ModifierBlock")).toBe(true);
  });

  it("does not match a name that is only a substring of a longer identifier", () => {
    // The bug this guards: a bare `code.includes(name)` false-matches
    // `ModifierBlock` inside the shape string `triggeredModifierBlock` (the
    // character before `M` is `d`, a word character, so there is no boundary
    // there) and `EconomicResourceBlock` inside
    // `EconomicResourceBlockNoProduce` (the character after `Block` is `N`, a
    // word character, so there is no boundary there either).
    expect(referencesIdentifier('shape: "triggeredModifierBlock"', "ModifierBlock")).toBe(false);
    expect(
      referencesIdentifier("value: EconomicResourceBlockNoProduce;", "EconomicResourceBlock")
    ).toBe(false);
  });

  it("still matches the longer name when it is what was asked for", () => {
    expect(
      referencesIdentifier(
        "value: EconomicResourceBlockNoProduce;",
        "EconomicResourceBlockNoProduce"
      )
    ).toBe(true);
  });
});
