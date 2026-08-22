import { describe, expect, it } from "vitest";

import { formOfShape, type AuthoredForm } from "../src/lower/authored-form.ts";
import { CONTENT_SHAPES, contentShape, type ContentShape } from "../src/lower/content-shape.ts";

describe("the closed content shape protocol", () => {
  it("classifies every shape without a default arm", () => {
    const expected = {
      value: "scalar",
      valueList: "list",
      trigger: "trigger",
      effect: "closure",
      economicResources: "block",
      economicResourceOperation: "block",
      economicResourcesNoProduce: "block",
      triggeredModifierBlock: "block",
      modifierBlock: "closure",
      inlineModifiers: "closure",
      inlineTrigger: "trigger",
      weightBlock: "block",
      weightBlockWithLoc: "block",
      dual: "block",
      struct: "block",
      triggerStruct: "block",
      aliasStruct: "block",
      structMap: "block",
      scalarMap: "block",
      repeatedStruct: "block",
      weightedEvents: "list",
    } satisfies Record<ContentShape, AuthoredForm>;

    for (const shape of CONTENT_SHAPES) {
      if (shape === "dual") {
        expect(() => formOfShape({ shape })).toThrow("cannot be another dual's arm");
      } else {
        expect(formOfShape({ shape })).toBe(expected[shape]);
      }
    }
  });

  it("keeps struct and scalar repetition semantics explicit", () => {
    expect(formOfShape({ shape: "struct", repeated: true })).toBe("list");
    expect(formOfShape({ shape: "struct", wrapped: true })).toBe("list");
    expect(formOfShape({ shape: "value", repeated: true })).toBe("list");
  });

  it("rejects a shape outside the protocol", () => {
    expect(() => contentShape("misspelledShape")).toThrow(
      'Unknown content shape "misspelledShape"'
    );
  });
});
