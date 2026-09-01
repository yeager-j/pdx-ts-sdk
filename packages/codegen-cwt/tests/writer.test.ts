/**
 * Documents the contract `writer.ts`'s helpers promise their emit-layer
 * callers: `member`'s doc-comment-plus-declaration shape, `constArray`'s
 * field-table wrapper, and the refTypes suffix the trio in `fields.ts`,
 * `effects.ts`, and `alias-struct.ts` used to format three separate ways.
 * The real gate for "the output did not change" is `codegen:check`'s
 * byte-identical diff against committed generated output; these tests only
 * pin the helpers' own behavior so a future edit here has something to run
 * against.
 */

import type { TsValue } from "@pdx-ts/codegen-cwt/render/emitter";
import {
  constArray,
  member,
  refTypesEntries,
  refTypesSuffix,
} from "@pdx-ts/codegen-cwt/render/writer";
import { describe, expect, it } from "vitest";

/** A minimal `TsValue` for testing writer metadata. */
function tsValue(
  overrides: Partial<TsValue> & Pick<TsValue, "type" | "toScalar" | "conversion">
): TsValue {
  return overrides;
}

describe("member", () => {
  it("renders a required member with no doc comment", () => {
    expect(member({ name: "amount", type: "number", optional: false, docs: [] })).toBe(
      "  amount: number;\n"
    );
  });

  it("renders an optional member", () => {
    expect(member({ name: "amount", type: "number", optional: true, docs: [] })).toBe(
      "  amount?: number;\n"
    );
  });

  it("prefixes a single doc line as a one-line comment", () => {
    expect(member({ name: "amount", type: "number", optional: false, docs: ["The amount."] })).toBe(
      "  /** The amount. */\n  amount: number;\n"
    );
  });

  it("prefixes several doc lines as a block comment", () => {
    expect(
      member({ name: "amount", type: "number", optional: false, docs: ["Line one.", "Line two."] })
    ).toBe("  /**\n   * Line one.\n   * Line two.\n   */\n  amount: number;\n");
  });

  it("adds the readonly modifier when asked", () => {
    expect(
      member({ name: "amount", type: "number", optional: true, docs: [], readonly: true })
    ).toBe("  readonly amount?: number;\n");
  });

  it("quotes a name that is not a bare identifier", () => {
    expect(member({ name: "90_day", type: "string", optional: false, docs: [] })).toBe(
      '  "90_day": string;\n'
    );
  });

  it("honors a custom indent for both the doc comment and the declaration", () => {
    expect(
      member({
        name: "amount",
        type: "number",
        optional: false,
        docs: ["The amount."],
        indent: "    ",
      })
    ).toBe("    /** The amount. */\n    amount: number;\n");
  });
});

describe("constArray", () => {
  it("documents the exported readonly array wrapping its pre-rendered rows", () => {
    const rows = '  { key: "a" },\n  { key: "b" },\n';
    expect(constArray("THINGS", "ContentField", rows, ["Every thing."])).toBe(
      "/** Every thing. */\n" +
        'export const THINGS: readonly ContentField[] = [\n  { key: "a" },\n  { key: "b" },\n];\n\n'
    );
  });

  it("still emits a valid empty array for no rows", () => {
    expect(constArray("THINGS", "ContentField", "", ["Every thing."])).toBe(
      "/** Every thing. */\nexport const THINGS: readonly ContentField[] = [\n];\n\n"
    );
  });
});

const referencing: TsValue = tsValue({
  type: "TechnologyRef",
  toScalar: (e) => `refId(${e})`,
  conversion: "refId",
  refTypes: ["technology"],
});
const plain: TsValue = tsValue({ type: "string", toScalar: (e) => e, conversion: "identity" });

describe("refTypesSuffix / refTypesEntries share one fact about a value", () => {
  it("format the same presence/absence of refTypes two different ways", () => {
    expect(refTypesSuffix(referencing)).toBe(', refTypes: ["technology"]');
    expect(refTypesEntries(referencing)).toEqual(['refTypes: ["technology"]']);

    expect(refTypesSuffix(plain)).toBe("");
    expect(refTypesEntries(plain)).toEqual([]);
  });

  it("treat undefined the same as a value with no refTypes", () => {
    expect(refTypesSuffix(undefined)).toBe("");
    expect(refTypesEntries(undefined)).toEqual([]);
  });
});
