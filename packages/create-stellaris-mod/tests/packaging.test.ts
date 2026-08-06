/**
 * What the published package promises, and what must not be true when it is.
 *
 * These are release rules a reviewer would otherwise have to remember, and one
 * of them — that the CLI must not take the SDK as a runtime dependency — is the
 * rule that keeps the CLI's release schedule independent of the SDK's.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.ts";
import { FLAGS, helpText, type FlagName } from "../src/options.ts";

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

  it("keeps the SDK a devDependency, so the CLI's release is not coupled to it", () => {
    // `detect.ts` deliberately duplicates a little of the SDK rather than
    // depending on it: a runtime dependency would pin this CLI to one SDK
    // version, when its whole job is to scaffold against a range.
    expect(manifest.dependencies["@pdx-ts/sdk"]).toBeUndefined();
    expect(manifest.devDependencies["@pdx-ts/sdk"]).toBeDefined();
  });

  it("reports the version it was published as", async () => {
    // `--version` reads a constant in cli.ts, which is a hand-maintained copy
    // of the manifest's. Nothing at runtime notices when a release bumps one
    // and forgets the other, so the drift is silent and ships — this is the
    // only thing that catches it.
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
