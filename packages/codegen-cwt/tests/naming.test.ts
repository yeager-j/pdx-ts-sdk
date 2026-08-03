import { pluralize } from "@pdx-ts/codegen-cwt/naming";
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
