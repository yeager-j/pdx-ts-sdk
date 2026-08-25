/**
 * What `generate` reads out of somebody's project, and how it behaves when what
 * it finds is not what it hoped for.
 *
 * Three of the four things here are the same mistake in different clothes:
 * believing a fact about a project that nothing checked. The installed SDK is
 * assumed to be beside the project when a workspace hoists it above; a
 * `package.json` is assumed to have the shape a cast claims; a directory is
 * assumed to be where its path says rather than where it resolves. The fourth
 * is the machine refusing outright, which is not a defect in this program and
 * should not print like one.
 *
 * Projects are built by hand rather than copied from the fixture, because the
 * layouts being tested are exactly the ones the fixture does not have: nested
 * inside a workspace, reached through a symlink, or malformed.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";
import { findInstalledSdkVersion } from "../src/commands/generate.ts";
import { capture } from "./helpers/capture.ts";

const MANIFEST = {
  mod: { golden_mod: { name: "Golden Fixture", supportedVersion: "v4.4.*" } },
  contentDirectory: "src/content",
};

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    // Restore anything a permission test took away, or the removal fails.
    try {
      chmodSync(path.join(root, "project/src"), 0o755);
    } catch {
      // Not every layout has that directory, which is fine.
    }
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-generate-project-"));
  roots.push(root);
  return root;
}

interface ProjectShape {
  /** Overrides the whole package.json, for the malformed cases. */
  readonly packageJson?: unknown;
  readonly sdkSpecifier?: string;
}

/** A minimal but complete project: manifest, `#mod`, and a content directory. */
function writeProject(dir: string, shape: ProjectShape = {}): string {
  mkdirSync(path.join(dir, "src/content"), { recursive: true });
  writeFileSync(path.join(dir, "stellaris-mod.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  writeFileSync(path.join(dir, "src/mod.ts"), "// wiring\n");
  const packageJson =
    "packageJson" in shape
      ? shape.packageJson
      : {
          name: "some-mod",
          private: true,
          type: "module",
          imports: { "#mod": "./src/mod.ts" },
          devDependencies: { "@pdx-ts/sdk": shape.sdkSpecifier ?? "0.4.0" },
        };
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  return dir;
}

/** An installed `@pdx-ts/sdk` at one level of a tree. */
function installSdk(dir: string, version: string): void {
  const installed = path.join(dir, "node_modules/@pdx-ts/sdk");
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    path.join(installed, "package.json"),
    `${JSON.stringify({ name: "@pdx-ts/sdk", version })}\n`
  );
}

async function generate(
  cwd: string,
  argv: readonly string[] = []
): Promise<{
  code: number;
  out: string;
  err: string;
}> {
  const { io, out, err } = capture(cwd);
  const code = await main(["generate", "technology", "Resonance Theory", "--yes", ...argv], io);
  return { code, out: out(), err: err() };
}

describe("finding the installed SDK", () => {
  it("returns nothing when it is installed nowhere above the project", async () => {
    const project = writeProject(path.join(makeRoot(), "project"));
    expect(await findInstalledSdkVersion(project)).toBeUndefined();
  });

  it("finds it beside the project", async () => {
    const project = writeProject(path.join(makeRoot(), "project"));
    installSdk(project, "0.3.4");
    expect(await findInstalledSdkVersion(project)).toBe("0.3.4");
  });

  it("finds it hoisted to a workspace root above the project", async () => {
    // The layout the old lookup missed entirely: npm installs once at the root
    // of a workspace, the project resolves it from there, and a check that only
    // looked beside the project concluded nothing was installed.
    const root = makeRoot();
    const project = writeProject(path.join(root, "packages/mod"));
    installSdk(root, "0.3.4");
    expect(await findInstalledSdkVersion(project)).toBe("0.3.4");
  });

  it("stops at an installation whose package.json says nothing useful", async () => {
    // A malformed install is still the install that would be imported, so the
    // answer is "no version to check" rather than some other copy's version.
    const root = makeRoot();
    const project = writeProject(path.join(root, "packages/mod"));
    installSdk(root, "0.3.4");
    installSdk(project, "0.3.0");
    writeFileSync(path.join(project, "node_modules/@pdx-ts/sdk/package.json"), "null\n");
    expect(await findInstalledSdkVersion(project)).toBeUndefined();
  });

  it("takes the nearest one, which is the one that would resolve", async () => {
    const root = makeRoot();
    const project = writeProject(path.join(root, "packages/mod"));
    installSdk(root, "0.3.0");
    installSdk(project, "0.3.4");
    expect(await findInstalledSdkVersion(project)).toBe("0.3.4");
  });

  it("refuses a generation against a hoisted install the project has outgrown", async () => {
    // End to end, because the point of the walk is this refusal: the project
    // declares a range it is entitled to, and the SDK that would actually be
    // imported is older than that.
    const root = makeRoot();
    const project = writeProject(path.join(root, "packages/mod"), { sdkSpecifier: "0.4.0" });
    installSdk(root, "0.3.4");

    const { code, err, out } = await generate(project);
    expect(code).toBe(1);
    expect(err).toContain("0.3.4");
    expect(err).toContain("0.4.0");
    expect(out).toBe("");
  });
});

describe("a package.json that is not the shape it claims", () => {
  it.each([
    ["null", null, /must be a JSON object/],
    ["an array", [], /must be a JSON object/],
    ["imports as a string", { imports: "./src/mod.ts" }, /"imports" must be a JSON object/],
    [
      "devDependencies as an array",
      { imports: { "#mod": "./src/mod.ts" }, devDependencies: [] },
      /"devDependencies" must be a JSON object/,
    ],
    [
      "a dependency that is not a string",
      {
        imports: { "#mod": "./src/mod.ts" },
        devDependencies: { "@pdx-ts/sdk": { version: "^0.3.0" } },
      },
      /must be a version range written as a string/,
    ],
  ])("reports %s as an ordinary fault", async (_case, packageJson, pattern) => {
    const project = writeProject(path.join(makeRoot(), "project"), { packageJson });
    const { code, err, out } = await generate(project);

    expect(code).toBe(1);
    expect(err).toMatch(pattern);
    // Not a crash: no stack frames, and nothing on stdout.
    expect(err).not.toContain("    at ");
    expect(out).toBe("");
  });
});

describe("--cwd", () => {
  it("searches from where the directory really is, not from where it is spelled", async () => {
    // The walk upward is lexical, so a symlinked start would otherwise climb
    // the link's parents — past the project entirely — and report that there is
    // no manifest anywhere.
    const root = makeRoot();
    const project = writeProject(path.join(root, "project"));
    mkdirSync(path.join(root, "links"));
    const alias = path.join(root, "links/content");
    symlinkSync(path.join(project, "src/content"), alias);

    const { code, out, err } = await generate(root, ["--cwd", alias]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out.trim().endsWith("src/content/resonance_theory.ts")).toBe(true);
  });

  it("says the directory does not exist, rather than that the project does not", async () => {
    const project = writeProject(path.join(makeRoot(), "project"));
    const { code, err } = await generate(project, ["--cwd", "nowhere"]);

    expect(code).toBe(1);
    expect(err).toContain("--cwd");
    expect(err).toContain('"nowhere"');
    expect(err).not.toContain("stellaris-mod.json");
  });
});

describe("when the filesystem says no", () => {
  it("reports a refused write as a message rather than a stack trace", async () => {
    if (process.getuid?.() === 0) {
      return; // root ignores the permission bits this test relies on.
    }
    const project = writeProject(path.join(makeRoot(), "project"));
    rmSync(path.join(project, "src/content"), { recursive: true });
    // Readable and traversable, not writable: the preflight sees a real
    // directory and stops at the missing segment, and the publisher's own
    // `mkdir` is what fails.
    chmodSync(path.join(project, "src"), 0o555);

    const { code, err, out } = await generate(project);
    expect(code).toBe(1);
    expect(err).toContain("EACCES");
    expect(err).toContain("The filesystem refused an operation");
    expect(err).not.toContain("    at ");
    expect(out).toBe("");
  });
});
