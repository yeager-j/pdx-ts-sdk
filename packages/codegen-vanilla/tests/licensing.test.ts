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
 * is not a module specifier passes the same imported gate its emitter used —
 * the path gate for `paths.ts`, the identifier gate for everything else — and
 * no generated module carries runtime code beyond the four that must. One
 * authority, applied twice.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { emitEventTrie } from "../src/emit-events.ts";
import {
  assertVanillaIdentifier,
  assertVanillaPath,
  compareIdentifiers,
  createChokepoint,
  emitVanillaGfxIds,
  emitVanillaPaths,
} from "../src/emit.ts";
import { generateVanillaPackage } from "../src/generate.ts";
import { RUNTIME_ID_SET_REGISTRIES } from "../src/manifest.ts";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const OPTIONS = {
  installRoot: path.join(ROOT, "fixtures/fake-install"),
  gameVersion: "4.4.6",
  configRoot: path.join(ROOT, "vendor/cwtools-stellaris-config/config"),
  docsRoot: path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1"),
  trieThreshold: 5,
};

const generated = generateVanillaPackage(OPTIONS);

/**
 * The five files that carry runtime, and the only five. Everything else the
 * generator emits is types with zero payload. `triggers.ts` and `effects.ts`
 * hold one bound call per scripted definition (SDK-13); `paths.ts` holds the
 * install's path inventory, which is data because the SDK looks paths up at
 * build time rather than asking a compiler to hold a union of tens of
 * thousands of strings (SDK-173); `gfx-ids.ts` holds the mint-shaped
 * registries' ids, for the same reason one step over — a minted GFX name is
 * only known at build time, so the collision refusal is a lookup rather than a
 * type (SDK-121); `enum-members.ts` holds the selected complex-enum members
 * whose exact identity must take precedence over prefix-based ownership.
 */
const BINDING_FILES = new Set(["triggers.ts", "effects.ts"]);
const RUNTIME_FILES = new Set([...BINDING_FILES, "paths.ts", "gfx-ids.ts", "enum-members.ts"]);

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

describe("assertVanillaPath", () => {
  it("passes the paths an install actually contains", () => {
    for (const one of [
      "music/fake_dlc_track.ogg",
      "common/technology/00_soc_tech.txt",
      "flags/backgrounds/00 solid.dds",
      `gfx/models/${"deep/".repeat(30)}ship.mesh`,
    ]) {
      expect(assertVanillaPath(one, "test")).toBe(one);
    }
  });

  it("passes the inline-script template filename that forced the `$` rule", () => {
    // The real 4.4.6 file, and the only path in the whole install carrying a
    // `$`. Refusing it would refuse the inventory; a refactor that folded the
    // path rules back into the identifier list would do exactly that.
    const measured = "common/inline_scripts/trait/icon_element/council_no_$CLASS$.txt";
    expect(assertVanillaPath(measured, "vanilla path")).toBe(measured);
    expect(() => assertVanillaIdentifier(measured, "test")).toThrow(/contains "\$"/);
  });

  it("refuses anything that is not an install-relative path", () => {
    expect(() => assertVanillaPath("gfx/../etc/passwd", "test")).toThrow(
      /contains a ".." component/
    );
    expect(() => assertVanillaPath("gfx/./ship.mesh", "test")).toThrow(/contains a "." component/);
    expect(() => assertVanillaPath("/usr/share/stellaris/x", "test")).toThrow(/is absolute/);
    expect(() => assertVanillaPath("C:/Stellaris/x", "test")).toThrow(/is absolute/);
    expect(() => assertVanillaPath("gfx\\ship.mesh", "test")).toThrow(/contains "\\\\"/);
    expect(() => assertVanillaPath("gfx//ship.mesh", "test")).toThrow(/empty component/);
    expect(() => assertVanillaPath("gfx/ship.mesh/", "test")).toThrow(/empty component/);
    expect(() => assertVanillaPath("", "test")).toThrow(/empty/);
  });

  it("refuses the shapes that mean a body leaked in", () => {
    expect(() => assertVanillaPath("has_country_flag = x", "test")).toThrow(/contains "="/);
    expect(() => assertVanillaPath("limit = { x }", "test")).toThrow(/refusing to emit/);
    expect(() => assertVanillaPath('say_"hi"/x', "test")).toThrow(/contains "\\""/);
    expect(() => assertVanillaPath("gfx/a\nb", "test")).toThrow(/refusing to emit/);
    expect(() => assertVanillaPath(`gfx/${"x".repeat(256)}.dds`, "test")).toThrow(
      /260-byte component, over the 255/
    );
  });

  it("names the context and quotes the candidate, so a failure is actionable", () => {
    expect(() => assertVanillaPath("a = b", "vanilla path")).toThrow(/^vanilla path: refusing/);
  });
});

describe("negative control", () => {
  it("refuses to emit an inventory carrying anything but a path", () => {
    expect(() =>
      emitVanillaPaths(["sound/ok.asset", "a = b"], createChokepoint(), "4.4.6")
    ).toThrow(/vanilla path: refusing to emit/);
  });

  it("refuses to emit an id set carrying anything but an identifier", () => {
    expect(() =>
      emitVanillaGfxIds(
        [{ registry: "spriteType", ids: ["GFX_ok", "The Grand Herald has arrived."] }],
        createChokepoint(),
        "4.4.6"
      )
    ).toThrow(/spriteType id: refusing to emit/);
  });

  it("fails to generate against an install whose names are localised text", () => {
    expect(() =>
      generateVanillaPackage({
        ...OPTIONS,
        installRoot: fileURLToPath(new URL("./fixtures/fake-install-poisoned", import.meta.url)),
      })
    ).toThrow(/sound id: refusing to emit "The Grand Herald has arrived\."/);
  });

  it("routes event namespace, local id, full id, scope, and kind through the chokepoint", () => {
    expect(() =>
      emitEventTrie(
        [
          {
            key: "country_event",
            subtype: "country",
            scope: "country",
            namespace: "safe",
            localId: "The Grand Herald has arrived",
            id: "safe.The Grand Herald has arrived",
            source: "events.txt",
          },
        ],
        createChokepoint(),
        "4.4.6"
      )
    ).toThrow(/event local id: refusing to emit/);
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
  /**
   * Two assertions, split by file on purpose. `paths.ts` carries paths, which
   * are the one emitted string a name-shaped gate would reject out of hand —
   * they have `/` separators and vanilla spends spaces in them. Every other
   * file carries identifiers, and applying the path gate to those would let a
   * localised sentence through. Each file gets the gate its own emitter used.
   */
  it("contains nothing the gate would not have let through", () => {
    let checked = 0;
    for (const [name, text] of generated.files) {
      const assert = name === "paths.ts" ? assertVanillaPath : assertVanillaIdentifier;
      for (const literal of identifierLiterals(text)) {
        expect(() => assert(literal, name)).not.toThrow();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("keeps every id and parameter table types-only", () => {
    for (const [name, text] of generated.files) {
      if (RUNTIME_FILES.has(name)) {
        continue;
      }
      expect(text, name).not.toMatch(/\bexport\s+(const|let|var|function|class|default|enum)\b/);
      for (const line of text.split("\n")) {
        if (!line.startsWith("import")) {
          continue;
        }
        expect(line.startsWith("import type "), name).toBe(true);
      }
    }
  });

  /**
   * The binding files are the package's only runtime, and this pins how little
   * of it there is. Every line is one `scriptedTrigger`/`scriptedEffect` call
   * naming a definition and the scope inferred for it — no bodies, no logic, no
   * data structure that could carry either. A generator change that started
   * emitting anything else would land here first.
   */
  it("keeps the binding files to one call per definition", () => {
    for (const name of BINDING_FILES) {
      const text = generated.files.get(name);
      expect(text, `${name} was not emitted`).toBeDefined();
      const body = text!
        .split("\n")
        .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("import"));
      expect(body.length, name).toBeGreaterThan(0);
      for (const line of body) {
        expect(line, name).toMatch(
          /^export const [A-Za-z_$][\w$]* = \/\*#__PURE__\*\/ scripted(Trigger|Effect)\("[\w.]+", (?:"[\w]+"|\["[\w]+"(?:, "[\w]+")*\])\);$/
        );
      }
    }
  });

  /**
   * The inventory is the package's third runtime file, and this pins that it
   * is a list of names and nothing more: two exported constants, one quoted
   * path per line, and the array's close. No sizes, no hashes, no contents —
   * a generator change that started carrying any of those would land here.
   */
  it("keeps the path inventory to one quoted path per line", () => {
    const text = generated.files.get("paths.ts");
    expect(text, "paths.ts was not emitted").toBeDefined();
    const body = text!.split("\n").filter((line) => line !== "" && !line.startsWith("//"));
    expect(body.length).toBeGreaterThan(3);
    expect(body[0]).toMatch(/^export const VANILLA_PATH_GAME_VERSION = "4\.4\.6";$/);
    expect(body[1]).toBe(
      "export const VANILLA_PATHS: readonly string[] = /*#__PURE__*/ Object.freeze(["
    );
    expect(body[body.length - 1]).toBe("]);");
    for (const line of body.slice(2, -1)) {
      expect(line).toMatch(/^ {2}"[^"\\]+",$/);
    }
  });

  /**
   * The fourth runtime file, pinned the same way and for the same reason: a
   * version stamp, one record of frozen string arrays, and one quoted id per
   * line. Ids are inside the licensing boundary already — every one of them
   * also ships as a member of that registry's id union — and this is what keeps
   * the runtime form from becoming somewhere a body could ride along.
   */
  it("keeps the mint-shaped id sets to one quoted id per line", () => {
    const text = generated.files.get("gfx-ids.ts");
    expect(text, "gfx-ids.ts was not emitted").toBeDefined();
    const body = text!.split("\n").filter((line) => line !== "" && !line.startsWith("//"));
    expect(body[0]).toMatch(/^export const VANILLA_GFX_ID_GAME_VERSION = "4\.4\.6";$/);
    expect(body[1]).toBe(
      "export const VANILLA_GFX_IDS: Readonly<Record<string, readonly string[]>> = " +
        "/*#__PURE__*/ Object.freeze({"
    );
    expect(body[body.length - 1]).toBe("});");
    for (const line of body.slice(2, -1)) {
      expect(line).toMatch(
        /^(?: {2}"[\w]+": \/\*#__PURE__\*\/ Object\.freeze\(\[| {4}"[^"\\]+",| {2}\]\),)$/
      );
    }
  });

  it("covers every mint-shaped registry, and only those", () => {
    const text = generated.files.get("gfx-ids.ts")!;
    const registries = [...text.matchAll(/^ {2}"([^"]+)":/gm)].map((match) => match[1]!);
    expect(registries).toEqual([...RUNTIME_ID_SET_REGISTRIES]);
  });

  it("keeps selected enum evidence to one quoted member per line", () => {
    const text = generated.files.get("enum-members.ts");
    expect(text, "enum-members.ts was not emitted").toBeDefined();
    const body = text!.split("\n").filter((line) => line !== "" && !line.startsWith("//"));
    expect(body[0]).toMatch(/^export const VANILLA_ENUM_MEMBER_GAME_VERSION = "4\.4\.6";$/);
    expect(body[1]).toContain("export const VANILLA_ENUM_MEMBERS:");
    expect(body).toContain('  "component_tag": /*#__PURE__*/ Object.freeze([');
    expect(body).toContain('    "fake_component_tag",');
    expect(body[body.length - 1]).toBe("});");
  });

  it("carries the fixture's walked files and archive entries, and none of its junk", () => {
    const text = generated.files.get("paths.ts")!;
    const paths = [...text.matchAll(/^ {2}"([^"]+)",$/gm)].map((match) => match[1]!);
    expect(paths).toContain("common/technology/00_fake_soc_tech.txt");
    expect(paths).toContain("dlc/fake_dlc01/fake_dlc01.zip");
    expect(paths).toContain("music/fake_dlc_track.ogg");
    expect(paths).not.toContain(".DS_Store");
    expect(paths).not.toContain("._junk");
    expect(paths).not.toContain("__MACOSX/music/._fake_dlc_track.ogg");
    expect(paths).toEqual([...paths].sort(compareIdentifiers));
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("emitVanillaPaths", () => {
  it("orders the inventory by UTF-8 bytes, not by UTF-16 code units", () => {
    // The one pair that separates the two orders: U+10000 is a supplementary
    // character whose UTF-8 bytes start at 0xF0, above U+E000's 0xEE, while its
    // UTF-16 surrogates (0xD800) sort *below* U+E000. JavaScript's `<` would
    // emit these the other way round, and the inventory's contract — the same
    // canonical order the scanner and the SDK's ledger use — would be broken
    // for the first non-ASCII path Paradox ships.
    const emitted = emitVanillaPaths(
      ["gfx/\u{10000}.dds", "gfx/\uE000.dds"],
      createChokepoint(),
      "4.4.6"
    );
    const order = [...emitted.matchAll(/^ {2}"(.+)",$/gm)].map((match) => match[1]!);
    expect(order).toEqual(["gfx/\uE000.dds", "gfx/\u{10000}.dds"]);
    expect([...order].sort()).not.toEqual(order);
  });
});

describe("compareIdentifiers", () => {
  it("orders by bytes, not by locale", () => {
    // `localeCompare` sorts "_" as if it were not there, so `a_b` would land
    // after `ab` on one machine and before it on another.
    expect(["ab", "a_b", "aB"].sort(compareIdentifiers)).toEqual(["aB", "a_b", "ab"]);
  });
});
