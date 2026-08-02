/**
 * The licensing boundary, tested as a gate rather than as a promise.
 *
 * The package may carry the identifiers Paradox's files define and nothing
 * else. That is a constraint on a *generator*, so the evidence has to be a
 * generator that goes red: the unit cases below include the negative control —
 * a localisation sentence and a line of script — and a whole poisoned fixture
 * install that must fail to generate rather than emit.
 *
 * The third leg measures the fixture output itself: every string literal that
 * is not a module specifier passes the same imported gate, and no generated
 * module carries runtime code. One authority, applied twice.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { assertVanillaIdentifier, compareIdentifiers } from "../src/emit.ts";
import { generateVanillaPackage } from "../src/generate.ts";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const OPTIONS = {
  installRoot: path.join(ROOT, "fixtures/fake-install"),
  gameVersion: "4.4.6",
  configRoot: path.join(ROOT, "vendor/cwtools-stellaris-config/config"),
  trieThreshold: 5,
};

const generated = generateVanillaPackage(OPTIONS);

describe("assertVanillaIdentifier", () => {
  it("passes the names the game actually defines", () => {
    for (const name of [
      "tech_lasers_2",
      "GFX_ship_x",
      "shield_effect_working_looping_11s_fadeinout_0.7s",
      "GFX_species_selected_background_trait_machine_pc_shattered_ring_habitable_preference",
      "Weapon Ambience",
    ]) {
      expect(assertVanillaIdentifier(name, "test")).toBe(name);
    }
  });

  it("refuses localised prose", () => {
    expect(() => assertVanillaIdentifier("The Grand Herald has arrived.", "test")).toThrow(
      /more spaces than a name has/
    );
  });

  it("refuses script", () => {
    expect(() => assertVanillaIdentifier("has_country_flag = x", "test")).toThrow(/contains "="/);
    expect(() => assertVanillaIdentifier("count < 3", "test")).toThrow(
      /script assignment or comparison/
    );
    expect(() => assertVanillaIdentifier("limit = { x }", "test")).toThrow(/refusing to emit/);
  });

  it("refuses substitution tokens, braces, quotes, and newlines", () => {
    expect(() => assertVanillaIdentifier("has_trait_$TRAIT$", "test")).toThrow(/contains "\$"/);
    expect(() => assertVanillaIdentifier("a{b", "test")).toThrow(/contains "\{"/);
    expect(() => assertVanillaIdentifier('say_"hi"', "test")).toThrow(/refusing to emit/);
    expect(() => assertVanillaIdentifier("first\nsecond", "test")).toThrow(/refusing to emit/);
    expect(() => assertVanillaIdentifier("# a comment", "test")).toThrow(/contains "#"/);
  });

  it("refuses the empty string and anything long enough to be a body", () => {
    expect(() => assertVanillaIdentifier("", "test")).toThrow(/empty/);
    expect(() => assertVanillaIdentifier("x".repeat(121), "test")).toThrow(/121 characters/);
  });

  it("names the context and quotes the candidate, so a failure is actionable", () => {
    expect(() => assertVanillaIdentifier("a = b", "sprite id")).toThrow(/^sprite id: refusing/);
  });
});

describe("negative control", () => {
  it("fails to generate against an install whose names are localised text", () => {
    expect(() =>
      generateVanillaPackage({
        ...OPTIONS,
        installRoot: fileURLToPath(new URL("./fixtures/fake-install-poisoned", import.meta.url)),
      })
    ).toThrow(/sound id: refusing to emit "The Grand Herald has arrived\."/);
  });
});

/**
 * Module specifiers are the one class of quoted string in the output that is
 * not an identifier — they are this generator's own file layout, written by the
 * emitters and never read from the install.
 */
function identifierLiterals(text: string): string[] {
  return [...text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)]
    .map((match) => match[1]!)
    .filter((value) => !value.startsWith("./") && !value.startsWith("@pdx-ts/"));
}

describe("generated output", () => {
  it("contains nothing the gate would not have let through", () => {
    let checked = 0;
    for (const [name, text] of generated.files) {
      for (const literal of identifierLiterals(text)) {
        expect(() => assertVanillaIdentifier(literal, name)).not.toThrow();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("is types only — no runtime export and no import but the augmentation", () => {
    for (const [name, text] of generated.files) {
      expect(text, name).not.toMatch(/\bexport\s+(const|let|var|function|class|default|enum)\b/);
      for (const line of text.split("\n")) {
        if (!line.startsWith("import")) {
          continue;
        }
        expect(line.startsWith("import type ") || line === 'import "./augment.ts";', name).toBe(
          true
        );
      }
    }
  });
});

describe("compareIdentifiers", () => {
  it("orders by bytes, not by locale", () => {
    // `localeCompare` sorts "_" as if it were not there, so `a_b` would land
    // after `ab` on one machine and before it on another.
    expect(["ab", "a_b", "aB"].sort(compareIdentifiers)).toEqual(["aB", "a_b", "ab"]);
  });
});
