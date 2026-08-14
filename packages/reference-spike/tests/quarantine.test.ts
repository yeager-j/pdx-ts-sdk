/**
 * The architecture gate that makes the quarantine real.
 *
 * The spike is allowed exactly one information-hiding violation, in exactly one
 * module. Without a test, "allowed exactly one" is a sentence in a design doc,
 * and the second import is a two-line diff nobody notices in review. So this
 * reads the source tree and fails on:
 *
 * - a CWT Codegen import anywhere but `src/probe/codegen-probe.ts`;
 * - any production package importing the spike;
 * - the spike's package name or privacy changing, which is what would make it
 *   publishable.
 *
 * Deleting `packages/reference-spike` deletes this file, the probe, and the
 * exception together. That is the property the whole arrangement is for.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SPIKE = path.join(ROOT, "packages/reference-spike");
const PROBE = path.join(SPIKE, "src/probe/codegen-probe.ts");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
        continue;
      }
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mts|cts)$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** Every module specifier a file imports, in any of the spellings TypeScript allows. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map(
    (match) => match[1]!
  );
}

describe("the codegen probe is the only reader of CWT Codegen internals", () => {
  const sources = sourcesUnder(SPIKE);

  it("finds the spike's sources", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain(PROBE);
  });

  it("no other spike module imports @pdx-ts/codegen-cwt", () => {
    const offenders = sources
      .filter((file) => file !== PROBE)
      .filter((file) => importsOf(file).some((entry) => entry.startsWith("@pdx-ts/codegen-cwt")))
      .map((file) => path.relative(ROOT, file));
    expect(
      offenders,
      "the spike is permitted one codegen-internals reader; these are extra"
    ).toEqual([]);
  });

  it("no spike module reaches into another package's source by relative path", () => {
    const offenders = sources
      .filter((file) =>
        importsOf(file).some(
          (entry) => entry.startsWith(".") && entry.includes("../../../packages/")
        )
      )
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("the probe returns spike-owned values only", () => {
    const text = readFileSync(PROBE, "utf8");
    // Every codegen import is type-only except the three functions the probe
    // calls. A value import beyond those is a codegen type escaping the module.
    const valueImports = [
      ...text.matchAll(/^import\s+\{([^}]+)\}\s+from\s+"@pdx-ts\/codegen-cwt[^"]*";/gm),
    ]
      .flatMap((match) => match[1]!.split(","))
      .map((name) => name.trim())
      .filter((name) => name !== "" && !name.startsWith("type "));
    expect(valueImports.sort()).toEqual(["Emitter", "emitContentType", "loadRules"]);
  });
});

describe("no production package imports the spike", () => {
  // A directory under `packages/` without a manifest is not a workspace
  // member yet — `packages/authoring-reference` currently holds only the
  // context glossary for the production feature this spike is testing the
  // ground for. Skipping it is right; crashing on it would make the gate fail
  // for a reason that has nothing to do with quarantine.
  const productionPackages = readdirSync(path.join(ROOT, "packages")).filter(
    (name) =>
      name !== "reference-spike" &&
      statSync(path.join(ROOT, "packages", name)).isDirectory() &&
      existsSync(path.join(ROOT, "packages", name, "package.json"))
  );

  it("checks every other workspace package", () => {
    expect(productionPackages.length).toBeGreaterThan(5);
  });

  for (const name of productionPackages) {
    it(`${name} does not import @pdx-ts/reference-spike`, () => {
      const offenders = sourcesUnder(path.join(ROOT, "packages", name))
        .filter((file) => importsOf(file).some((entry) => entry.includes("reference-spike")))
        .map((file) => path.relative(ROOT, file));
      expect(offenders).toEqual([]);
    });
  }

  it("no other package declares it as a dependency", () => {
    for (const name of productionPackages) {
      const manifest = JSON.parse(
        readFileSync(path.join(ROOT, "packages", name, "package.json"), "utf8")
      ) as Record<string, Record<string, string> | undefined>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        expect(Object.keys(manifest[field] ?? {}), `${name}.${field}`).not.toContain(
          "@pdx-ts/reference-spike"
        );
      }
    }
  });
});

describe("the spike cannot be published", () => {
  const manifest = JSON.parse(readFileSync(path.join(SPIKE, "package.json"), "utf8")) as {
    name: string;
    private: boolean;
    publishConfig?: unknown;
    files?: unknown;
  };

  it("keeps the quarantined name", () => {
    expect(manifest.name).toBe("@pdx-ts/reference-spike");
  });

  it("stays private, with nothing that would make it publishable", () => {
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig).toBeUndefined();
    expect(manifest.files).toBeUndefined();
  });
});
