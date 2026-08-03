/**
 * The pure derivations. The property test is the one that matters: it asserts
 * against the SDK's own `FILE_STEM_PATTERN` rather than a copy, so tightening
 * the SDK's grammar breaks a test here instead of a stranger's scaffold.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FILE_STEM_PATTERN } from "../../sdk/src/index.ts";
import { isValidPrefix, toDisplayName, toPackageName, toPrefix, toTags } from "../src/derive.ts";

describe("toPrefix", () => {
  it.each([
    ["Hello Galaxy", "hello_galaxy"],
    ["already_snake", "already_snake"],
    ["Café Noir", "cafe_noir"],
    ["Ærø Ascendancy", "aero_ascendancy"],
    ["Straße der Sterne", "strasse_der_sterne"],
    ["  spaced  out  ", "spaced_out"],
    ["Dashes-And.Dots", "dashes_and_dots"],
  ])("turns %o into %o", (name, expected) => {
    expect(toPrefix(name)).toBe(expected);
  });

  it("prefixes a name that starts with a digit rather than refusing it", () => {
    // Ids and file stems must start with a letter, and "4X Overhaul" is a real
    // name someone will type.
    expect(toPrefix("4X Overhaul")).toBe("mod_4x_overhaul");
  });

  it("falls back rather than producing an empty prefix", () => {
    expect(toPrefix("!!!")).toBe("my_mod");
    expect(toPrefix("")).toBe("my_mod");
  });

  it("produces something the SDK accepts, for any input at all", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const prefix = toPrefix(name);
        expect(FILE_STEM_PATTERN.test(prefix)).toBe(true);
        expect(isValidPrefix(prefix)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it("is idempotent, so re-deriving an accepted prefix cannot change it", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const once = toPrefix(name);
        expect(toPrefix(once)).toBe(once);
      })
    );
  });
});

describe("toDisplayName", () => {
  it.each([
    ["my-cool-mod", "My Cool Mod"],
    ["my_cool_mod", "My Cool Mod"],
    ["mod", "Mod"],
  ])("turns %o into %o", (dir, expected) => {
    expect(toDisplayName(dir)).toBe(expected);
  });

  it("falls back for a directory name with nothing in it", () => {
    expect(toDisplayName("---")).toBe("My Stellaris Mod");
  });
});

describe("toPackageName", () => {
  it("produces an npm-legal name, for any directory name", () => {
    // npm rejects capitals and most punctuation, and a scaffold whose first
    // `npm install` fails on its own name is an unkind way to start.
    fc.assert(
      fc.property(fc.string(), (dir) => {
        const name = toPackageName(dir);
        expect(name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
        expect(name.length).toBeGreaterThan(0);
      }),
      { numRuns: 1000 }
    );
  });
});

describe("toTags", () => {
  it("splits, trims, and drops the empties", () => {
    expect(toTags("Technologies, Events ,, ")).toEqual(["Technologies", "Events"]);
    expect(toTags(undefined)).toEqual([]);
  });
});
