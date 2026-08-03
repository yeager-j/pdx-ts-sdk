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
 * The toolchain (typescript, vitest, @types/node) is still symlinked from the
 * repo root, so no step needs the network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
const ROOT_MODULES = path.join(REPO, "node_modules");
const WORKSPACE_PACKAGES = ["sdk", "sdk-testing", "pdxscript", "stellaris-ids"] as const;

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

  for (const dep of ["typescript", "vitest", "@types"]) {
    symlinkSync(path.join(ROOT_MODULES, dep), path.join(modules, dep), "dir");
  }
  mkdirSync(path.join(modules, ".bin"), { recursive: true });
  for (const bin of ["tsc", "vitest"]) {
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

  const code = await main([
    "--yes",
    "--no-git",
    "--no-install",
    "--no-eslint",
    "--name",
    "Smoke Mod",
    projectDir,
  ]);
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
  it("typechecks with the toolchain it asked for", () => {
    expect(() =>
      runIn(projectDir, path.join(projectDir, "node_modules/.bin/tsc"), ["--noEmit"])
    ).not.toThrow();
  });

  it("builds a mod, fanning one feature module across two registries", () => {
    const output = runIn(projectDir, process.execPath, ["src/index.ts"]);

    // The claim `src/content/example.ts`'s own docblock makes: one module, one
    // stem, two registry directories.
    expect(output).toContain("common/technology/smoke_mod_example.txt");
    expect(output).toContain("events/smoke_mod_example.txt");
    expect(output).toContain("descriptor.mod");
    expect(output).toContain("localisation/english/smoke_mod_l_english.yml");
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
}, 120_000);
