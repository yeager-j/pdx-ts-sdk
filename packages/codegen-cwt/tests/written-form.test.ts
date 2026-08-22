import { describe, expect, it } from "vitest";

import { WRITTEN_FORM, WRITTEN_FORM_EXEMPT } from "../src/corpus/corpus.ts";
import { CONTENT_SHAPES } from "../src/lower/content-shape.ts";

describe("the written-form table covers every content shape", () => {
  it("gives every CONTENT_SHAPES member a row or a named exemption, and nothing else", () => {
    for (const shape of CONTENT_SHAPES) {
      const hasRow = WRITTEN_FORM.has(shape);
      const isExempt = WRITTEN_FORM_EXEMPT.has(shape);
      expect(
        hasRow || isExempt,
        `${shape} has neither a WRITTEN_FORM row nor a WRITTEN_FORM_EXEMPT reason`
      ).toBe(true);
      expect(hasRow && isExempt, `${shape} is both a WRITTEN_FORM row and an exemption`).toBe(
        false
      );
    }
  });

  it("exempts only shapes that are members of CONTENT_SHAPES, each with a real reason", () => {
    const shapes = new Set<string>(CONTENT_SHAPES);
    for (const [shape, reason] of WRITTEN_FORM_EXEMPT) {
      expect(shapes.has(shape), `${shape} is not a CONTENT_SHAPES member`).toBe(true);
      expect(reason.trim().length > 0, `${shape} has an empty exemption reason`).toBe(true);
    }
  });
});
