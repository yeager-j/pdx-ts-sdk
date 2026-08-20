import { describe, expect, it } from "vitest";

import { summarizeSignature } from "../src/signature-summary.ts";

describe("summarizeSignature", () => {
  it("keeps parameter names and drops their types", () => {
    expect(summarizeSignature('abortSituation(value: ScopeValue<"situation">): void;')).toBe(
      "(value) => void"
    );
  });

  it("survives commas nested in generics and object types", () => {
    expect(
      summarizeSignature(
        'abortSpecialProject(args: { type: SpecialProjectRef | string; location?: ScopeValue<"planet" | "ship", never> }): void;'
      )
    ).toBe("(args) => void");
  });

  it("lists multiple parameters, optional markers included", () => {
    expect(
      summarizeSignature("activateSavedLeader(key: SavedLeader, addToOwned?: boolean): void;")
    ).toBe("(key, addToOwned?) => void");
  });

  it("does not mistake a callback arrow for a generic closer", () => {
    expect(
      summarizeSignature("ifElse(condition: Trigger, then: (scope: CountryScope) => void): void;")
    ).toBe("(condition, then) => void");
  });

  it("handles empty parameter lists", () => {
    expect(summarizeSignature("destroy(): void;")).toBe("() => void");
  });

  it("refuses a string with no parameter list", () => {
    expect(summarizeSignature("not a signature")).toBeUndefined();
  });
});
