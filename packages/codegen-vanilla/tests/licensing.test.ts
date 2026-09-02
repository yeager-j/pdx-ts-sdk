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
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { describe, expect, it } from "vitest";

import { emitEventTrie } from "../src/emit-events.ts";
import {
  assertVanillaIdentifier,
  assertVanillaModuleStem,
  assertVanillaPath,
  compareIdentifiers,
  createChokepoint,
  emitTrie,
  emitVanillaGfxIds,
  emitVanillaLocalizationKeys,
  emitVanillaPaths,
} from "../src/emit.ts";
import { generateVanillaPackage } from "../src/generate.ts";
import { RUNTIME_ID_SET_REGISTRIES } from "../src/manifest.ts";
import { FAKE_INSTALL_UNMATCHED_COMPLEX_ENUMS } from "./fake-install.ts";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const OPTIONS = {
  installRoot: path.join(ROOT, "fixtures/fake-install"),
  gameVersion: "4.4.6",
  configRoot: path.join(ROOT, "vendor/cwtools-stellaris-config/config"),
  docsRoot: path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1"),
  trieThreshold: 5,
  allowedUnmatchedComplexEnums: FAKE_INSTALL_UNMATCHED_COMPLEX_ENUMS,
};

const generated = generateVanillaPackage(OPTIONS);

/**
 * The six files that carry runtime, and the only six. Everything else the
 * generator emits is types with zero payload. `triggers.ts` and `effects.ts`
 * hold one bound call per scripted definition (SDK-13); `paths.ts` holds the
 * install's path inventory, which is data because the SDK looks paths up at
 * build time rather than asking a compiler to hold a union of tens of
 * thousands of strings (SDK-173); `gfx-ids.ts` holds the mint-shaped
 * registries' ids, for the same reason one step over — a minted GFX name is
 * only known at build time, so the collision refusal is a lookup rather than a
 * type (SDK-121); `enum-members.ts` holds the selected complex-enum members
 * whose exact identity must take precedence over prefix-based ownership;
 * `localization-keys.ts` holds the localization key inventory, data for the
 * same reason `paths.ts` is and by a wider margin — 149,217 keys (SDK-307).
 */
const BINDING_FILES = new Set(["triggers.ts", "effects.ts"]);
const RUNTIME_FILES = new Set([
  ...BINDING_FILES,
  "paths.ts",
  "gfx-ids.ts",
  "enum-members.ts",
  "localization-keys.ts",
]);

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

describe("assertVanillaModuleStem", () => {
  it("passes the stems the install's own files and namespaces produce", () => {
    for (const stem of [
      "eventpictures",
      "tox-ships-moves",
      "toxoids",
      "magnetic-aurora",
      "utopia",
    ]) {
      expect(assertVanillaModuleStem(stem, "test")).toBe(stem);
    }
  });

  it("refuses anything that stops being one path component", () => {
    expect(() => assertVanillaModuleStem("../escape", "test")).toThrow(/contains "\/"/);
    expect(() => assertVanillaModuleStem("a\\b", "test")).toThrow(/contains "\\\\"/);
    expect(() => assertVanillaModuleStem(".hidden", "test")).toThrow(/starts with a "\."/);
    expect(() => assertVanillaModuleStem("trailing.", "test")).toThrow(/ends with a "\."/);
    expect(() => assertVanillaModuleStem("C:drive", "test")).toThrow(/contains ":"/);
    for (const character of ["*", "?", "<", ">", "|"]) {
      expect(() => assertVanillaModuleStem(`a${character}b`, "test")).toThrow(/refusing to emit/);
    }
  });

  it("refuses a space, though a name may spend two", () => {
    // `flags/backgrounds/00 solid.dds` is a real vanilla filename. A name like
    // that is fine as an id and must not quietly become `import "./00 solid.ts"`.
    expect(assertVanillaIdentifier("00 solid", "test")).toBe("00 solid");
    expect(() => assertVanillaModuleStem("00 solid", "test")).toThrow(/contains " "/);
  });

  it("inherits every rule that separates a name from a body", () => {
    // Layered rather than restated, so a change to the identifier gate reaches
    // here without anyone copying it across.
    expect(() => assertVanillaModuleStem("has_country_flag = x", "test")).toThrow(/contains "="/);
    expect(() => assertVanillaModuleStem("a{b", "test")).toThrow(/contains "\{"/);
    expect(() => assertVanillaModuleStem("has_trait_$TRAIT$", "test")).toThrow(/contains "\$"/);
    expect(() => assertVanillaModuleStem("", "test")).toThrow(/empty/);
  });

  it("refuses the names Windows reserves for devices", () => {
    // `con`, `nul` and `com1` are all spellings the event reader's namespace
    // rule accepts, and `events/con.ts` cannot be created on Windows whatever
    // extension it carries.
    for (const device of ["con", "CON", "nul", "aux", "prn", "com1", "lpt9", "Con"]) {
      expect(() => assertVanillaModuleStem(device, "test"), device).toThrow(/reserves/);
    }
    // The reservation covers the basename, so a suffix does not escape it.
    expect(() => assertVanillaModuleStem("con.backup", "test")).toThrow(/reserves/);
    // Names that merely start with one are fine.
    expect(assertVanillaModuleStem("console", "test")).toBe("console");
    expect(assertVanillaModuleStem("com10", "test")).toBe("com10");
  });

  it("leaves room for the extension it knows will be appended", () => {
    // The emitters append `.ts` straight after this returns, so a stem that
    // exactly fills the 255-byte component limit produces a filename three
    // bytes over it.
    //
    // Measured in bytes rather than characters, which is the only way the
    // limit is reachable at all: the identifier gate caps a name at 120 UTF-16
    // units first, so no ASCII stem gets near 255 bytes. A 3-byte character
    // does — 85 of them is 255 bytes and well inside that cap.
    const wide = "一";
    expect(assertVanillaModuleStem(wide.repeat(84), "test")).toHaveLength(84);
    expect(() => assertVanillaModuleStem(wide.repeat(85), "test")).toThrow(
      /255 bytes, over the 252/
    );
  });

  it("is stricter than the path gate, which allows the separators it refuses", () => {
    // The two are not interchangeable, and this is the pair that says so: a
    // path is many components and a stem is one.
    const traversal = "gfx/models/ship.mesh";
    expect(assertVanillaPath(traversal, "test")).toBe(traversal);
    expect(() => assertVanillaModuleStem(traversal, "test")).toThrow(/contains "\/"/);
  });
});

describe("negative control", () => {
  it("refuses to emit an inventory carrying anything but a path", () => {
    expect(() =>
      emitVanillaPaths(
        ["sound/ok.asset", "a = b"],
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createChokepoint(),
        "4.4.6"
      )
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

  it("refuses to emit a localization inventory carrying anything but a key", () => {
    expect(() =>
      emitVanillaLocalizationKeys(
        ["FAKE_TECH_NAME", "The Grand Herald has arrived."],
        createChokepoint(),
        "4.4.6"
      )
    ).toThrow(/localization key: refusing to emit/);
  });

  it("fails to generate against an install whose names are localised text", () => {
    expect(() =>
      generateVanillaPackage({
        ...OPTIONS,
        installRoot: fileURLToPath(new URL("./fixtures/fake-install-poisoned", import.meta.url)),
        allowedUnmatchedComplexEnums: [...loadRules(OPTIONS.configRoot).complexEnums.keys()],
      })
    ).toThrow(/sound id: refusing to emit "The Grand Herald has arrived\."/);
  });

  it("refuses to name an event module after a namespace that escapes its directory", () => {
    // The namespace is install text and it names a file. `read-events.ts`
    // rejects this spelling too, but the boundary must not rest on that: the
    // gate is what makes the escape impossible rather than merely unobserved.
    expect(() =>
      emitEventTrie(
        [
          {
            key: "country_event",
            subtype: "country",
            scope: "country",
            namespace: "../../../etc/passwd",
            localId: "1",
            id: "safe.1",
            source: "events.txt",
          },
        ],
        createChokepoint(),
        "4.4.6"
      )
    ).toThrow(/event namespace file stem: refusing to emit/);
  });

  it("refuses to name a trie bucket file after a key that escapes its directory", () => {
    const buckets = new Map([
      ["../../escape", { id: null, children: new Map([["x", { id: "x", children: new Map() }]]) }],
    ]);

    expect(() => emitTrie("sound", "sound", buckets, createChokepoint(), "4.4.6")).toThrow(
      /file stem: refusing to emit/
    );
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
 * Every `import`/`export … from "…"` specifier, and every bare `import "…"`.
 *
 * Read off the statements rather than recognised by prefix, which is what this
 * used to do. A prefix test answers "does this look like the specifiers we
 * currently emit", and the question is "is this a specifier": `"../shared.ts"`
 * and `"typescript"` match neither `./` nor `@pdx-ts/`, and both pass
 * {@link assertVanillaIdentifier} — so an emitter that added either would have
 * had its specifier waved through as an ordinary name.
 */
const MODULE_SPECIFIER =
  /(?:^|\n)[ \t]*(?:import|export)\b[^;\n]*?\bfrom[ \t]*["']([^"']+)["']|(?:^|\n)[ \t]*import[ \t]+["']([^"']+)["']/g;

function moduleSpecifiers(text: string): string[] {
  // Two forms, and only these two: a `from` clause, or a bare side-effect
  // `import "…"`. Requiring one of them is what keeps
  // `export const NAME = "not_a_specifier";` out.
  return [...text.matchAll(MODULE_SPECIFIER)].map((match) => match[1] ?? match[2]!);
}

/**
 * Every quoted string that is not part of an import or export statement.
 *
 * The statements are removed by position rather than by matching their
 * specifier text, so a literal that happens to spell one is still inspected.
 */
function quotedLiterals(text: string): string[] {
  const withoutStatements = text.replace(MODULE_SPECIFIER, "\n");
  return [...withoutStatements.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((match) => match[1]!);
}

/**
 * The only packages this generator imports from, spelled out.
 *
 * A bare specifier is generator-owned by construction — no install string
 * becomes one — so the check that matters is that the set has not grown, not
 * that each member is name-shaped.
 */
const ALLOWED_PACKAGES = new Set(["@pdx-ts/sdk/stellaris"]);

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
      for (const literal of quotedLiterals(text)) {
        expect(() => assert(literal, name)).not.toThrow();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  /**
   * The leg this suite used to be missing. Module specifiers were discarded on
   * the premise that they are entirely generator-owned, and two kinds are not:
   * an oversized registry's bucket files are named after the install's own
   * files and directories, and an event namespace file is named after a
   * namespace read out of a shipped event id.
   *
   * Every component of every relative specifier passes the stem gate, so this
   * covers the segments the emitters choose as well as the ones the install
   * does — the check does not have to know which is which, which is the point.
   */
  it("names its modules with nothing the gate would not have let through", () => {
    let checked = 0;
    for (const [name, text] of generated.files) {
      for (const specifier of moduleSpecifiers(text)) {
        // Relative or allow-listed, with nothing in between: a bare specifier
        // that is not on the list fails here rather than being read as a name.
        if (!specifier.startsWith("./")) {
          expect(ALLOWED_PACKAGES.has(specifier), `${name} imports ${specifier}`).toBe(true);
          continue;
        }
        expect(specifier, name).toMatch(/\.ts$/);
        for (const segment of specifier.slice("./".length, -".ts".length).split("/")) {
          expect(() => assertVanillaModuleStem(segment, name)).not.toThrow();
          checked += 1;
        }
      }
    }
    // The fixture emits event namespace files, trie bucket files, and the
    // barrel's re-exports, so a number this low would mean the walk found
    // nothing rather than that everything passed.
    expect(checked).toBeGreaterThan(20);
  });

  /**
   * The predicate this check rests on, tested rather than assumed.
   *
   * The previous version recognised specifiers by their prefix, and the two
   * shapes below are the ones that slipped through: neither starts `./` or
   * `@pdx-ts/`, and both pass the identifier gate, so an emitter that added an
   * unapproved package or a path escaping the output directory would not have
   * been noticed.
   */
  it("recognises a specifier by its statement, not by how it starts", () => {
    const module = [
      'import type { A } from "../shared.ts";',
      'import { b } from "typescript";',
      'export type { C } from "./registries/technology.ts";',
      'import "./side-effect.ts";',
      'export const NAME = "not_a_specifier";',
    ].join("\n");

    expect(moduleSpecifiers(module)).toEqual([
      "../shared.ts",
      "typescript",
      "./registries/technology.ts",
      "./side-effect.ts",
    ]);
    expect(quotedLiterals(module)).toEqual(["not_a_specifier"]);
    // Both would have been read as ordinary identifiers before, and both pass.
    expect(assertVanillaIdentifier("../shared.ts", "test")).toBe("../shared.ts");
    expect(assertVanillaIdentifier("typescript", "test")).toBe("typescript");
  });

  /**
   * Every emitted file is reachable by the name something imports it under.
   *
   * The gate says a specifier is well shaped; this says it points at a file
   * that exists. A stem that passed inspection and then got mangled — by
   * case-folding, by a uniquing suffix applied on one side only — would leave
   * a package that type-checks nowhere, and the gate alone would not see it.
   */
  it("imports only modules it emitted", () => {
    for (const [name, text] of generated.files) {
      const dir = name.includes("/") ? `${name.slice(0, name.lastIndexOf("/"))}/` : "";
      for (const specifier of quotedLiterals(text).filter((one) => one.startsWith("./"))) {
        const target = `${dir}${specifier.slice("./".length)}`;
        expect(generated.files.has(target), `${name} imports missing ${target}`).toBe(true);
      }
    }
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
   * is a list of names and nothing more: three exported constants, one quoted
   * path per line, and the array's close. No per-path sizes, hashes, or contents
   * — a generator change that started carrying any of those would land here.
   */
  it("keeps the path inventory to one quoted path per line", () => {
    const text = generated.files.get("paths.ts");
    expect(text, "paths.ts was not emitted").toBeDefined();
    const body = text!.split("\n").filter((line) => line !== "" && !line.startsWith("//"));
    expect(body.length).toBeGreaterThan(3);
    expect(body[0]).toMatch(/^export const VANILLA_PATH_GAME_VERSION = "4\.4\.6";$/);
    expect(body.slice(1, 12)).toEqual([
      "/**",
      " * SHA-256 fingerprint of the install data projected into this package.",
      " *",
      " * Covers relative paths and bytes of parsed event, registry, complex-enum, and",
      " * scripted-definition files, all emitted install path names (including DLC",
      " * archive entries), and all emitted English localization keys. It excludes CWT",
      " * rules, script documentation, game version, and generator code, so it is not",
      " * a hash of generated package bytes.",
      " *",
      " * Compare values only when those excluded inputs are unchanged.",
      " */",
    ]);
    expect(body[12]).toMatch(/^export const VANILLA_INSTALL_EVIDENCE_SHA256 = "[0-9a-f]{64}";$/);
    expect(body[13]).toBe(
      "export const VANILLA_PATHS: readonly string[] = /*#__PURE__*/ Object.freeze(["
    );
    expect(body[body.length - 1]).toBe("]);");
    for (const line of body.slice(14, -1)) {
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

  /**
   * The largest runtime file, pinned the same way — and here the pin is doing
   * the most work of any of them. Its source is the one place in the install
   * where a name and the localized text it holds sit on the same line, so
   * "one quoted key per line" is what says the reader stopped at the colon.
   */
  it("keeps the localization inventory to one quoted key per line", () => {
    const text = generated.files.get("localization-keys.ts");
    expect(text, "localization-keys.ts was not emitted").toBeDefined();
    const body = text!.split("\n").filter((line) => line !== "" && !line.startsWith("//"));
    expect(body[0]).toMatch(/^export const VANILLA_LOCALIZATION_GAME_VERSION = "4\.4\.6";$/);
    expect(body[1]).toBe(
      "export const VANILLA_LOCALIZATION_KEYS: readonly string[] = /*#__PURE__*/ Object.freeze(["
    );
    expect(body[body.length - 1]).toBe("]);");
    for (const line of body.slice(2, -1)) {
      expect(line).toMatch(/^ {2}"[A-Za-z0-9_][A-Za-z0-9_.'-]*",$/);
    }
  });

  it("carries the fixture's keys, including one that opens like a language header", () => {
    const text = generated.files.get("localization-keys.ts")!;
    const keys = [...text.matchAll(/^ {2}"([^"]+)",$/gm)].map((match) => match[1]!);
    expect(keys).toEqual([
      "FAKE_TECH_DESC",
      "FAKE_TECH_NAME",
      "fake.dotted-key",
      "fake_apostrophe's_key",
      // `l_english:` is the header and `l_slot` is a key. Only the trailing
      // quoted value tells them apart, so a prefix test would drop this one.
      "l_slot",
    ]);
    // The text those keys hold is on the same source line as the key itself.
    expect(text).not.toContain("Fake Technology");
    expect(text).not.toContain("never crosses the boundary");
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
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
