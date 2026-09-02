/**
 * What the published package promises, and what must not be true when it is.
 *
 * These are release rules a reviewer would otherwise have to remember.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import semver from "semver";
import { describe, expect, it, vi } from "vitest";

import { CATALOG } from "../src/catalog/index.ts";
import { main } from "../src/cli.ts";
import {
  COMMANDS,
  FLAGS,
  GENERATE_FLAGS,
  helpText,
  type CommandName,
  type FlagName,
} from "../src/options.ts";
import { SCAFFOLDER_RELEASE_MANIFEST } from "../src/release-manifest.ts";
import { capture } from "./helpers/capture.ts";

const PACKAGE = path.resolve(import.meta.dirname, "..");

const manifest = JSON.parse(readFileSync(path.join(PACKAGE, "package.json"), "utf8")) as {
  version: string;
  bin: Record<string, string>;
  files: string[];
  engines: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

function workspaceVersion(packageDirectory: string): string {
  const packageJson = JSON.parse(
    readFileSync(path.resolve(PACKAGE, "..", packageDirectory, "package.json"), "utf8")
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error(`${packageDirectory}/package.json has no string version`);
  }
  return packageJson.version;
}

describe("the published package", () => {
  it("ships compiled JavaScript, not the TypeScript sources", () => {
    // Not a style choice. `npx` installs into a real `node_modules`, and Node
    // refuses to strip types from anything under one — so a `.ts` bin would
    // fail at load, before any of this code could print a useful message.
    // No leading `./`: npm rewrites it at pack time and warns that it
    // "auto-corrected" the bin, which reads exactly like it dropped it.
    expect(manifest.bin["create-stellaris-mod"]).toBe("dist/bin.js");
    expect(manifest.files).toContain("dist");
    expect(manifest.files).not.toContain("src");
    expect(manifest.scripts["build"]).toBeDefined();
    // `prepack`, not `prepublishOnly`: the latter does not run on `npm pack`,
    // so a packed tarball would carry no dist and the packaging checks would
    // be rehearsing something other than what publish produces.
    expect(manifest.scripts["prepack"]).toContain("build");
    expect(manifest.scripts["prepublishOnly"]).toBeUndefined();
  });

  it("uses the SDK's configuration validator at runtime", () => {
    expect(manifest.dependencies["@pdx-ts/sdk"]).toBe(`^${workspaceVersion("sdk")}`);
    expect(manifest.devDependencies["@pdx-ts/sdk"]).toBeUndefined();
  });

  it("anchors scaffolded SDK ranges to the workspace packages this repository verifies", () => {
    expect(semver.satisfies(workspaceVersion("sdk"), SCAFFOLDER_RELEASE_MANIFEST.sdk.range)).toBe(
      true
    );
    expect(
      semver.satisfies(
        workspaceVersion("sdk-testing"),
        SCAFFOLDER_RELEASE_MANIFEST.sdkTesting.range
      )
    ).toBe(true);
  });

  it("declares the range algebra it actually runs", () => {
    // `checkSdkCompatibility` asks whether a project's declared range is a
    // *subset* of the verified one, and subset is not something to hand-roll.
    expect(manifest.dependencies["semver"]).toBeDefined();
    // ajv is the schema half of the manifest agreement test and must never
    // become a runtime cost for `npx create-stellaris-mod`.
    expect(manifest.dependencies["ajv"]).toBeUndefined();
    expect(manifest.devDependencies["ajv"]).toBeDefined();
  });

  it("reports the package version through the public command", async () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    try {
      await main(["--version"]);
    } finally {
      spy.mockRestore();
    }
    expect(written.join("").trim()).toBe(manifest.version);
  });

  it("does not require type stripping of its own", () => {
    // The SDK validator sets this floor. The generated project still needs
    // 22.18, and says so in its own package.json.
    expect(manifest.engines["node"]).toBe(">=22");
  });
});

describe("--help", () => {
  it("documents every flag init's parser accepts", () => {
    // Two lists drift: a flag added to the parser and forgotten in the help is
    // invisible, and one documented but unparsed is worse. The invariant is
    // per-command — `init` owns this flag table, and the catalog commands own
    // their own.
    const help = helpText("init");
    for (const name of Object.keys(FLAGS) as FlagName[]) {
      expect(help, `--${name} is parsed but undocumented`).toContain(name);
    }
  });

  it("documents every flag generate's parser accepts", () => {
    const help = helpText("generate");
    for (const name of Object.keys(GENERATE_FLAGS)) {
      expect(help, `--${name} is parsed but undocumented`).toContain(`--${name}`);
    }
  });

  it("lists every command, so a reserved name is discoverable", () => {
    const help = helpText("init");
    for (const [command, summary] of Object.entries(COMMANDS)) {
      expect(help, command).toContain(command);
      expect(help, command).toContain(summary);
    }
  });

  it("gives every command its own usage line", () => {
    for (const command of Object.keys(COMMANDS) as CommandName[]) {
      expect(helpText(command), command).toContain(`create-stellaris-mod ${command}`);
    }
  });

  it("shows the useful half of each negatable boolean", () => {
    // `--git` is redundant when git defaults on; `--no-git` is the one worth
    // printing.
    expect(helpText()).toContain("--no-git");
    expect(helpText()).not.toMatch(/^\s+--git\s/m);
  });
});

/**
 * The same drift invariant, one level down. `view` is where an author reads what
 * a recipe will ask and how to answer it without prompting, so a question the
 * page does not document is a flag nobody can discover.
 */
describe("view", () => {
  it.each(CATALOG.list().map((summary) => summary.id))(
    "documents every flag %s's questions become",
    async (id) => {
      const { io, out } = capture();
      expect(await main(["view", id], io)).toBe(0);

      const questions = CATALOG.view(id).questions;
      for (const question of questions) {
        expect(out(), `--${question.key} is asked but undocumented`).toContain(`--${question.key}`);
        for (const choice of question.choices) {
          expect(out(), `${question.key}=${choice.value} is offered but undocumented`).toContain(
            choice.value
          );
        }
      }
      if (questions.length === 0) {
        // Not a vacuous pass: the page has to say so, so the loop above being
        // empty is a documented fact rather than a silent gap.
        expect(out()).toContain("asks nothing");
      }
    }
  );
});
