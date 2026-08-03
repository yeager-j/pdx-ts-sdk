/**
 * The real gate: scaffold a project, then typecheck, build and test it with the
 * actual toolchain.
 *
 * Templates are strings, so the repo's own typechecker never sees the code they
 * produce. This is what pays that back — and it is a stronger check than
 * typechecking a template directory would have been, because it checks the
 * *interpolated* result. It is also the only thing that proves the generated
 * tsconfig can typecheck the SDK's raw-`.ts` exports from inside a consumer
 * program, which is the likeliest thing to be subtly wrong.
 *
 * Dependencies are symlinked rather than installed: no network, deterministic,
 * and — the part that matters — a symlink is exactly what npm materializes for
 * the `file:` dependencies the CLI writes under `--local`.
 *
 * When `@pdx-ts/sdk` is published, this test becomes the publish gate by
 * swapping the symlinks for an `npm pack` tarball. That is the one check that
 * reproduces a real `node_modules` directory, where Node refuses to strip types
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
const ROOT_MODULES = path.join(REPO, "node_modules");

let projectDir: string;

/**
 * The dependency tree a published install would produce, without the registry.
 * The workspace packages point at their real directories; the toolchain comes
 * from the repo root, which already has the versions the templates pin.
 */
function linkDependencies(dir: string): void {
  const modules = path.join(dir, "node_modules");
  mkdirSync(path.join(modules, "@pdx-ts"), { recursive: true });
  for (const pkg of ["sdk", "sdk-testing", "pdxscript", "stellaris-ids"]) {
    symlinkSync(path.join(REPO, "packages", pkg), path.join(modules, "@pdx-ts", pkg), "dir");
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
  projectDir = path.join(mkdtempSync(path.join(tmpdir(), "create-stellaris-mod-")), "smoke-mod");
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
  linkDependencies(projectDir);
}, 120_000);

afterAll(() => {
  if (projectDir !== undefined) {
    rmSync(path.dirname(projectDir), { recursive: true, force: true });
  }
});

describe("a scaffolded project", () => {
  it("typechecks with the toolchain it asked for", () => {
    // `skipLibCheck` does not save this: while the SDK ships raw `.ts`, the
    // consumer's program compiles SDK *sources*, not declarations.
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
