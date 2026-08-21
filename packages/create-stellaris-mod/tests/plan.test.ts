/**
 * The scaffold as a value. Everything here runs against `planProject`, with no
 * filesystem — which is the point of keeping the plan pure.
 */

import { createHash } from "node:crypto";
import { vanillaPackageInstallRange } from "@pdx-ts/sdk";
import semver from "semver";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { VERIFIED_STELLARIS_BUILD } from "../src/generated/verified-build.ts";
import type { Resolved } from "../src/options.ts";
import { planProject, type ProjectEntry } from "../src/plan.ts";
import { SCAFFOLDER_RELEASE_MANIFEST } from "../src/release-manifest.ts";
import { checkSdkCompatibility } from "../src/sdk-range.ts";
import { idsRange } from "../src/templates/project.ts";

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
  llmSupport: true,
  git: true,
  install: true,
  packageManager: "npm",
};

function project(overrides: Partial<Resolved> = {}): Map<string, ProjectEntry> {
  return planProject({ ...base, ...overrides }, "my-mod");
}

function plan(overrides: Partial<Resolved> = {}): Map<string, string> {
  return new Map(
    [...project(overrides)].map(([relPath, entry]) => [
      relPath,
      entry.kind === "file" ? entry.contents : `-> ${entry.target}`,
    ])
  );
}

function manifest(files: Map<string, string>): Record<string, Record<string, string>> {
  return JSON.parse(files.get("package.json")!) as Record<string, Record<string, string>>;
}

describe("the scaffolded tree", () => {
  it("is the same set of files every time", () => {
    expect([...plan().keys()]).toEqual([
      ".agents/skills/pdx-sdk-docs/SKILL.md",
      ".claude/agents/pdx-docs-expert.md",
      ".claude/skills",
      ".codex/agents/pdx-docs-expert.toml",
      ".gitignore",
      ".prettierrc",
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "eslint.config.js",
      "package.json",
      "src/content/example.test.ts",
      "src/content/example.ts",
      "src/flags.ts",
      "src/index.ts",
      "src/install.ts",
      "src/mod.ts",
      "src/vanilla.ts",
      "stellaris-mod.json",
      "stellaris-mod.schema.json",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
  });

  it("models the enabled LLM bundle as four files and two exact relative links", () => {
    const entries = project();
    expect(entries.get("AGENTS.md")?.kind).toBe("file");
    expect(entries.get(".agents/skills/pdx-sdk-docs/SKILL.md")?.kind).toBe("file");
    expect(entries.get(".claude/agents/pdx-docs-expert.md")?.kind).toBe("file");
    expect(entries.get(".codex/agents/pdx-docs-expert.toml")?.kind).toBe("file");
    expect(plan().get("AGENTS.md")).toContain("without forking or inheriting conversation history");
    expect(plan().get("AGENTS.md")).toContain("return a concise blocker");
    expect(entries.get("CLAUDE.md")).toEqual({ kind: "symlink", target: "AGENTS.md" });
    expect(entries.get(".claude/skills")).toEqual({
      kind: "symlink",
      target: "../.agents/skills",
    });
    expect(entries.has("LLM-SETUP.md")).toBe(false);
  });

  it("omits the complete LLM bundle when disabled", () => {
    const entries = project({ llmSupport: false });
    for (const relPath of [
      "AGENTS.md",
      "CLAUDE.md",
      ".agents/skills/pdx-sdk-docs/SKILL.md",
      ".claude/skills",
      ".claude/agents/pdx-docs-expert.md",
      ".codex/agents/pdx-docs-expert.toml",
    ]) {
      expect(entries.has(relPath), relPath).toBe(false);
    }
  });

  it("embeds the reviewed docs skill byte for byte", () => {
    const bytes = plan().get(".agents/skills/pdx-sdk-docs/SKILL.md")!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "e870f27fb4efdd3bd4bece9fd81ad3130531b3c9306bac44cea95feec3d340dd"
    );
  });

  it("emits valid native Claude and Codex agent configuration", () => {
    const claude = plan().get(".claude/agents/pdx-docs-expert.md")!;
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(claude);
    expect(frontmatter).not.toBeNull();
    const claudeConfig = parseYaml(frontmatter![1]!) as {
      name: string;
      tools: string;
      model: string;
      effort: string;
      permissionMode: string;
      skills: string[];
    };
    expect(claudeConfig).toMatchObject({
      name: "pdx-docs-expert",
      model: "sonnet",
      effort: "medium",
      permissionMode: "acceptEdits",
      skills: ["pdx-sdk-docs"],
    });
    expect(claudeConfig.tools.split(/,\s*/)).toEqual(["Bash", "WebFetch", "Read", "Grep"]);
    expect(claudeConfig.tools).not.toMatch(/\b(?:Write|Edit)\b/);

    const codex = parseToml(plan().get(".codex/agents/pdx-docs-expert.toml")!) as {
      name: string;
      model: string;
      model_reasoning_effort: string;
      sandbox_mode: string;
      developer_instructions: string;
      sandbox_workspace_write: {
        network_access: boolean;
        exclude_slash_tmp: boolean;
        exclude_tmpdir_env_var: boolean;
      };
    };
    expect(codex).toMatchObject({
      name: "pdx-docs-expert",
      model: "gpt-5.6-luna",
      model_reasoning_effort: "medium",
      sandbox_mode: "workspace-write",
      sandbox_workspace_write: {
        network_access: true,
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
      },
    });

    const claudeInstructions = claude.slice(frontmatter![0].length);
    expect(claudeInstructions).toBe(codex.developer_instructions);
    const behavior = `${claude}\n${codex.developer_instructions}`;
    expect(behavior).toContain("retrieve fresh for every question");
    expect(behavior).toContain("temporary `llms-full.txt` cache");
    expect(behavior).toContain("remove the cache with `unlink`");
    expect(behavior).toContain("remove the empty directory with `rmdir`");
    expect(behavior).toContain("Do not edit the project, user files, user configuration");
    expect(behavior).not.toMatch(/\/Users\/|~\/|LLM-SETUP/);
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
    expect(files.get("src/mod.ts")).not.toContain("./vanilla.ts");
  });

  it("emits strict JSON where the format is strict", () => {
    for (const relPath of [
      "package.json",
      ".prettierrc",
      "stellaris-mod.json",
      "stellaris-mod.schema.json",
    ]) {
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

  it("leaves the workspace source condition out of a production project", () => {
    expect(plan().get("tsconfig.json")).not.toContain("customConditions");
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
    expect(files.get("stellaris-mod.json")).toContain('"aurora": {');
    expect(files.get("src/flags.ts")).toContain('countryFlags("aurora_welcomed")');
    expect(files.get("src/content/example.ts")).toContain('mod.technology("first_steps"');
    expect(files.get("src/content/example.ts")).toContain("mod.namespace()");
    expect(files.get("src/content/example.ts")).toContain('mod.feature("example"');
    expect(files.get("src/content/example.test.ts")).toContain("aurora_welcomed");
  });

  it("escapes a mod name that would otherwise break the file it lands in", () => {
    expect(plan({ name: 'The "Real" Mod' }).get("stellaris-mod.json")).toContain(
      '"name": "The \\"Real\\" Mod"'
    );
  });
});

/**
 * The Project Manifest is the single author-owned source of truth for mod
 * identity. `src/mod.ts` is wiring from it to `createMod`, not a second place
 * the same facts are written — so the assertions worth making are that the
 * facts are in the manifest and that `src/mod.ts` no longer restates them.
 */
describe("the Project Manifest", () => {
  it("holds exactly one mod entry, keyed by the prefix", () => {
    const manifest = JSON.parse(plan().get("stellaris-mod.json")!) as {
      $schema: string;
      mod: Record<string, unknown>;
      contentDirectory: string;
      assetsDirectory: string;
    };
    expect(Object.keys(manifest.mod)).toEqual(["my_mod"]);
    expect(manifest.$schema).toBe("./stellaris-mod.schema.json");
    expect(manifest.contentDirectory).toBe("src/content");
    expect(manifest.assetsDirectory).toBe("assets");
  });

  it("is where src/mod.ts reads the config from", () => {
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain('import manifest from "../stellaris-mod.json" with { type: "json" }');
    expect(mod).toContain("keyof typeof manifest.mod");
    // The facts live in the manifest now; a literal here would be a second
    // configuration source, which is the thing the manifest replaces.
    expect(mod).not.toContain('name: "My Mod"');
    expect(mod).not.toContain('supportedVersion: "');
  });

  it("keeps the sole mod key authoritative over anything inside the entry", () => {
    // Spread order is the whole guarantee here. The generated project reads its
    // manifest with a JSON import and never runs `parseManifest`, so a `prefix`
    // field hand-written inside the mod entry — the shape `src/mod.ts` used to
    // carry, and the natural thing to paste back in — is a value the adapter
    // would reject and this file would otherwise silently obey, renaming every
    // id the mod mints. `prefix` last means the key always wins.
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain("export const config = { ...manifest.mod[prefix], prefix }");
    expect(mod).not.toContain("{ prefix, ...manifest.mod[prefix] }");

    // The emitted expression, evaluated: the key beats a nested field.
    const manifestMod = { my_mod: { name: "My Mod", prefix: "impostor" } };
    const prefix = "my_mod" as keyof typeof manifestMod;
    expect({ ...manifestMod[prefix], prefix }.prefix).toBe("my_mod");
  });

  it("refuses to guess when the manifest declares more than one mod", () => {
    // `keyof typeof manifest.mod` only recovers the prefix because there is
    // exactly one key. The generated guard says so at runtime rather than
    // letting `Object.keys(...)[0]` pick one.
    expect(plan().get("src/mod.ts")).toContain("must declare exactly one mod");
  });

  it("discovers features where the manifest says they are, not where a convention says", () => {
    // The manifest is the single placement authority. `generate` writes into
    // `contentDirectory`; if this file hard-coded `./content/` instead, an
    // author who moved the directory would get generated files the build never
    // imports — present, correct, and silently absent from the mod.
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain('path.join(projectRoot, ...manifest.contentDirectory.split("/"))');
    expect(mod).toContain("contentDirectoryPattern.test(manifest.contentDirectory)");
    expect(mod).not.toContain('new URL("./content/"');
    expect(manifest(plan())["imports"]).toBeDefined();

    // The emitted expression, evaluated against both a default and a moved
    // directory: `src/mod.ts` is one level inside the project, so `../` lands
    // on the root and the manifest's own path continues from there.
    for (const contentDirectory of ["src/content", "src/features/generated"]) {
      const base = "file:///project/src/mod.ts";
      expect(new URL(`../${contentDirectory}/`, base).pathname).toBe(
        `/project/${contentDirectory}/`
      );
    }
  });

  it("captures the manifest Asset tree inside each build invocation", () => {
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain('"assetsDirectory" in manifest');
    expect(mod).toContain("assetsDirectoryPattern.test(assetsDirectory)");
    expect(mod).toContain('path.join(projectRoot, ...assetsDirectory.split("/"))');
    expect(mod).toContain(
      "mod.assetTree({ source: assetsDir, allowMissing: true, allowEmpty: true })"
    );
    expect(mod).toContain('mod.feature("assets", assets)');
    expect(mod.indexOf("mod.assetTree(")).toBeGreaterThan(
      mod.indexOf("export async function buildTheMod")
    );
  });

  it("documents the default mirrored Asset directory", () => {
    const readme = plan().get("README.md")!;
    expect(readme).toContain("assets/gfx/interface/icon.dds");
    expect(readme).toContain("gfx/interface/icon.dds");
    expect(readme).toContain("missing or empty directory is valid");
  });

  it("reports one whole-mod Asset summary before build and install output", () => {
    const mod = plan().get("src/mod.ts")!;
    const build = plan().get("src/index.ts")!;
    const install = plan().get("src/install.ts")!;
    expect(mod).toContain("export function assetCaptureSummary(built: PureMod): string");
    expect(build.indexOf("console.log(assetCaptureSummary(mod))")).toBeLessThan(
      build.indexOf("const files = render(mod)")
    );
    expect(install.indexOf("console.log(assetCaptureSummary(mod))")).toBeLessThan(
      install.indexOf("await install(render(mod))")
    );
  });

  it("aliases the mod module, so feature source computes no relative path", () => {
    const { imports } = manifest(plan()) as unknown as { imports: Record<string, string> };
    expect(imports["#mod"]).toBe("./src/mod.ts");
    expect(plan().get("src/content/example.ts")).toContain('import { mod } from "#mod"');
    expect(plan().get("src/content/example.ts")).not.toContain('from "../mod.ts"');
  });
});

describe("dependency resolution", () => {
  it("scaffolds a runtime SDK dependency the release can prove, and a separate test dependency", () => {
    const { dependencies } = manifest(plan());
    const { devDependencies } = manifest(plan()) as unknown as {
      devDependencies: Record<string, string>;
    };
    const sdk = dependencies![SCAFFOLDER_RELEASE_MANIFEST.sdk.packageName];
    expect(
      checkSdkCompatibility({ declaredSpecifier: sdk, installedVersion: undefined }).supported
    ).toBe(true);
    expect(devDependencies[SCAFFOLDER_RELEASE_MANIFEST.sdkTesting.packageName]).toBeDefined();
    expect(dependencies![SCAFFOLDER_RELEASE_MANIFEST.sdkTesting.packageName]).toBeUndefined();
    expect(devDependencies[SCAFFOLDER_RELEASE_MANIFEST.sdk.packageName]).toBeUndefined();
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

  it("pins the identifier package to the newest revision of the detected build", () => {
    const files = plan({ gameVersion: "4.4.6" });
    const { dependencies } = manifest(files);
    expect(dependencies!["@pdx-ts/stellaris-ids"]).toBe(">=4.4.6-0 <4.4.6");
    expect(files.get("README.md")).toContain("`>=4.4.6-0 <4.4.6`");
    expect(files.get("README.md")).toContain("`-r.<n>` revision");
  });

  it("shows the revision range form when no install was detected", () => {
    expect(plan({ installPath: undefined, gameVersion: undefined }).get("README.md")).toContain(
      'npm install "@pdx-ts/stellaris-ids@>=<your game version>-0 <<your game version>"'
    );
  });

  it("resolves that range to the newest revision, and never to a bare build", () => {
    // The two properties the range exists for, checked against the resolver npm
    // itself uses rather than by reading the string. A bare `4.4.6` on the
    // registry predates the revision scheme — it is the one version that must
    // not win, and highest-wins would otherwise hand it every install.
    const range = manifest(plan({ gameVersion: "4.4.6" })).dependencies!["@pdx-ts/stellaris-ids"]!;
    expect(semver.maxSatisfying(["4.4.6", "4.4.6-r.1", "4.4.6-r.2"], range)).toBe("4.4.6-r.2");
    expect(semver.maxSatisfying(["4.4.6-r.9", "4.4.6-r.10"], range)).toBe("4.4.6-r.10");
    expect(semver.satisfies("4.4.6", range)).toBe(false);
    expect(semver.satisfies("4.4.7-r.1", range)).toBe(false);
  });

  it("writes the range the SDK's own gate tells an author to install", () => {
    // The scaffolder cannot depend on the SDK at runtime — it scaffolds
    // projects that install it — so `idsRange` is a copy of
    // `vanillaPackageInstallRange` by necessity, and this is the only thing
    // holding the two together (SDK-137). Without it the scaffolder can write
    // a range the SDK's mismatch message contradicts, with both suites green:
    // the scaffolded project installs one package and the pin gate demands
    // another.
    for (const version of ["4.4.6", "4.5.0", "5.0.0"]) {
      expect(idsRange(version)).toBe(vanillaPackageInstallRange(version));
    }
  });

  it("pins the identifier package even when no build was detected", () => {
    // There is no unpinned scaffold. `@pdx-ts/sdk` reads the package's id
    // tables (ADR-0006), so a project without the dependency does not
    // typecheck — a fallback pin is a wrong game build at worst, and no pin is
    // a project that never builds.
    const { dependencies } = manifest(plan({ installPath: undefined, gameVersion: undefined }));
    expect(dependencies!["@pdx-ts/stellaris-ids"]).toBe(idsRange(VERIFIED_STELLARIS_BUILD));
  });

  it("falls back to the verified build for one npm cannot express", () => {
    // A four-part Paradox version has no npm counterpart to install.
    const { dependencies } = manifest(plan({ gameVersion: "4.4.6.1" }));
    expect(dependencies!["@pdx-ts/stellaris-ids"]).toBe(idsRange(VERIFIED_STELLARIS_BUILD));
  });

  it("needs no side-effect import for the package to check anything", () => {
    // The SDK imports the tables itself, so a scaffolded project never has to
    // remember to import the package — the state where it is installed and
    // silently checking nothing does not exist.
    for (const gameVersion of [undefined, "4.4.6.1", "4.4.6"]) {
      const files = plan({ gameVersion });
      expect(files.get("src/mod.ts"), String(gameVersion)).not.toContain("@pdx-ts/stellaris-ids");
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
    expect(config).toContain("callee.property.name='namespace'");
  });

  it("lints duplicate direct definitions of one typed event handle", () => {
    const config = plan().get("eslint.config.js")!;
    expect(config).toContain("pdx/one-definition-per-event-handle");
    expect(config).toContain("CapabilityEventHandle");
    expect(config).toContain("esTreeNodeToTSNodeMap");
    expect(config).toContain("Aliases, helper-mediated");
    expect(config).toContain("mutually exclusive");
  });

  it("allows nested effect closures to reuse the current-scope parameter name", () => {
    const config = plan().get("eslint.config.js")!;
    expect(config).toContain('"no-shadow": "off"');
    expect(config).toContain('"@typescript-eslint/no-shadow": "off"');
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

describe("SDK-54: config has no build side effect", () => {
  it("keeps src/mod.ts free of any disk-touching call", () => {
    // config lives here specifically so importing it — the way a test reading
    // the mod's prefix would — never builds or writes anything. `render`,
    // `write` and `install` are the SDK's only disk-touching exports; none of
    // them belongs in this file.
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain("export const config");
    expect(mod).toContain("export async function buildTheMod");
    expect(mod).not.toContain("render(");
    expect(mod).not.toContain("write(");
    expect(mod).not.toContain("install(");
  });

  it("gives src/index.ts and src/install.ts exactly one fold to share, instead of one each", () => {
    // Both entrypoints import the same buildTheMod() from src/mod.ts, so there
    // is exactly one capability compile, built once with whatever vanilla view
    // src/mod.ts resolved.
    const files = plan();
    for (const relPath of ["src/index.ts", "src/install.ts"]) {
      const contents = files.get(relPath)!;
      expect(contents, relPath).toContain("buildTheMod");
      expect(contents, relPath).not.toContain("discoverFeatures");
      expect(contents, relPath).not.toMatch(/\.compile\(/);
    }
  });
});
