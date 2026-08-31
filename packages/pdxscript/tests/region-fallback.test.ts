/**
 * One claim, and it needs a seam.
 *
 * A region body that is not a balanced item sequence is a legitimate answer:
 * the engine splices these as text, so `param-text` is what the parser has to
 * say. A defect inside this package is not that, and the fallback used to
 * present it as one — it caught every exception and returned `param-text`
 * (SDK-316), so a `TypeError` came back as a syntactic distinction with no
 * diagnostic.
 *
 * Reaching that path needs an injected failure, because every error the
 * parser can produce on its own is a `PdxSyntaxError` by construction — which
 * is exactly why the confusion was invisible. `classifyUnquoted` is the seam:
 * the item loop calls it on a bare scalar, inside the guarded call. The mock
 * lives in this file alone so the per-claim suite next door keeps running
 * against the real module.
 */

import { describe, expect, it, vi } from "vitest";

import { parse } from "../src/parser.ts";

const DEFECT = "INJECTED_DEFECT";

vi.mock("../src/representable.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/representable.ts")>();
  return {
    ...actual,
    classifyUnquoted(text: string) {
      if (text === "INJECTED_DEFECT") {
        throw new TypeError("injected defect");
      }
      return actual.classifyUnquoted(text);
    },
  };
});

describe("region fallback", () => {
  it("lets a defect out instead of presenting it as a region with no tree", () => {
    expect(() => parse(`[[X] ${DEFECT} ]`, "defect.txt")).toThrow(TypeError);
    expect(() => parse(`[[X] ${DEFECT} ]`, "defect.txt")).toThrow(/injected defect/);
  });

  it("still keeps a body that genuinely has no tree as text", () => {
    const document = parse("[[X] a = { ]", "defect.txt");
    expect(document.items[0]).toMatchObject({ kind: "param-text", name: "X", negated: false });
    expect(document.diagnostics).toEqual([]);
  });
});
