/**
 * The committed identifier package, measured against the install it claims to
 * describe (SDK-12 seam D).
 *
 * `packages/stellaris-vanilla/src` is generated output that CI can never
 * reproduce — CI has no copy of Stellaris. So the trust story is committed
 * bytes plus this gate: next to a real install, regenerate the whole package in
 * memory and string-compare every file, both directions. `npm run
 * vanilla:codegen:check` does the same thing through git; this does it inside
 * the test suite, where a failure names the file.
 *
 * `formatEmitted` is deliberately in the loop. `generateVanillaPackage` returns
 * unformatted text by design, and Prettier decides the committed bytes, so
 * comparing raw emission against the tree would fail on formatting alone.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { formatEmitted } from "../../../../tools/vanilla-codegen/format.ts";
import { generateVanillaPackage } from "../../../../tools/vanilla-codegen/generate.ts";
import { locateInstall } from "../../src/stellaris/locate.ts";

const PACKAGE = "packages/stellaris-vanilla";
const OUT = `${PACKAGE}/src`;
const CONFIG = "vendor/cwtools-stellaris-config/config";

let installRoot: string | undefined;
try {
  installRoot = locateInstall();
} catch {
  installRoot = undefined;
}

const manifest = JSON.parse(readFileSync(`${PACKAGE}/package.json`, "utf8")) as {
  version: string;
};

/** The install's own statement of its build, as `major.minor.patch`. */
function installGameVersion(root: string): string {
  const settings = JSON.parse(readFileSync(path.join(root, "launcher-settings.json"), "utf8")) as {
    rawVersion?: unknown;
  };
  if (typeof settings.rawVersion !== "string") {
    throw new Error("the install's launcher-settings.json states no rawVersion");
  }
  return settings.rawVersion.replace(/^v/, "");
}

function committedFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory()
        ? committedFiles(full, `${prefix}${name}/`)
        : [`${prefix}${name}`];
    });
}

const regenerated =
  installRoot === undefined
    ? undefined
    : await formatEmitted(
        generateVanillaPackage({
          installRoot,
          gameVersion: manifest.version,
          configRoot: CONFIG,
        }).files,
        OUT
      );

describe.skipIf(installRoot === undefined)("committed vanilla package", () => {
  it("pins the package version to the installed game version", () => {
    expect(installGameVersion(installRoot!)).toBe(manifest.version);
  });

  it("emits exactly the committed file set", () => {
    expect([...regenerated!.keys()].sort()).toEqual(committedFiles(OUT).sort());
  });

  it("emits byte-identical contents for every committed file", () => {
    for (const [name, text] of regenerated!) {
      expect(readFileSync(path.join(OUT, name), "utf8"), name).toBe(text);
    }
  });
});
