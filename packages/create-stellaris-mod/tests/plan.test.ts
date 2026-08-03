/**
 * The scaffold as a value. Everything here runs against `planFiles`, with no
 * filesystem — which is the point of keeping the plan pure.
 */

import { describe, expect, it } from "vitest";

import type { Resolved } from "../src/options.ts";
import { planFiles } from "../src/plan.ts";

const base: Resolved = {
  targetDir: "/tmp/my-mod",
  name: "My Mod",
  prefix: "my_mod",
  supportedVersion: "v4.4.*",
  tags: ["Technologies"],
  installPath: "/games/Stellaris",
  installPathIsExplicit: false,
  gameVersion: "4.4.6",
  localSdk: undefined,
  prettier: true,
  eslint: true,
  git: true,
  install: true,
  packageManager: "npm",
};

function plan(overrides: Partial<Resolved> = {}): Map<string, string> {
  return planFiles({ ...base, ...overrides }, "my-mod");
}

function manifest(files: Map<string, string>): Record<string, Record<string, string>> {
  return JSON.parse(files.get("package.json")!) as Record<string, Record<string, string>>;
}

describe("the scaffolded tree", () => {
  it("is the same set of files every time", () => {
    expect([...plan().keys()]).toEqual([
      ".gitignore",
      ".prettierrc",
      "README.md",
      "eslint.config.js",
      "package.json",
      "src/content/example.test.ts",
      "src/content/example.ts",
      "src/flags.ts",
      "src/index.ts",
      "src/install.ts",
      "src/vanilla.ts",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
  });

  it("drops the opt-outs and their dependencies together", () => {
    const files = plan({ prettier: false, eslint: false });
    expect(files.has(".prettierrc")).toBe(false);
    expect(files.has("eslint.config.js")).toBe(false);

    const { devDependencies, scripts } = manifest(files) as unknown as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // A devDependency for a tool that was declined is dead weight, and a script
    // invoking a binary nobody installed is worse.
    expect(devDependencies["prettier"]).toBeUndefined();
    expect(devDependencies["eslint"]).toBeUndefined();
    expect(devDependencies["typescript-eslint"]).toBeUndefined();
    expect(scripts["format"]).toBeUndefined();
    expect(scripts["lint"]).toBeUndefined();
  });

  it("omits src/vanilla.ts when there is no install to load", () => {
    // The module's whole body is `stellaris.load()`; shipping it without an
    // install would put a file in the project that cannot do its job.
    const files = plan({ installPath: undefined, gameVersion: undefined });
    expect(files.has("src/vanilla.ts")).toBe(false);
    expect(files.get("src/index.ts")).not.toContain("./vanilla.ts");
  });

  it("emits strict JSON where the format is strict", () => {
    for (const relPath of ["package.json", ".prettierrc"]) {
      expect(() => JSON.parse(plan().get(relPath)!), relPath).not.toThrow();
    }
  });

  it("emits a tsconfig that parses once its comments are stripped", () => {
    // tsconfig.json is JSONC by convention and the comments in it are load
    // bearing — they explain why four of the compiler options are not style.
    const stripped = plan()
      .get("tsconfig.json")!
      .replace(/^\s*\/\/.*$/gm, "");
    expect(() => JSON.parse(stripped)).not.toThrow();
  });

  it("leaves no unsubstituted interpolation behind", () => {
    // A template reading a field that is not on `Resolved` lands in the file as
    // the literal text `undefined`. Matched by shape rather than by the bare
    // word, because generated code legitimately writes `vanilla === undefined`
    // — the giveaway is `undefined` sitting where a *value* belongs: quoted, or
    // welded to an identifier.
    const accidental = /"undefined"|_undefined|undefined_|: undefined[,\n]/;
    for (const [relPath, contents] of plan()) {
      expect(contents, `${relPath} interpolated undefined`).not.toMatch(accidental);
      expect(contents, relPath).not.toContain("[object Object]");
    }
  });

  it("carries the author's prefix into every place the SDK will read it", () => {
    const files = plan({ prefix: "aurora", name: "Aurora" });
    expect(files.get("src/index.ts")).toContain('prefix: "aurora"');
    expect(files.get("src/flags.ts")).toContain('countryFlags("aurora_welcomed")');
    expect(files.get("src/content/example.ts")).toContain('id: "aurora_tech_first_steps"');
    expect(files.get("src/content/example.ts")).toContain('namespace("aurora")');
    expect(files.get("src/content/example.test.ts")).toContain("aurora_welcomed");
  });

  it("quotes a mod name that would otherwise break the file it lands in", () => {
    expect(plan({ name: 'The "Real" Mod' }).get("src/index.ts")).toContain(
      'name: "The \\"Real\\" Mod"'
    );
  });
});

describe("dependency resolution", () => {
  it("uses registry ranges by default", () => {
    const { dependencies } = manifest(plan());
    expect(dependencies!["@pdx-ts/sdk"]).toMatch(/^\^/);
    expect(dependencies!["@pdx-ts/pdxscript"]).toBeUndefined();
  });

  it("rewrites to file: links against a local checkout", () => {
    // npm materializes a file: dependency as a symlink, whose realpath escapes
    // node_modules — the only reason Node will strip types from the SDK's raw
    // .ts sources at all.
    const { dependencies } = manifest(plan({ localSdk: "/repo/pdx-sdk" }));
    expect(dependencies!["@pdx-ts/sdk"]).toBe("file:/repo/pdx-sdk/packages/sdk");
    expect(dependencies!["@pdx-ts/pdxscript"]).toBe("file:/repo/pdx-sdk/packages/pdxscript");
  });

  it("pins the identifier package to the exact detected build", () => {
    // Its npm version *is* the game version, so a range would be meaningless.
    const { dependencies } = manifest(plan({ gameVersion: "4.4.6" }));
    expect(dependencies!["@pdx-ts/stellaris-ids"]).toBe("4.4.6");
  });

  it("omits the identifier package when no build was detected", () => {
    const { dependencies } = manifest(plan({ installPath: undefined, gameVersion: undefined }));
    expect(dependencies!["@pdx-ts/stellaris-ids"]).toBeUndefined();
    expect(
      plan({ installPath: undefined, gameVersion: undefined }).get("src/index.ts")
    ).not.toContain("@pdx-ts/stellaris-ids");
  });

  it("omits it for a build npm cannot express, rather than pinning nonsense", () => {
    const { dependencies } = manifest(plan({ gameVersion: "4.4.6.1" }));
    expect(dependencies!["@pdx-ts/stellaris-ids"]).toBeUndefined();
  });

  it("does not import a package it declined to add", () => {
    // A four-part Paradox version has no npm counterpart, so the dependency is
    // omitted — and the side-effect import has to be omitted with it, or the
    // scaffold fails on a missing package instead of degrading to unchecked
    // strings the way a no-install scaffold does.
    for (const gameVersion of [undefined, "4.4.6.1"]) {
      const files = plan({ gameVersion });
      const { dependencies } = manifest(files);
      expect(dependencies!["@pdx-ts/stellaris-ids"], String(gameVersion)).toBeUndefined();
      expect(files.get("src/index.ts"), String(gameVersion)).not.toContain("@pdx-ts/stellaris-ids");
    }
  });

  it("requires the Node version its own build script needs", () => {
    // `npm run build` is `node src/index.ts`, which needs type stripping.
    expect(manifest(plan())["engines"]!["node"]).toBe(">=22.18.0");
  });
});

describe("the vanilla view the project loads", () => {
  it("bakes in a path the author named, since detection would miss it", () => {
    const vanilla = plan({ installPath: "/weird/place", installPathIsExplicit: true }).get(
      "src/vanilla.ts"
    )!;
    expect(vanilla).toContain('const SCAFFOLDED_INSTALL = "/weird/place"');
    // STELLARIS_PATH has to win: `load({ installPath })` outranks the env var,
    // so a teammate could not otherwise override a path off their machine.
    expect(vanilla).toContain('process.env["STELLARIS_PATH"] ? {} : { installPath:');
  });

  it("bakes in nothing when detection found the install on its own", () => {
    // The generated project's own detection will find it again, and an absolute
    // machine path in a committed file is noise a teammate has to delete.
    const vanilla = plan({ installPathIsExplicit: false }).get("src/vanilla.ts")!;
    expect(vanilla).not.toContain("SCAFFOLDED_INSTALL");
    expect(vanilla).toContain("stellaris.load()");
  });
});

describe("the generated sources", () => {
  it("keeps tests colocated and configures vitest to find them there", () => {
    expect(plan().get("vitest.config.ts")).toContain('include: ["src/**/*.test.ts"]');
  });

  it("lints the one-namespace-per-file bijection", () => {
    const config = plan().get("eslint.config.js")!;
    expect(config).toContain("pdx/one-namespace-per-file");
    expect(config).toContain("CallExpression[callee.name='namespace']");
  });

  it("imports the matchers nowhere, so the vitest peer dep stays optional", () => {
    // The matcher pack is the only part of the SDK that imports vitest. Keeping
    // it out of the default scaffold means SDK-28's eventual package split is a
    // one-line change in the README rather than in every scaffolded project.
    for (const [relPath, contents] of plan()) {
      if (relPath === "README.md") {
        continue; // Prose about the opt-in, not an import.
      }
      expect(contents, relPath).not.toContain("@pdx-ts/sdk-testing/matchers");
    }
    expect(plan().get("README.md")).toContain("@pdx-ts/sdk-testing/matchers");
  });
});
