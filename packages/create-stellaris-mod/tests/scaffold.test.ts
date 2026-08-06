/**
 * The real gate: scaffold a project, then typecheck, build and test it with the
 * actual toolchain.
 *
 * Templates are strings, so the repo's own typechecker never sees the code they
 * produce. This is what pays that back — and it is a stronger check than
 * typechecking a template directory would have been, because it checks the
 * *interpolated* result. It is also the only thing that proves the generated
 * tsconfig can typecheck against the SDK's published `.d.ts` from inside a
 * consumer program, which is the likeliest thing to be subtly wrong.
 *
 * The workspace packages are installed from real `npm pack` tarballs, unpacked
 * into `node_modules` as ordinary directories. That is the point, and it is not
 * incidental: Node refuses to strip types from anything under `node_modules`
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and the workspace hides that
 * completely by linking members as symlinks whose realpath escapes. Only an
 * unpacked tarball reproduces what a stranger's `npm install` produces — so
 * this is at once the scaffolder's end-to-end test and the gate on the packages
 * being publishable at all.
 *
 * Tarballs also mean the packages are exercised through their *published*
 * `exports`, which resolve to `dist/`. Nothing here can pass by accident on the
 * `pdx-source` condition the repo uses internally.
 *
 * The toolchain (typescript, vitest, ESLint and its config packages, @types/node)
 * is still symlinked from the repo root, so no step needs the network.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { locateInstall, readGameVersion } from "../../sdk/src/stellaris/index.ts";
import { main } from "../src/cli.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
const ROOT_MODULES = path.join(REPO, "node_modules");
const WORKSPACE_PACKAGES = ["sdk", "sdk-testing", "pdxscript", "stellaris-ids"] as const;

/** Absent when no real Stellaris install is on this machine. */
let realInstallPath: string | undefined;
try {
  realInstallPath = locateInstall();
} catch {
  realInstallPath = undefined;
}
const realInstallGameVersion =
  realInstallPath === undefined ? undefined : readGameVersion(realInstallPath);

/**
 * `@pdx-ts/stellaris-ids`'s npm version carries the game version it was
 * generated from, plus a `-r.<n>` revision (AGENTS.md, "Vanilla identifier
 * package"; PROVENANCE.md, "Revisions") — it is
 * regenerated from a pinned install, not derived live, so a game update
 * alone can leave the workspace-built tarball this suite installs pinned to
 * a version the currently detected install no longer matches.
 */
function stellarisIdsPackageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(REPO, "packages/stellaris-ids/package.json"), "utf8")
  ) as { version: string };
  // major.minor.patch only, matching checkVanillaPackagePin's own comparison
  // (packages/sdk/src/identifiers/package-pin.ts): a regen-fix release like
  // "4.4.6-r2" still pins install "4.4.6".
  return pkg.version.split(/[-+]/, 1)[0]!;
}

/**
 * `checkVanillaPackagePin` (packages/sdk/src/identifiers/package-pin.ts) throws
 * `VanillaPackageMismatchError` whenever a `VanillaView` and the installed
 * `@pdx-ts/stellaris-ids` disagree about which game build they describe.
 * That is a real, useful guard — but a mismatch here would make the
 * real-vanilla suite below fail for a reason SDK-54 has nothing to do with:
 * the workspace tarball this suite installs was built once, pinned to
 * whatever `@pdx-ts/stellaris-ids` happened to be regenerated against, and
 * a game update since then leaves it stale. Skip that suite rather than let
 * it fail on an unrelated, pre-existing mismatch.
 */
const realVanillaSuiteRunnable =
  realInstallPath !== undefined &&
  realInstallGameVersion !== undefined &&
  stellarisIdsPackageVersion() === realInstallGameVersion;

let projectDir: string;
let tarballDir: string;

/** `npm pack` each package; `prepack` builds `dist/` on the way. */
function packWorkspacePackages(destination: string): void {
  for (const pkg of WORKSPACE_PACKAGES) {
    execFileSync("npm", ["pack", "--pack-destination", destination], {
      cwd: path.join(REPO, "packages", pkg),
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
}

/**
 * Unpack each tarball into `node_modules/@pdx-ts/<name>` as a real directory —
 * what npm would have produced from the registry — and symlink the toolchain.
 */
function installTarballs(dir: string, tarballs: string): void {
  const modules = path.join(dir, "node_modules");
  const scope = path.join(modules, "@pdx-ts");
  mkdirSync(scope, { recursive: true });

  const files = readdirSync(tarballs).filter((name) => name.endsWith(".tgz"));
  for (const pkg of WORKSPACE_PACKAGES) {
    const tarball = files.find((name) => name.startsWith(`pdx-ts-${pkg}-`));
    if (tarball === undefined) {
      throw new Error(`no tarball packed for @pdx-ts/${pkg} (found: ${files.join(", ")})`);
    }
    const target = path.join(scope, pkg);
    mkdirSync(target, { recursive: true });
    // The tarball's single `package/` root is stripped, exactly as npm does.
    execFileSync("tar", [
      "-xzf",
      path.join(tarballs, tarball),
      "-C",
      target,
      "--strip-components=1",
    ]);
  }

  for (const dep of ["typescript", "vitest", "@types", "@eslint", "eslint", "typescript-eslint"]) {
    symlinkSync(path.join(ROOT_MODULES, dep), path.join(modules, dep), "dir");
  }
  mkdirSync(path.join(modules, ".bin"), { recursive: true });
  for (const bin of ["tsc", "vitest", "eslint"]) {
    symlinkSync(path.join(ROOT_MODULES, ".bin", bin), path.join(modules, ".bin", bin));
  }
}

function runIn(dir: string, command: string, args: readonly string[]): string {
  return execFileSync(command, [...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PDX_NO_VANILLA: "1" },
  });
}

beforeAll(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-"));
  projectDir = path.join(root, "smoke-mod");
  tarballDir = path.join(root, "tarballs");
  mkdirSync(tarballDir, { recursive: true });

  const code = await main(["--yes", "--no-git", "--no-install", "--name", "Smoke Mod", projectDir]);
  expect(code).toBe(0);

  packWorkspacePackages(tarballDir);
  installTarballs(projectDir, tarballDir);
}, 300_000);

afterAll(() => {
  if (projectDir !== undefined) {
    rmSync(path.dirname(projectDir), { recursive: true, force: true });
  }
});

describe("a scaffolded project", () => {
  it("does not write to disk merely by importing config (SDK-54)", () => {
    // config lives in src/mod.ts, which only reads: discovering and folding
    // content touches no disk. A test — or anything else — that imports
    // `config` to read the mod's prefix must not build the mod as a side
    // effect. This is the ticket's headline claim, and it fails on the
    // pre-fix layout: there, `config` lived in src/index.ts, which is also
    // the build entrypoint with a top-level `await write(...)`, so importing
    // it built the mod and wrote `out/` as a side effect.
    const outDir = path.join(projectDir, "out");
    rmSync(outDir, { recursive: true, force: true });

    const importer = path.join(projectDir, "read-config-only.mjs");
    writeFileSync(
      importer,
      'import { config } from "./src/mod.ts";\nprocess.stdout.write(config.name);\n'
    );
    try {
      const output = runIn(projectDir, process.execPath, ["read-config-only.mjs"]);

      expect(output).toBe("Smoke Mod");
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(importer, { force: true });
    }
  });

  it("typechecks with the toolchain it asked for", () => {
    expect(() =>
      runIn(projectDir, path.join(projectDir, "node_modules/.bin/tsc"), ["--noEmit"])
    ).not.toThrow();
  });

  it("runs the generated ESLint configuration", () => {
    const result = spawnSync("npm", ["run", "lint"], {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...process.env, PDX_NO_VANILLA: "1" },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("rejects a second direct define call on one typed event handle", () => {
    const probe = path.join(projectDir, "src/lint-probe.ts");
    const source = [
      'import { createMod } from "@pdx-ts/sdk";',
      "",
      'const mod = createMod({ name: "Lint probe", prefix: "lint_probe", supportedVersion: "4.4.*" });',
      "const events = mod.namespace();",
      "const handle = events.countryHandle(1);",
      "handle.define({ isTriggeredOnly: true });",
      "const plain = { define() {} };",
      "plain.define();",
    ];
    const firstLine = source.findIndex((line) => line.startsWith("handle.define")) + 1;
    const secondLine = source.length + 1;
    const eslint = path.join(projectDir, "node_modules/.bin/eslint");

    try {
      writeFileSync(probe, `${source.join("\n")}\n`);
      const accepted = spawnSync(eslint, ["src/lint-probe.ts", "--format", "json"], {
        cwd: projectDir,
        encoding: "utf8",
        env: { ...process.env, PDX_NO_VANILLA: "1" },
      });
      expect(accepted.status, accepted.stderr).toBe(0);

      writeFileSync(probe, `${source.join("\n")}\nhandle.define({ isTriggeredOnly: true });\n`);
      const rejected = spawnSync(eslint, ["src/lint-probe.ts", "--format", "json"], {
        cwd: projectDir,
        encoding: "utf8",
        env: { ...process.env, PDX_NO_VANILLA: "1" },
      });
      expect(rejected.status, rejected.stderr).toBe(1);
      const messages = (
        JSON.parse(rejected.stdout) as Array<{
          messages: Array<{ ruleId: string | null; line: number; message: string }>;
        }>
      )[0]!.messages;
      const duplicate = messages.find(
        (message) => message.ruleId === "pdx/one-definition-per-event-handle"
      );

      expect(duplicate).toMatchObject({
        line: secondLine,
        message: expect.stringContaining(`already defined on line ${firstLine}`),
      });
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it("builds a mod, fanning one feature module across two registries", () => {
    const output = runIn(projectDir, process.execPath, ["src/index.ts"]);

    // The claim `src/content/example.ts`'s own docblock makes: one module, one
    // stem, two registry directories.
    expect(output).toContain("common/technology/smoke_mod_example.txt");
    expect(output).toContain("events/smoke_mod_example.txt");
    expect(output).toContain("descriptor.mod");
    expect(output).toContain("localisation/english/smoke_mod_example_l_english.yml");

    const events = runIn(projectDir, "cat", ["out/events/smoke_mod_example.txt"]);
    expect(events).toContain("namespace = smoke_mod");
    expect(events).toContain("id = smoke_mod.1");
  });

  it("emits a descriptor the launcher can read", () => {
    runIn(projectDir, process.execPath, ["src/index.ts"]);
    const descriptor = runIn(projectDir, "cat", ["out/descriptor.mod"]);
    expect(descriptor).toContain('name="Smoke Mod"');
    expect(descriptor).toContain('supported_version="v');
  });

  it("passes the tests it was scaffolded with", () => {
    // The generated test asserts the generated event chain, so this catches a
    // template whose example compiles but does not do what its prose claims.
    const output = runIn(projectDir, path.join(projectDir, "node_modules/.bin/vitest"), ["run"]);
    expect(output).toMatch(/2 passed/);
  });

  it("keeps its colocated test out of the built mod", () => {
    // `src/content/example.test.ts` sits inside the discovered directory. If
    // discovery stopped skipping it, the build would throw rather than quietly
    // emit — so a successful build above is already the evidence. This pins the
    // reason: no registry file is named after it.
    const output = runIn(projectDir, process.execPath, ["src/index.ts"]);
    expect(output).not.toContain("example_test");
    expect(output).not.toContain("example.test");
  });

  it("installs end to end without rebuilding unchecked (SDK-54)", () => {
    // install.ts imports the same buildTheMod() as src/index.ts, so there is
    // exactly one capability compile and this proves the ordinary path still
    // works end to end.
    const modDir = mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-launcher-"));
    try {
      const output = execFileSync(process.execPath, ["src/install.ts"], {
        cwd: projectDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PDX_NO_VANILLA: "1", STELLARIS_MOD_DIR: modDir },
      });
      expect(output).toContain("Installed Smoke Mod for the launcher:");
      expect(readdirSync(modDir).length).toBeGreaterThan(0);
    } finally {
      rmSync(modDir, { recursive: true, force: true });
    }
  });

  it("surfaces build warnings on install-mod, not just on build (SDK-54)", () => {
    // On the pre-fix template, `install.ts` had no warning loop of its own —
    // it only appeared to report `mod.warnings` because importing `config`
    // from `src/index.ts` forced that build's warning loop to run first, as a
    // side effect. This mutates the scaffolded example to trigger a real,
    // nonfatal warning (a localization value containing a quote, which
    // Paradox's yml format cannot escape) and proves `install.ts` reports it
    // through its own loop, independent of that accident.
    const examplePath = path.join(projectDir, "src/content/example.ts");
    const original = readFileSync(examplePath, "utf8");
    const withQuotedDesc = original.replace(
      'desc: "The first technology this mod adds.",',
      "desc: 'A \"quoted\" description, to trigger a real build warning.',"
    );
    expect(withQuotedDesc).not.toBe(original);
    writeFileSync(examplePath, withQuotedDesc);

    const modDir = mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-warn-"));
    try {
      // spawnSync, not execFileSync: the warning is nonfatal (exit 0), and
      // console.warn writes to stderr, which execFileSync's return value
      // does not include.
      const result = spawnSync(process.execPath, ["src/install.ts"], {
        cwd: projectDir,
        encoding: "utf8",
        env: { ...process.env, PDX_NO_VANILLA: "1", STELLARIS_MOD_DIR: modDir },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout + result.stderr).toContain("warning (loc-quote-replaced)");
    } finally {
      writeFileSync(examplePath, original);
      rmSync(modDir, { recursive: true, force: true });
    }
  });
}, 120_000);

/**
 * The real-vanilla check: a scaffolded project loads the version-matched
 * vanilla view and installs cleanly. Capability-authored own ids are minted
 * from the scaffold's prefix, so the old mutation to a full vanilla id is no
 * longer a representable authoring operation.
 */
describe.skipIf(!realVanillaSuiteRunnable)(
  "npm run install-mod against a real vanilla view",
  () => {
    let checkedProjectDir: string;
    let launcherModDir: string;

    beforeAll(async () => {
      const root = mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-collision-"));
      checkedProjectDir = path.join(root, "checked-mod");
      launcherModDir = path.join(root, "launcher-mod-dir");

      const code = await main([
        "--yes",
        "--no-git",
        "--no-install",
        "--no-eslint",
        "--name",
        "Checked Mod",
        checkedProjectDir,
      ]);
      expect(code).toBe(0);
      // Reuses the outer suite's already-packed tarballs — the SDK itself is
      // untouched by this fix, so nothing here needs a second `npm pack`.
      installTarballs(checkedProjectDir, tarballDir);
    }, 300_000);

    afterAll(() => {
      if (checkedProjectDir !== undefined) {
        rmSync(path.dirname(checkedProjectDir), { recursive: true, force: true });
      }
    });

    function runInstallMod(): string {
      return execFileSync(process.execPath, ["src/install.ts"], {
        cwd: checkedProjectDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // No PDX_NO_VANILLA here: the whole point is exercising the real
        // vanilla view this machine's Stellaris install provides.
        env: { ...process.env, STELLARIS_MOD_DIR: launcherModDir },
      });
    }

    it("installs cleanly end to end when nothing collides", () => {
      const output = runInstallMod();
      expect(output).toContain("Installed Checked Mod for the launcher:");
      expect(readdirSync(launcherModDir).length).toBeGreaterThan(0);
    });
  },
  180_000
);
