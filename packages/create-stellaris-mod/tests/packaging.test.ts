/**
 * What the published package promises, and what must not be true when it is.
 *
 * These are release rules a reviewer would otherwise have to remember, and one
 * of them — that the CLI must not ship depending on an unpublished SDK — is the
 * rule that stops `npx create-stellaris-mod` from scaffolding a project whose
 * very first `npm install` 404s.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FLAGS, helpText, type FlagName } from "../src/options.ts";

const PACKAGE = path.resolve(import.meta.dirname, "..");

const manifest = JSON.parse(readFileSync(path.join(PACKAGE, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  files: string[];
  engines: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

describe("the published package", () => {
  it("ships compiled JavaScript, not the TypeScript sources", () => {
    // Not a style choice. `npx` installs into a real `node_modules`, and Node
    // refuses to strip types from anything under one — so a `.ts` bin would
    // fail at load, before any of this code could print a useful message.
    expect(manifest.bin["create-stellaris-mod"]).toMatch(/^\.\/dist\//);
    expect(manifest.files).toContain("dist");
    expect(manifest.files).not.toContain("src");
    expect(manifest.scripts["build"]).toBeDefined();
    expect(manifest.scripts["prepublishOnly"]).toContain("build");
  });

  it("keeps the SDK a devDependency, so the CLI's release is not coupled to it", () => {
    // `detect.ts` deliberately duplicates a little of the SDK rather than
    // depending on it: @pdx-ts/sdk is not publishable yet, and a runtime
    // dependency would make this package unpublishable too.
    expect(manifest.dependencies["@pdx-ts/sdk"]).toBeUndefined();
    expect(manifest.devDependencies["@pdx-ts/sdk"]).toBeDefined();
  });

  it("does not require type stripping of its own", () => {
    // Compiling is what buys the wider floor; the generated *project* still
    // needs 22.18, and says so in its own package.json.
    expect(manifest.engines["node"]).toBe(">=20");
  });
});

describe("--help", () => {
  it("documents every flag the parser accepts", () => {
    // Two lists drift: a flag added to the parser and forgotten in the help is
    // invisible, and one documented but unparsed is worse.
    const help = helpText();
    for (const name of Object.keys(FLAGS) as FlagName[]) {
      expect(help, `--${name} is parsed but undocumented`).toContain(name);
    }
  });

  it("shows the useful half of each negatable boolean", () => {
    // `--git` is redundant when git defaults on; `--no-git` is the one worth
    // printing.
    expect(helpText()).toContain("--no-git");
    expect(helpText()).not.toMatch(/^\s+--git\s/m);
  });
});
