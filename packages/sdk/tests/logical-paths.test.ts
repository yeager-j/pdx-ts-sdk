/**
 * The minting profile and the portability identity.
 *
 * These two answer different questions about one path. `normalizeLogicalPath`
 * answers "may this name exist at all", and every refusal below is a name that
 * some target filesystem cannot represent, so a mod carrying it would fail to
 * materialize on a machine the author does not own. `portableIdentity` answers
 * "could two names collapse into one file", and its refusals are aliases that a
 * case-insensitive volume would silently merge, destroying one of the two.
 *
 * The fold property tests are the load-bearing evidence for the second: they
 * measure the identity against every code point rather than against a list of
 * cases somebody thought of.
 */

import { describe, expect, it } from "vitest";

import { LogicalPathError } from "../src/errors.ts";
import { normalizeLogicalPath, portableIdentity, portablePathKey } from "../src/ordering.ts";

const encoder = new TextEncoder();

describe("minting a logical path", () => {
  it.each([
    ["an empty path", ""],
    ["a backslash separator", "gfx\\sprite.dds"],
    ["an absolute path", "/gfx/sprite.dds"],
    ["a lone surrogate", "gfx/\ud800.dds"],
    ["an empty component", "gfx//sprite.dds"],
    ["a trailing separator", "gfx/sprite.dds/"],
    ["a dot component", "gfx/./sprite.dds"],
    ["a dot-dot component", "gfx/../sprite.dds"],
    ["a control character", "gfx/spr\u0001ite.dds"],
    ["a delete character", "gfx/spr\u007Fite.dds"],
    ["a less-than", "gfx/<sprite>.dds"],
    ["a colon", "gfx/sprite:1.dds"],
    ["a double quote", 'gfx/"sprite".dds'],
    ["a pipe", "gfx/sprite|1.dds"],
    ["a question mark", "gfx/sprite?.dds"],
    ["an asterisk", "gfx/sprite*.dds"],
    ["a leading space", "gfx/ sprite.dds"],
    ["a trailing space", "gfx/sprite.dds "],
    ["a trailing period", "gfx/sprite."],
    ["a bare device name", "gfx/CON"],
    ["a lowercase device name", "gfx/nul"],
    ["an extension-bearing device name", "gfx/con.txt"],
    ["a numbered device name", "gfx/COM1"],
    ["the last numbered device name", "gfx/LPT9"],
  ])("refuses %s", (_label, raw) => {
    expect(() => normalizeLogicalPath(raw)).toThrow(LogicalPathError);
  });

  it("preserves case, because the game resolves overrides by exact bytes", () => {
    expect(normalizeLogicalPath("GFX/Sprites/Marker.DDS")).toBe("GFX/Sprites/Marker.DDS");
  });

  it("normalizes a decomposed component to NFC, so one file has one identity", () => {
    // "café" written as e + U+0301 must mint the same path as the precomposed
    // spelling. macOS hands back decomposed names for a file written composed.
    const decomposed = normalizeLogicalPath("gfx/caf\u0065\u0301.dds");
    expect(decomposed).toBe(normalizeLogicalPath("gfx/café.dds"));
    expect(decomposed).toBe("gfx/café.dds");
  });

  it("accepts a component at exactly the 255-byte cap and refuses one past it", () => {
    expect(normalizeLogicalPath(`gfx/${"a".repeat(255)}`)).toContain("a".repeat(255));
    expect(() => normalizeLogicalPath(`gfx/${"a".repeat(256)}`)).toThrow(LogicalPathError);
  });

  it("counts the cap in UTF-8 bytes, not characters", () => {
    // 86 three-byte characters: 258 UTF-8 bytes but only 86 UTF-16 code units,
    // so this refusal can only come from the byte cap. The UTF-16 cap cannot be
    // falsified on its own — UTF-8 never encodes a code unit in under one byte,
    // so a component past 255 units is always past 255 bytes first. It stays
    // declared because it is half of the stated portable profile.
    const component = "あ".repeat(86);
    expect(encoder.encode(component).byteLength).toBe(258);
    expect(component.length).toBe(86);
    expect(() => normalizeLogicalPath(`gfx/${component}`)).toThrow(LogicalPathError);
  });

  it("caps components rather than whole paths, because the sink preflights the absolute path", () => {
    // 40 components of 200 bytes is 8 kB of logical path and mints fine: the
    // total budget depends on the caller's materialization root, which the fold
    // has no way to know.
    const deep = Array.from({ length: 40 }, () => "b".repeat(200)).join("/");
    expect(normalizeLogicalPath(deep)).toBe(deep);
  });
});

/**
 * One pass over every code point, feeding all three properties below. It is
 * hoisted because the scan costs a couple of seconds and the suite runs test
 * files in parallel — paying it three times would starve the workers that
 * spawn a compiler.
 */
const scan = (() => {
  const unstable: string[] = [];
  const missedByLower: string[] = [];
  const missedByUpper: string[] = [];
  const byLower = new Map<string, string>();
  const byUpper = new Map<string, string>();

  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      continue;
    }
    const character = String.fromCodePoint(codePoint);
    const folded = portableIdentity(character);
    if (portableIdentity(folded) !== folded) {
      unstable.push(codePoint.toString(16));
    }

    const lower = character.toLowerCase();
    const seenLower = byLower.get(lower);
    if (seenLower === undefined) {
      byLower.set(lower, folded);
    } else if (seenLower !== folded) {
      missedByLower.push(codePoint.toString(16));
    }

    const upper = character.toUpperCase();
    const seenUpper = byUpper.get(upper);
    if (seenUpper === undefined) {
      byUpper.set(upper, folded);
    } else if (seenUpper !== folded) {
      missedByUpper.push(codePoint.toString(16));
    }
  }
  return { unstable, missedByLower, missedByUpper };
})();

describe("the portability identity", () => {
  it("is idempotent over every code point", () => {
    // The fold repeats to a fixpoint, and this is why: U+1E9E lowercases to "ß"
    // and "ß" uppercases to "SS", so a single round settles neither.
    expect(scan.unstable).toEqual([]);
  });

  it("contains the lowercasing collapse relation, which APFS and HFS+ use", () => {
    expect(scan.missedByLower).toEqual([]);
  });

  it("contains the uppercasing collapse relation, which NTFS uses", () => {
    // Together with the test above, this is the whole argument for folding
    // through both cases: neither relation contains the other, so the identity
    // has to contain both or a mod authored on one platform emits two names
    // that merge into one file on the other.
    expect(scan.missedByUpper).toEqual([]);
  });

  it.each([
    ["ASCII case", "Marker.DDS", "marker.dds"],
    ["a decomposed accent", "caf\u0065\u0301.dds", "café.dds"],
    ["Greek final sigma", "ΟΔΟΣ", "οδος"],
    ["a medial and final sigma", "οδοσ", "οδος"],
    ["the Turkish dotless i", "ı.dds", "i.dds"],
    ["the Kelvin sign", "K.dds", "k.dds"],
    ["capital sharp s", "STRAẞE.txt", "Straße.txt"],
    ["sharp s expanded", "straße.txt", "strasse.txt"],
    ["a compatibility ligature", "ﬁle.txt", "file.txt"],
  ])("collapses %s", (_label, left, right) => {
    expect(portableIdentity(left)).toBe(portableIdentity(right));
  });

  it.each([
    ["the Turkish dotted I against i", "İ.dds", "i.dds"],
    ["an accent against its base letter", "a.dds", "ä.dds"],
    ["distinct names", "marker.dds", "beacon.dds"],
  ])("keeps %s apart", (_label, left, right) => {
    expect(portableIdentity(left)).not.toBe(portableIdentity(right));
  });

  it("is locale-independent", () => {
    // The two results a `toLocaleLowerCase` slip flips. On a Turkish locale the
    // locale-sensitive pair maps "I" to "ı" and "i" to "İ", which would reverse
    // both of these and make the identity depend on the build machine.
    expect(portableIdentity("ı")).toBe(portableIdentity("i"));
    expect(portableIdentity("İ")).not.toBe(portableIdentity("i"));
  });

  it("folds a path component by component, keeping the separators", () => {
    expect(portablePathKey(normalizeLogicalPath("GFX/Sprites/Marker.DDS"))).toBe(
      "gfx/sprites/marker.dds"
    );
  });
});
