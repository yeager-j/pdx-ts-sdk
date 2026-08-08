/**
 * The Project Manifest: what the adapter accepts, and the two other things that
 * have to agree with it.
 *
 * There are three statements of the manifest's shape, and only one of them can
 * be the authority a reviewer reads. `parseManifest` is that one. The emitted
 * JSON schema is the editor's copy, so the corpus below runs through both and
 * the accept/reject verdicts must match exactly — a schema that is merely
 * *nearly* right shows up as an in-editor error on a manifest the CLI takes, or
 * worse, as silence on one it refuses. `ProjectModConfig` is the third, and the
 * type-level checks pin it to the SDK's real `ModConfig` in both directions, so
 * a field added there breaks a test here rather than a stranger's project.
 *
 * ajv is a devDependency and stays one: the runtime adapter is hand-rolled
 * because this package has no runtime dependency on the SDK and wants none on a
 * validator either.
 */

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import type { ModConfig } from "../../sdk/src/compiler/config.ts";
import { ManifestError, parseManifest, type ProjectModConfig } from "../src/manifest.ts";
import type { Resolved } from "../src/options.ts";
import { manifestJson, manifestSchema } from "../src/templates/manifest.ts";

const require = createRequire(import.meta.url);
// ajv 8 is CommonJS whose `module.exports` is the class itself, so the named
// require is the one form that means the same thing under Node and under Vite.
const { Ajv2020 } = require("ajv/dist/2020.js") as typeof import("ajv/dist/2020.js");

const SOURCE = "/project/stellaris-mod.json";

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** The smallest accepted manifest, as a starting point for the invalid ones. */
const MINIMAL = {
  mod: { my_mod: { name: "My Mod", supportedVersion: "v4.4.*" } },
  contentDirectory: "src/content",
};

function withMod(config: unknown, prefix = "my_mod"): string {
  return json({ mod: { [prefix]: config }, contentDirectory: "src/content" });
}

interface Case {
  readonly name: string;
  readonly bytes: string;
  readonly valid: boolean;
}

/**
 * One corpus, two validators. Every case is a manifest an author could
 * plausibly hand-write or hand-break.
 */
const CORPUS: readonly Case[] = [
  { name: "the minimal manifest", bytes: json(MINIMAL), valid: true },
  {
    name: "everything the SDK's config carries",
    bytes: json({
      $schema: "./stellaris-mod.schema.json",
      mod: {
        my_mod: {
          name: "My Mod",
          version: "1.2.3",
          supportedVersion: "v4.4.*",
          tags: ["Technologies", "Events"],
          acceptGameVersion: "4.4.7",
          uncheckedVanillaIds: true,
        },
      },
      contentDirectory: "src/content",
    }),
    valid: true,
  },
  {
    name: "a prefix with digits and underscores",
    bytes: withMod(MINIMAL.mod.my_mod, "a_1_b"),
    valid: true,
  },
  {
    name: "a nested content directory",
    bytes: json({ ...MINIMAL, contentDirectory: "src/features/content" }),
    valid: true,
  },

  { name: "bytes that are not JSON at all", bytes: "{ mod: }", valid: false },
  { name: "an empty file", bytes: "", valid: false },
  { name: "a JSON array", bytes: "[]", valid: false },
  { name: "JSON null", bytes: "null", valid: false },
  { name: "a JSON string", bytes: '"my_mod"', valid: false },
  { name: "no mod key", bytes: json({ contentDirectory: "src/content" }), valid: false },
  { name: "no contentDirectory key", bytes: json({ mod: MINIMAL.mod }), valid: false },
  {
    name: "an unknown top-level key",
    bytes: json({ ...MINIMAL, recipes: ["technology"] }),
    valid: false,
  },
  { name: "mod as an array", bytes: json({ ...MINIMAL, mod: [] }), valid: false },
  { name: "mod as a string", bytes: json({ ...MINIMAL, mod: "my_mod" }), valid: false },
  { name: "no mod entries", bytes: json({ ...MINIMAL, mod: {} }), valid: false },
  {
    name: "two mod entries",
    bytes: json({
      ...MINIMAL,
      mod: { my_mod: MINIMAL.mod.my_mod, other_mod: MINIMAL.mod.my_mod },
    }),
    valid: false,
  },
  {
    name: "a prefix starting with a digit",
    bytes: withMod(MINIMAL.mod.my_mod, "4x"),
    valid: false,
  },
  { name: "a prefix with capitals", bytes: withMod(MINIMAL.mod.my_mod, "MyMod"), valid: false },
  { name: "a prefix with a dash", bytes: withMod(MINIMAL.mod.my_mod, "my-mod"), valid: false },
  { name: "an empty prefix", bytes: withMod(MINIMAL.mod.my_mod, ""), valid: false },
  { name: "a mod entry that is an array", bytes: withMod([]), valid: false },
  { name: "a mod entry that is a string", bytes: withMod("My Mod"), valid: false },
  { name: "no name", bytes: withMod({ supportedVersion: "v4.4.*" }), valid: false },
  { name: "no supportedVersion", bytes: withMod({ name: "My Mod" }), valid: false },
  {
    name: "an unknown field on the mod entry",
    bytes: withMod({ ...MINIMAL.mod.my_mod, prefix: "my_mod" }),
    valid: false,
  },
  { name: "a numeric name", bytes: withMod({ ...MINIMAL.mod.my_mod, name: 7 }), valid: false },
  {
    name: "a numeric version",
    bytes: withMod({ ...MINIMAL.mod.my_mod, version: 1 }),
    valid: false,
  },
  {
    name: "a non-string supportedVersion",
    bytes: withMod({ name: "My Mod", supportedVersion: 4.4 }),
    valid: false,
  },
  {
    name: "tags as a comma-separated string",
    bytes: withMod({ ...MINIMAL.mod.my_mod, tags: "Technologies,Events" }),
    valid: false,
  },
  {
    name: "a tag that is not a string",
    bytes: withMod({ ...MINIMAL.mod.my_mod, tags: ["Technologies", 7] }),
    valid: false,
  },
  {
    name: "uncheckedVanillaIds as a string",
    bytes: withMod({ ...MINIMAL.mod.my_mod, uncheckedVanillaIds: "yes" }),
    valid: false,
  },
  {
    name: "a non-string acceptGameVersion",
    bytes: withMod({ ...MINIMAL.mod.my_mod, acceptGameVersion: 4.4 }),
    valid: false,
  },
  {
    name: "a numeric contentDirectory",
    bytes: json({ ...MINIMAL, contentDirectory: 7 }),
    valid: false,
  },
  {
    name: "an empty contentDirectory",
    bytes: json({ ...MINIMAL, contentDirectory: "" }),
    valid: false,
  },
];

function accepts(bytes: string): boolean {
  try {
    parseManifest(bytes, SOURCE);
    return true;
  } catch (error) {
    expect(error, "every rejection is a ManifestError").toBeInstanceOf(ManifestError);
    return false;
  }
}

describe("parseManifest", () => {
  it.each(CORPUS)("$valid for $name", ({ bytes, valid }) => {
    expect(accepts(bytes)).toBe(valid);
  });

  it("recovers the prefix and the config the SDK needs", () => {
    const manifest = parseManifest(CORPUS[1]!.bytes, SOURCE);
    expect(manifest.prefix).toBe("my_mod");
    expect(manifest.contentDirectory).toBe("src/content");
    expect(manifest.sourcePath).toBe(SOURCE);
    expect(manifest.config).toEqual({
      name: "My Mod",
      version: "1.2.3",
      supportedVersion: "v4.4.*",
      tags: ["Technologies", "Events"],
      acceptGameVersion: "4.4.7",
      uncheckedVanillaIds: true,
    });
  });

  it("omits absent optional fields rather than carrying undefined", () => {
    // `exactOptionalPropertyTypes` is not what makes this matter — a config
    // spread into `createMod` with an explicit `version: undefined` is a
    // different value from one without the key, and only one of them round
    // trips through JSON.
    const manifest = parseManifest(json(MINIMAL), SOURCE);
    expect(Object.keys(manifest.config)).toEqual(["name", "supportedVersion"]);
  });

  it("copies tags rather than aliasing the parsed array", () => {
    const manifest = parseManifest(
      withMod({ ...MINIMAL.mod.my_mod, tags: ["Technologies"] }),
      SOURCE
    );
    manifest.config.tags!.push("Events");
    expect(
      parseManifest(withMod({ ...MINIMAL.mod.my_mod, tags: ["Technologies"] }), SOURCE).config.tags
    ).toEqual(["Technologies"]);
  });

  it("names the file and the fault, because a manifest is edited by hand", () => {
    // "invalid manifest" is not a repair instruction. Each message has to say
    // which file, and which thing in it.
    const faults: ReadonlyArray<readonly [string, RegExp]> = [
      ["{", /is not valid JSON/],
      [json({ ...MINIMAL, mod: {} }), /"mod" must hold exactly one entry, and holds 0/],
      [withMod(MINIMAL.mod.my_mod, "My-Mod"), /"My-Mod" must be lowercase snake_case/],
      [withMod({ supportedVersion: "v4.4.*" }), /mod\.my_mod has no "name" field/],
      [json({ ...MINIMAL, recipes: [] }), /unknown key "recipes"/],
      [
        json({ ...MINIMAL, contentDirectory: 7 }),
        /"contentDirectory" must be a string, and is a number/,
      ],
    ];
    for (const [bytes, pattern] of faults) {
      expect(() => parseManifest(bytes, SOURCE)).toThrow(pattern);
      expect(() => parseManifest(bytes, SOURCE)).toThrow(SOURCE);
    }
  });
});

describe("the emitted JSON schema", () => {
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(manifestSchema()) as Record<string, unknown>
  );

  it.each(CORPUS.filter((entry) => parses(entry.bytes)))(
    "agrees with parseManifest about $name",
    ({ bytes, valid }) => {
      // The verdicts must match exactly. A schema that is merely nearly right
      // shows an in-editor error on a manifest the CLI takes, or stays silent
      // on one it refuses.
      expect(validate(JSON.parse(bytes))).toBe(valid);
      expect(accepts(bytes)).toBe(valid);
    }
  );

  it("is the 2020-12 dialect the editor will look for", () => {
    const schema = JSON.parse(manifestSchema()) as { $schema: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});

function parses(bytes: string): boolean {
  try {
    JSON.parse(bytes);
    return true;
  } catch {
    return false;
  }
}

describe("the manifest init writes", () => {
  const resolved: Resolved = {
    targetDir: "/tmp/my-mod",
    name: 'The "Real" Mod',
    prefix: "my_mod",
    supportedVersion: "v4.4.*",
    tags: ["Technologies"],
    installPath: undefined,
    installPathIsExplicit: false,
    gameVersion: undefined,
    localSdk: undefined,
    prettier: true,
    eslint: true,
    git: true,
    install: true,
    packageManager: "npm",
  };

  it("parses with the adapter generate will read it with", () => {
    // The emitter and the reader are different modules and this is the only
    // thing that makes them one contract.
    const manifest = parseManifest(manifestJson(resolved), SOURCE);
    expect(manifest.prefix).toBe("my_mod");
    expect(manifest.config).toEqual({
      name: 'The "Real" Mod',
      version: "0.1.0",
      supportedVersion: "v4.4.*",
      tags: ["Technologies"],
    });
    expect(manifest.contentDirectory).toBe("src/content");
  });

  it("points at the schema it ships beside", () => {
    const emitted = JSON.parse(manifestJson(resolved)) as { $schema: string };
    expect(emitted.$schema).toBe("./stellaris-mod.schema.json");
    expect(
      new Ajv2020({ strict: true }).validate(
        JSON.parse(manifestSchema()) as Record<string, unknown>,
        JSON.parse(manifestJson(resolved))
      )
    ).toBe(true);
  });
});

/**
 * `ProjectModConfig` restates the SDK's `ModConfig` minus `prefix`, because the
 * CLI must not take a runtime dependency on the SDK. Restating a type is only
 * safe when something checks the restatement, so these are compile-time
 * assertions against the real one — in both directions, plus key-set equality,
 * which is what catches an optional field going missing.
 */
type SdkConfig = Omit<ModConfig, "prefix">;
type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type _KeysMatch = Assert<Mutual<keyof ProjectModConfig, keyof SdkConfig>>;

describe("ProjectModConfig", () => {
  it("is assignable to and from the SDK's ModConfig minus prefix", () => {
    const fromManifest: ProjectModConfig = { name: "My Mod", supportedVersion: "v4.4.*" };
    const asSdkConfig: SdkConfig = fromManifest;
    const backAgain: ProjectModConfig = asSdkConfig;
    expect(backAgain).toBe(fromManifest);
  });

  it("carries every optional field the SDK's config has", () => {
    const full: Required<ProjectModConfig> = {
      name: "My Mod",
      version: "0.1.0",
      supportedVersion: "v4.4.*",
      tags: [],
      acceptGameVersion: "4.4.6",
      uncheckedVanillaIds: false,
    };
    const asSdkConfig: Required<SdkConfig> = full;
    expect(Object.keys(asSdkConfig).sort()).toEqual(Object.keys(full).sort());
  });
});
