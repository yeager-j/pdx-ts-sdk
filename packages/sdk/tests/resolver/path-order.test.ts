/**
 * The comparator's contract, pinned two ways: fixed vectors for the orderings
 * the patch slice depends on, and the same property the stellaris-docs Rust
 * implementation pins — byte comparison agrees with code-point comparison
 * (which JavaScript's UTF-16 `<` does not; the fullwidth-tilde vector shows
 * the divergence the property guards against).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LogicalPathError } from "../../src/errors.ts";
import { compareLogicalPaths, enumerationOrder, normalizeLogicalPath } from "../../src/ordering.ts";

const path = normalizeLogicalPath;

/** Well-formed strings that survive component validation. */
const component = fc
  .string({ unit: "binary", minLength: 1, maxLength: 8 })
  .filter((s) => !/[\/\\<>:"|?*\u0000-\u001f\u007f]/.test(s))
  .filter((s) => s !== "." && s !== "..")
  .filter((s) => !s.startsWith(" ") && !s.endsWith(" ") && !s.endsWith("."))
  .filter((s) => !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s));

const logicalPath = fc
  .array(component, { minLength: 1, maxLength: 3 })
  .map((parts) => normalizeLogicalPath(parts.join("/")));

function compareByCodePoints(a: string, b: string): -1 | 0 | 1 {
  const pointsA = [...a];
  const pointsB = [...b];
  const shared = Math.min(pointsA.length, pointsB.length);
  for (let i = 0; i < shared; i++) {
    const delta = pointsA[i]!.codePointAt(0)! - pointsB[i]!.codePointAt(0)!;
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
  }
  return pointsA.length === pointsB.length ? 0 : pointsA.length < pointsB.length ? -1 : 1;
}

describe("compareLogicalPaths", () => {
  it("byte order agrees with code-point order (the Rust implementation's pin)", () => {
    fc.assert(
      fc.property(logicalPath, logicalPath, (a, b) => {
        expect(compareLogicalPaths(a, b)).toBe(compareByCodePoints(a, b));
      }),
      { numRuns: 2000 }
    );
  });

  it("is antisymmetric and zero exactly on equality", () => {
    fc.assert(
      fc.property(logicalPath, logicalPath, (a, b) => {
        expect(compareLogicalPaths(a, b)).toBe(-compareLogicalPaths(b, a));
        expect(compareLogicalPaths(a, b) === 0).toBe(a === b);
      }),
      { numRuns: 2000 }
    );
  });

  it("orders the ASCII discriminators the filename scheme leans on", () => {
    const ordered = ["!x.txt", "0x.txt", "Ax.txt", "_x.txt", "ax.txt", "zx.txt"].map(path);
    for (let i = 0; i + 1 < ordered.length; i++) {
      expect(compareLogicalPaths(ordered[i]!, ordered[i + 1]!)).toBe(-1);
    }
  });

  it("is case-sensitive: no folding, ever", () => {
    expect(compareLogicalPaths(path("Zebra.txt"), path("apple.txt"))).toBe(-1);
  });

  it("a stem-appended name sorts after its source ('.' < '_')", () => {
    expect(
      compareLogicalPaths(
        path("common/technology/zz_zz_late.txt"),
        path("common/technology/zz_zz_late_mymod_patch.txt")
      )
    ).toBe(-1);
  });

  it("diverges from UTF-16 string comparison where surrogates sort low", () => {
    // U+FF5E (fullwidth tilde) < U+1D11E (musical symbol) by code point and by
    // UTF-8 bytes, but ">" by UTF-16 units — the exact bug the property guards.
    const fullwidth = path("～");
    const astral = path("\u{1d11e}");
    expect((fullwidth as string) > (astral as string)).toBe(true);
    expect(compareLogicalPaths(fullwidth, astral)).toBe(-1);
  });
});

describe("normalizeLogicalPath", () => {
  it("normalizes to NFC, so composed and decomposed spellings are one path", () => {
    expect(normalizeLogicalPath("cafe\u0301.txt")).toBe("caf\u00e9.txt");
  });

  it.each([
    ["", /empty/],
    ["a\\b.txt", /backslash/],
    ["a\0.txt", /control character/],
    ["\ud800.txt", /lone surrogate/],
    ["/absolute.txt", /absolute/],
    ["a//b.txt", /empty component/],
    ["a/", /empty component/],
    ["./a.txt", /"\." component/],
    ["a/../b.txt", /"\.\." component/],
    ["dir/con.txt", /reserved Windows device name/],
  ])("rejects %j", (raw, message) => {
    expect(() => normalizeLogicalPath(raw)).toThrow(LogicalPathError);
    expect(() => normalizeLogicalPath(raw)).toThrow(message);
  });
});

describe("enumerationOrder", () => {
  it("returns normalized paths in byte order", () => {
    expect(enumerationOrder(["b.txt", "a/c.txt", "A.txt"])).toEqual(["A.txt", "a/c.txt", "b.txt"]);
  });

  it("surfaces NFC collisions instead of picking a winner", () => {
    expect(() => enumerationOrder(["caf\u00e9.txt", "cafe\u0301.txt"])).toThrow(
      /normalize to the same logical path/
    );
  });

  it("tolerates the same raw path listed twice", () => {
    expect(enumerationOrder(["a.txt", "a.txt"])).toEqual(["a.txt"]);
  });
});
