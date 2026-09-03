/**
 * The scaffold as a value. Everything here runs against `planProject`, with no
 * filesystem — which is the point of keeping the plan pure.
 */

import { createHash } from "node:crypto";
import { vanillaPackageInstallRange } from "@pdx-ts/sdk/internals";
import semver from "semver";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { SDK_DOCS_REVISION } from "../src/generated/package-version.ts";
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
      ".agents/skills/pdx-project-startup/SKILL.md",
      ".agents/skills/pdx-sdk-authoring/SKILL.md",
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
      "knip.json",
      "package.json",
      "src/build.ts",
      "src/features.ts",
      "src/features/example.test.ts",
      "src/features/example.ts",
      "src/flags.ts",
      "src/index.ts",
      "src/inspect.ts",
      "src/install.ts",
      "src/mod.ts",
      "src/vanilla.ts",
      "stellaris-mod.json",
      "stellaris-mod.schema.json",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
  });

  it("models the enabled LLM bundle as six files and two exact relative links", () => {
    const entries = project();
    expect(entries.get("AGENTS.md")?.kind).toBe("file");
    expect(entries.get(".agents/skills/pdx-project-startup/SKILL.md")?.kind).toBe("file");
    expect(entries.get(".agents/skills/pdx-sdk-authoring/SKILL.md")?.kind).toBe("file");
    expect(entries.get(".agents/skills/pdx-sdk-docs/SKILL.md")?.kind).toBe("file");
    expect(entries.get(".claude/agents/pdx-docs-expert.md")?.kind).toBe("file");
    expect(entries.get(".codex/agents/pdx-docs-expert.toml")?.kind).toBe("file");
    expect(plan().get("AGENTS.md")).toContain("without forking or inheriting conversation history");
    expect(plan().get("AGENTS.md")).toContain("Status: not configured.");
    expect(plan().get("AGENTS.md")).toContain(
      "read and follow `.agents/skills/pdx-project-startup/SKILL.md` completely"
    );
    expect(plan().get("AGENTS.md")).toContain(
      "read and follow `.agents/skills/pdx-sdk-authoring/SKILL.md` completely"
    );
    expect(plan().get("AGENTS.md")).toContain(
      "spawn one subagent with the `pdx-docs-expert` agent type"
    );
    expect(plan().get("AGENTS.md")).toContain("`@pdx-docs-expert <question>`");
    expect(plan().get("AGENTS.md")).toContain(
      "writes an interactive gallery to `previews/index.html`"
    );
    expect(plan().get("AGENTS.md")).toContain(
      "A clean diagnostic list is not a substitute for visual inspection"
    );
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
      ".agents/skills/pdx-project-startup/SKILL.md",
      ".agents/skills/pdx-sdk-authoring/SKILL.md",
      ".agents/skills/pdx-sdk-docs/SKILL.md",
      ".claude/skills",
      ".claude/agents/pdx-docs-expert.md",
      ".codex/agents/pdx-docs-expert.toml",
    ]) {
      expect(entries.has(relPath), relPath).toBe(false);
    }
  });

  it("embeds the reviewed skills byte for byte", () => {
    const expectedDigests = new Map([
      [
        ".agents/skills/pdx-project-startup/SKILL.md",
        "50984ec193bd0e19d06380f48f02e06925d727a3c7c74c6b512b5c2beda1e37f",
      ],
      [
        ".agents/skills/pdx-sdk-authoring/SKILL.md",
        "8a7a2bbff96aafc1b7ad0c8493f00f259d3c2c09f25068f33e59ebdc215ebce9",
      ],
      [
        ".agents/skills/pdx-sdk-docs/SKILL.md",
        "e870f27fb4efdd3bd4bece9fd81ad3130531b3c9306bac44cea95feec3d340dd",
      ],
    ]);
    for (const [relPath, expectedDigest] of expectedDigests) {
      const bytes = plan().get(relPath)!;
      expect(createHash("sha256").update(bytes).digest("hex"), relPath).toBe(expectedDigest);
    }
  });

  it("emits valid model-invoked project skills", () => {
    const expectedDescriptions = new Map([
      ["pdx-project-startup", "Collaboration agreement"],
      ["pdx-sdk-authoring", "Feature modules"],
    ]);
    for (const [name, descriptionFragment] of expectedDescriptions) {
      const skill = plan().get(`.agents/skills/${name}/SKILL.md`)!;
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill);
      expect(frontmatter, name).not.toBeNull();
      expect(parseYaml(frontmatter![1]!), name).toEqual({
        name,
        description: expect.stringContaining(descriptionFragment),
      });
      expect(skill, name).not.toContain("disable-model-invocation");
    }

    const authoring = plan().get(".agents/skills/pdx-sdk-authoring/SKILL.md")!;
    expect(authoring).toContain("**Items**");
    expect(authoring).toContain("**Feature**");
    expect(authoring).toContain("**Fold**");
  });

  it("discloses startup only while the collaboration agreement is unconfigured", () => {
    const agents = plan().get("AGENTS.md")!;
    const startup = plan().get(".agents/skills/pdx-project-startup/SKILL.md")!;
    expect(agents.match(/<!-- pdx-project-collaboration:start -->/g)).toHaveLength(1);
    expect(agents.match(/<!-- pdx-project-collaboration:end -->/g)).toHaveLength(1);
    expect(agents).not.toContain("**Role:**");
    expect(startup).toContain("Ask the core questions");
    expect(startup).toContain("resume that request without asking the user to repeat it");
    expect(startup).toContain("replace only the marked Collaboration agreement");
    expect(startup).toContain("`/grill-with-docs`");
    expect(startup).toContain("`/wayfinder`");
    expect(startup.indexOf("## Recommend optional planning Skills")).toBeGreaterThan(
      startup.indexOf("## Write the agreement")
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

  /**
   * SDK-386. The guidance tells the documentation expert to compare the
   * documentation's declared revision against this scaffold's, so the scaffold
   * has to state one. Without it the instruction has no second operand: the
   * workflow either stalls or quietly drops the evidence requirement it claims
   * to enforce.
   */
  it("records the SDK source revision the guidance compares against", () => {
    const agents = plan().get("AGENTS.md")!;
    expect(agents).toContain(`SDK source revision: \`${SDK_DOCS_REVISION}\``);
    expect(agents).toContain(SCAFFOLDER_RELEASE_MANIFEST.sdk.range);
    expect(agents).toContain("matches the one recorded below");
    // The docs site publishes the same hash under this label, which is what
    // makes the two comparable at all.
    expect(agents).toContain("`SDK revision:`");
  });

  it("says the recorded revision stops being evidence after an SDK upgrade", () => {
    // A hash of one SDK source tree describes that tree and no later one, so
    // guidance that presented it as a standing check would be wrong the first
    // time an author upgrades.
    expect(plan().get("AGENTS.md")).toContain("not a live check");
  });

  it("omits the provenance record with the rest of the agent bundle", () => {
    expect(project({ llmSupport: false }).has("AGENTS.md")).toBe(false);
  });

  /**
   * `--local` writes a `file:` dependency at a checkout, whose contents are
   * neither the published range this release states nor necessarily the source
   * it was built from — and which keeps changing. Recording the release
   * coordinates anyway would be worse than recording nothing: the agent would
   * compare documentation against a version this project does not depend on.
   * The CLI already refuses to prove anything about a `file:` dependency
   * (`checkSdkCompatibility`'s `unprovable-specifier`); this says the same
   * thing to the agent.
   */
  it("records no provenance for a project depending on a local checkout", () => {
    const agents = plan({ localSdk: "/repo/pdx-sdk" }).get("AGENTS.md")!;
    expect(agents).toContain("## Documentation provenance");
    expect(agents).toContain("Not available.");
    expect(agents).toContain("`file:` link");
    expect(agents).not.toContain(SDK_DOCS_REVISION);
    expect(agents).not.toContain("SDK source revision:");
  });

  it("still points a local project at its own checkout as the better evidence", () => {
    const agents = plan({ localSdk: "/repo/pdx-sdk" }).get("AGENTS.md")!;
    expect(agents).toContain("prefer the checkout's own source when the two disagree");
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
    // knip is not an opt-in: the feature list is the only thing that puts a
    // module in the mod, so the dead-file check stays whether or not ESLint
    // does, and the script shrinks to just it.
    expect(scripts["lint"]).toBe("knip --no-config-hints");
    expect(devDependencies["knip"]).toBeDefined();
  });

  it("runs ESLint and then knip under one lint script when both are kept", () => {
    const { scripts } = manifest(plan());
    expect(scripts!["lint"]).toBe("eslint . && knip --no-config-hints");
  });

  it("keeps vanilla loading available without a detected install", () => {
    const files = plan({ installPath: undefined, gameVersion: undefined });
    expect(files.get("src/vanilla.ts")).toContain("export function loadVanilla()");
    expect(files.get("src/build.ts")).toContain('import { loadVanilla } from "./vanilla.ts";');
    expect(files.get("src/build.ts")).toContain(
      "return project.build(features, { vanilla: loadVanilla() });"
    );
  });

  it("emits strict JSON where the format is strict", () => {
    for (const relPath of [
      "package.json",
      ".prettierrc",
      "knip.json",
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
    // word; the giveaway is `undefined` sitting where a value belongs: quoted,
    // or welded to an identifier.
    const accidental = /"undefined"|_undefined|undefined_|: undefined[,\n]/;
    for (const [relPath, contents] of plan()) {
      expect(contents, `${relPath} interpolated undefined`).not.toMatch(accidental);
      expect(contents, relPath).not.toContain("[object Object]");
    }
  });

  it("forwards the optional vanilla view directly to the project pipeline", () => {
    const build = plan().get("src/build.ts");
    expect(build).toContain("return project.build(features, { vanilla: loadVanilla() });");
    expect(build).not.toContain("vanilla === undefined");
  });

  it("carries the author's prefix into every place the SDK will read it", () => {
    const files = plan({ prefix: "aurora", name: "Aurora" });
    expect(files.get("stellaris-mod.json")).toContain('"aurora": {');
    expect(files.get("src/flags.ts")).toContain('countryFlags("aurora_welcomed")');
    expect(files.get("src/features/example.ts")).toContain('mod.technology("first_steps"');
    expect(files.get("src/features/example.ts")).toContain("mod.namespace()");
    expect(files.get("src/features/example.ts")).toContain('mod.feature("example"');
    expect(files.get("src/features/example.test.ts")).toContain("aurora_welcomed");
  });

  it("escapes a mod name that would otherwise break the file it lands in", () => {
    expect(plan({ name: 'The "Real" Mod' }).get("stellaris-mod.json")).toContain(
      '"name": "The \\"Real\\" Mod"'
    );
  });
});

/**
 * The Project Manifest is the single author-owned source of truth for mod
 * identity. `src/mod.ts` hands it to the SDK's project pipeline rather than
 * restating either configuration or layout rules.
 */
describe("the Project Manifest", () => {
  it("holds exactly one mod entry, keyed by the prefix", () => {
    const manifest = JSON.parse(plan().get("stellaris-mod.json")!) as {
      $schema: string;
      mod: Record<string, unknown>;
      assetsDirectory: string;
    };
    expect(Object.keys(manifest.mod)).toEqual(["my_mod"]);
    expect(manifest.$schema).toBe("./stellaris-mod.schema.json");
    expect(manifest.assetsDirectory).toBe("assets");
  });

  it("names no Feature source, because the feature list does", () => {
    // The manifest used to carry `contentDirectory` for discovery. Feature
    // source is declared in `src/features.ts` now, so a manifest that still
    // named a directory would be a second placement authority nothing reads.
    expect(plan().get("stellaris-mod.json")).not.toContain("contentDirectory");
  });

  it("is where src/mod.ts reads the config from", () => {
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain('import manifest from "../stellaris-mod.json" with { type: "json" }');
    expect(mod).toContain("createModProject(manifest");
    // The facts live in the manifest now; a literal here would be a second
    // configuration source, which is the thing the manifest replaces.
    expect(mod).not.toContain('name: "My Mod"');
    expect(mod).not.toContain('supportedVersion: "');
  });

  it("delegates manifest identity and layout rules to the SDK", () => {
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain('import { createModProject } from "@pdx-ts/sdk"');
    expect(mod).toContain('projectRoot: new URL("../", import.meta.url)');
    expect(mod).toContain("export const { config, mod } = project");
    expect(mod).not.toContain("Object.keys(manifest.mod)");
    expect(mod).not.toContain("new RegExp(");
    expect(mod).not.toContain("DirectoryPattern");
  });

  it("builds the Features the list declares, not the ones a directory holds", () => {
    // The feature list is the single placement authority. `generate` appends
    // to it; if the build discovered a directory instead, a module the list
    // did not name would still ship, and one the list named but a directory
    // walk skipped would not.
    const build = plan().get("src/build.ts")!;
    expect(build).toContain('import * as features from "./features.ts"');
    expect(build).toContain("return project.build(features, ");
    expect(build).not.toContain("discoverFeatures(");
    expect(build).not.toContain("contentDirectory");
    expect(manifest(plan())["imports"]).toBeDefined();
  });

  it("keeps mod.ts free of the feature modules that import it", () => {
    // Feature modules import `mod` from `#mod`. A static import of
    // `features.ts` from `mod.ts` would evaluate them first, and they would
    // read `mod` in its temporal dead zone. That is why `build.ts` exists.
    const mod = plan().get("src/mod.ts")!;
    expect(mod).toContain("export const project = createModProject(manifest");
    expect(mod).toContain("export const { config, mod } = project");
    expect(mod).not.toMatch(/^import .*"\.\/(?:features|vanilla|build)\.ts"/m);
    expect(mod).not.toContain("buildTheMod");
    expect(mod).not.toContain("project.build(");
  });

  it("declares exactly the example Feature in the feature list", () => {
    const list = plan().get("src/features.ts")!;
    const exports = list.split("\n").filter((line) => line.startsWith("export "));
    expect(exports).toEqual(['export { feature as example } from "./features/example.ts";']);
    expect(list).toContain("never creates or");
  });

  it("captures the manifest Asset tree inside each build invocation", () => {
    const build = plan().get("src/build.ts")!;
    expect(build).toContain("export async function buildTheMod");
    expect(build).toContain("return project.build(");
    expect(build).not.toContain("mod.assetTree(");
    expect(build).not.toContain("mod.compile(");
  });

  it("checks for dead feature modules with knip, and for nothing else", () => {
    const knip = JSON.parse(plan().get("knip.json")!) as {
      entry: string[];
      project: string[];
      vitest: boolean;
      rules: Record<string, string>;
    };
    expect(knip.entry).toEqual(["src/index.ts", "src/inspect.ts", "src/install.ts"]);
    expect(knip.project).toEqual(["src/**/*.ts", "!src/**/*.test.ts"]);
    // Left on, the vitest plugin makes every test file an entry, and a feature
    // module reachable only through its own test would pass the check.
    expect(knip.vitest).toBe(false);
    const on = Object.entries(knip.rules)
      .filter(([, level]) => level === "error")
      .map(([rule]) => rule)
      .sort();
    expect(on).toEqual(["files", "unresolved"]);
    expect(Object.values(knip.rules).every((level) => level === "error" || level === "off")).toBe(
      true
    );
  });

  it("documents the default mirrored Asset directory", () => {
    const readme = plan().get("README.md")!;
    expect(readme).toContain("assets/gfx/interface/icon.dds");
    expect(readme).toContain("gfx/interface/icon.dds");
    expect(readme).toContain("missing or empty directory is valid");
  });

  it("delegates build, inspection, and install presentation to the SDK", () => {
    const build = plan().get("src/index.ts")!;
    const inspect = plan().get("src/inspect.ts")!;
    const install = plan().get("src/install.ts")!;
    expect(build).toContain('import { runBuild } from "@pdx-ts/sdk"');
    expect(build).toContain('import { buildTheMod } from "./build.ts"');
    expect(build).toContain("await runBuild(buildTheMod(), { outDir, previewsDir })");
    expect(inspect).toContain('import { runInspect } from "@pdx-ts/sdk"');
    expect(inspect).toContain('import { buildTheMod } from "./build.ts"');
    expect(inspect).toContain("await runInspect(buildTheMod(), {");
    expect(inspect).toContain('projectRoot: new URL("../", import.meta.url)');
    // The Fold already carries the mod's config; the report needs no second copy.
    expect(inspect).not.toContain("stellaris-mod.json");
    expect(install).toContain('import { runInstall } from "@pdx-ts/sdk"');
    expect(install).toContain('import { buildTheMod } from "./build.ts"');
    expect(install).toContain("await runInstall(buildTheMod())");
    expect(build).not.toContain('from "./mod.ts"');
    expect(inspect).not.toContain('from "./mod.ts"');
    expect(install).not.toContain('from "./mod.ts"');
    expect(build).not.toContain("console.");
    expect(inspect).not.toContain("console.");
    expect(install).not.toContain("console.");
  });

  it("aliases the mod module, so feature source computes no relative path", () => {
    const { imports } = manifest(plan()) as unknown as { imports: Record<string, string> };
    expect(imports["#mod"]).toBe("./src/mod.ts");
    expect(plan().get("src/features/example.ts")).toContain('import { mod } from "#mod"');
    expect(plan().get("src/features/example.ts")).not.toContain('from "../mod.ts"');
  });

  it("documents the authored Feature stem as output identity", () => {
    const example = plan().get("src/features/example.ts")!;
    expect(example).toContain("Rename or move this file and the emitted paths stay the same");
    expect(example).toContain("Change the stem to change its");
    expect(example).not.toContain("Rename this file and the emitted filenames follow");
  });

  it("gives the scaffolded visible event checked picture and sound media", () => {
    const example = plan().get("src/features/example.ts")!;
    expect(example).toContain(
      "picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal"
    );
    expect(example).toContain(
      "showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal"
    );
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
      checkSdkCompatibility({ declaredSpecifier: sdk, installed: { kind: "absent" } }).supported
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
    expect(
      semver.maxSatisfying(["4.4.6", "4.4.6-r.1", "4.4.6-r.2", "4.4.6-r.3", "4.4.6-r.4"], range)
    ).toBe("4.4.6-r.4");
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
      expect(files.get("src/build.ts"), String(gameVersion)).not.toContain("@pdx-ts/stellaris-ids");
    }
  });

  it("requires the Node version its own build script needs", () => {
    // `npm run build` is `node src/index.ts`, which needs type stripping.
    expect(manifest(plan())["engines"]!["node"]).toBe(">=22.18.0");
  });

  it("provides the deterministic YAML inspection command", () => {
    const { scripts } = manifest(plan());
    expect(scripts!["inspect"]).toBe("node src/inspect.ts");
    expect(plan().get("README.md")).toContain("npm run inspect");
    expect(plan().get("README.md")).toContain("deterministic YAML report");
  });
});

/**
 * SDK-385. The generated loader has exactly two states that mean "no view", and
 * both are named. Collapsing an unreadable install, a parser defect, or a
 * refused directory into the same silent `undefined` would hand the author a
 * build with no id-collision checks, no version evidence, and no patch sources,
 * indistinguishable from one that had all three.
 */
describe("the vanilla view's absence and its failures", () => {
  const vanilla = (overrides: Partial<Resolved> = {}): string =>
    plan(overrides).get("src/vanilla.ts")!;

  it("returns no view for the deliberate opt-out and for a missing install", () => {
    expect(vanilla()).toContain('process.env["PDX_NO_VANILLA"] === "1"');
    expect(vanilla()).toContain("if (error instanceof InstallNotFoundError && !namedAnInstall())");
    expect(vanilla()).toContain('import { InstallNotFoundError } from "@pdx-ts/sdk";');
  });

  /**
   * The SDK reports a `STELLARIS_PATH` that is not a game root and a fruitless
   * search of the platform defaults with one error class, so the class alone
   * cannot decide this. Only the second is an absence: the first is a request
   * somebody made on this machine, and a build that ignored it would check
   * against nothing while its author believed otherwise.
   */
  it("propagates a STELLARIS_PATH that is not a game root", () => {
    for (const explicit of [true, false]) {
      const source = vanilla({ installPath: "/games/Stellaris", installPathIsExplicit: explicit });
      expect(source, String(explicit)).toContain('const named = process.env["STELLARIS_PATH"]');
      // Empty counts as unset, which is what the SDK's own lookup does with it.
      expect(source, String(explicit)).toContain('named !== undefined && named !== ""');
    }
  });

  it("keeps a stale scaffolded path soft, because nobody asked for it here", () => {
    // The teammate case the file promises: a machine path baked in by whoever
    // ran the scaffolder is a record, not a request, so a checkout where it
    // does not resolve still builds.
    const source = vanilla({ installPath: "/weird/place", installPathIsExplicit: true });
    expect(source).toContain("SCAFFOLDED_INSTALL");
    expect(source).toContain("is a record of one machine rather than a request");
    // And it is only ever passed when STELLARIS_PATH is unset, which is
    // exactly when the guard above lets the failure be an absence.
    expect(source).toContain('process.env["STELLARIS_PATH"] ? {} : { installPath:');
  });

  it("propagates every other failure instead of building without evidence", () => {
    expect(vanilla()).toContain("throw error;");
    expect(vanilla()).not.toContain("return undefined;\n  }\n}\n");
  });

  it("reports through no console call, the way the SDK's own diagnostics do", () => {
    expect(vanilla()).not.toContain("console.");
  });

  it("defers the refusal into the promise the terminal runner awaits", () => {
    // `runBuild(buildTheMod(), ...)` evaluates the argument first, so a
    // synchronous throw from `loadVanilla()` would escape the runner that
    // exists to present failures. An async function makes it a rejection.
    expect(plan().get("src/build.ts")).toContain("export async function buildTheMod()");
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

/**
 * SDK-391. The selection already decides what gets installed and what the
 * terminal says next; the documents the project keeps have to agree with it.
 * A pnpm project whose README says `npm install` earns a second lockfile and a
 * dependency graph nobody resolved.
 */
describe("the selected package manager", () => {
  it("reaches every command the generated documents print", () => {
    const files = plan({ packageManager: "pnpm" });
    const readme = files.get("README.md")!;
    expect(readme).toContain("pnpm run build");
    expect(readme).toContain("pnpm run inspect");
    expect(readme).toContain("pnpm run install-mod");
    expect(readme).toContain("pnpm run typecheck");
    expect(files.get("AGENTS.md")).toContain("pnpm run typecheck");
    expect(files.get(".agents/skills/pdx-sdk-authoring/SKILL.md")).toContain("pnpm run inspect");
  });

  it("leaves no npm command behind in any generated document", () => {
    // The failure this catches is a partial derivation: one line converted and
    // its neighbour still saying `npm`, which reads as a deliberate exception.
    for (const packageManager of ["pnpm", "yarn", "bun"]) {
      for (const [relPath, contents] of plan({ packageManager })) {
        expect(contents, `${relPath} under ${packageManager}`).not.toMatch(/\bnpm (?:run|install)/);
      }
    }
  });

  it("spells adding one dependency the way that manager spells it", () => {
    // The only command the four genuinely disagree about: `yarn install <pkg>`
    // is not an add under Yarn Berry, so this one cannot be uniform.
    const withoutInstall = { installPath: undefined, gameVersion: undefined } as const;
    for (const [packageManager, expected] of [
      ["npm", "npm install "],
      ["pnpm", "pnpm add "],
      ["yarn", "yarn add "],
      ["bun", "bun add "],
    ]) {
      const readme = plan({ ...withoutInstall, packageManager }).get("README.md")!;
      expect(readme, packageManager).toContain(`${expected}"@pdx-ts/stellaris-ids@`);
    }
  });

  it("always uses the explicit run form, because `bun test` is not the test script", () => {
    // `bun test` runs Bun's own test runner rather than the project's `test`
    // script, so the npm shorthand does not survive translation.
    expect(plan({ packageManager: "bun" }).get("README.md")).toContain("bun run test");
    expect(plan({ packageManager: "bun" }).get("AGENTS.md")).toContain("bun run test");
  });
});

describe("the generated sources", () => {
  it("keeps tests colocated and configures vitest to find them there", () => {
    expect(plan().get("vitest.config.ts")).toContain('include: ["src/**/*.test.ts"]');
  });

  it("lints one namespace per Feature", () => {
    const config = plan().get("eslint.config.js")!;
    expect(config).toContain("pdx/one-namespace-per-file");
    expect(config).toContain("callee.property.name='namespace'");
    expect(config).toContain("A namespace belongs to exactly one Feature");
    expect(config).not.toContain("bijection");
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
    for (const relPath of ["src/mod.ts", "src/build.ts"]) {
      const contents = plan().get(relPath)!;
      expect(contents, relPath).not.toContain("discoverFeatures(");
      expect(contents, relPath).not.toContain("assetTree(");
      expect(contents, relPath).not.toContain(".compile(");
      expect(contents, relPath).not.toContain("render(");
      expect(contents, relPath).not.toContain("write(");
      expect(contents, relPath).not.toContain("install(");
    }
    expect(plan().get("src/mod.ts")).toContain("export const { config, mod } = project");
    expect(plan().get("src/build.ts")).toContain("export async function buildTheMod");
  });

  it("gives every project command exactly one fold to share", () => {
    // Every entrypoint imports the same buildTheMod() from src/build.ts, so
    // there is exactly one capability compile, built once with whatever
    // vanilla view src/build.ts resolved.
    const files = plan();
    for (const relPath of ["src/index.ts", "src/inspect.ts", "src/install.ts"]) {
      const contents = files.get(relPath)!;
      expect(contents, relPath).toContain("buildTheMod");
      expect(contents, relPath).not.toContain("discoverFeatures");
      expect(contents, relPath).not.toMatch(/\.compile\(/);
    }
  });
});
