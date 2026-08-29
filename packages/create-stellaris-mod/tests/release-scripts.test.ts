import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkRelease,
  prepareReleaseCoordinates,
  RELEASE_PACKAGES,
  stellarisIdsRevisionDecision,
  validateReleaseVersion,
} from "../../../scripts/release.mjs";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

function write(root: string, file: string, contents: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function releaseFixture(staleLiteral = "0.5.0"): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "pdx-release-")));
  roots.push(root);
  for (const file of [
    "LICENSE",
    ...RELEASE_PACKAGES.map(({ directory }) => `${directory}/LICENSE`),
    "packages/stellaris-ids/LICENSE",
  ]) {
    write(root, file, "MIT License\n");
  }
  for (const releasePackage of RELEASE_PACKAGES) {
    const manifest: Record<string, unknown> = { name: releasePackage.name, version: "0.5.0" };
    for (const dependency of releasePackage.dependencies ?? []) {
      const dependencies = (manifest[dependency.section] ??= {}) as Record<string, string>;
      dependencies[dependency.name] = "^0.5.0";
    }
    if (releasePackage.name === "@pdx-ts/sdk") {
      (manifest.dependencies as Record<string, string>)["yaml"] = "^2.9.0";
    }
    write(
      root,
      `${releasePackage.directory}/package.json`,
      `${JSON.stringify(manifest, null, 2)}\n`
    );
  }
  write(
    root,
    "packages/create-stellaris-mod/src/release-manifest.ts",
    `export const SCAFFOLDER_RELEASE_MANIFEST = {\n  sdk: {\n    packageName: "@pdx-ts/sdk",\n    range: "0.5.0",\n  },\n  sdkTesting: {\n    packageName: "@pdx-ts/sdk-testing",\n    range: "0.5.0",\n  },\n};\n`
  );
  write(
    root,
    "packages/create-stellaris-mod/tests/transcripts.test.ts",
    `declareSdk(target, ">=${staleLiteral}");\n`
  );
  write(
    root,
    "packages/create-stellaris-mod/tests/goldens/transcripts/generate-sdk-range-not-subset.txt",
    `err| verified against ${staleLiteral}\n`
  );
  return root;
}

function contents(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}

describe("release preparation", () => {
  it("updates every release coordinate and no unrelated dependency", () => {
    const root = releaseFixture();

    expect(prepareReleaseCoordinates(root, "0.5.1")).toMatchObject({
      previousVersion: "0.5.0",
      version: "0.5.1",
    });

    for (const releasePackage of RELEASE_PACKAGES) {
      const manifest = JSON.parse(
        readFileSync(join(root, releasePackage.directory, "package.json"), "utf8")
      ) as Record<string, Record<string, string> | string>;
      expect(manifest.version).toBe("0.5.1");
      for (const dependency of releasePackage.dependencies ?? []) {
        expect((manifest[dependency.section] as Record<string, string>)[dependency.name]).toBe(
          "^0.5.1"
        );
      }
    }
    const sdk = JSON.parse(readFileSync(join(root, "packages/sdk/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(sdk.dependencies["yaml"]).toBe("^2.9.0");
    expect(
      readFileSync(join(root, "packages/create-stellaris-mod/src/release-manifest.ts"), "utf8")
    ).toContain('range: "0.5.1"');
    expect(
      readFileSync(join(root, "packages/create-stellaris-mod/tests/transcripts.test.ts"), "utf8")
    ).toContain(">=0.5.1");
  });

  it("rejects invalid versions and stale release literals before writing", () => {
    expect(() => validateReleaseVersion("v0.5.1")).toThrow("exact semantic version");
    expect(() => validateReleaseVersion("0.5")).toThrow("exact semantic version");

    const root = releaseFixture("0.4.9");
    expect(() => prepareReleaseCoordinates(root, "0.5.1")).toThrow("Stale release version literal");
    const sdk = JSON.parse(readFileSync(join(root, "packages/sdk/package.json"), "utf8")) as {
      version: string;
    };
    expect(sdk.version).toBe("0.5.0");
  });

  it("leaves every coordinate untouched when a later manifest is malformed", () => {
    const root = releaseFixture();
    const tracked = [
      ...RELEASE_PACKAGES.map(({ directory }) => `${directory}/package.json`),
      "packages/create-stellaris-mod/src/release-manifest.ts",
    ];
    const before = new Map(tracked.map((file) => [file, contents(root, file)]));
    write(
      root,
      "packages/sdk-testing/package.json",
      contents(root, "packages/sdk-testing/package.json").replace(
        '"@pdx-ts/sdk": "^0.5.0"',
        '"missing": "^0.5.0"'
      )
    );

    expect(() => prepareReleaseCoordinates(root, "0.5.1")).toThrow(
      "packages/sdk-testing/package.json has no peerDependencies.@pdx-ts/sdk"
    );
    for (const [file, expected] of before) {
      if (file === "packages/sdk-testing/package.json") {
        continue;
      }
      expect(contents(root, file)).toBe(expected);
    }
  });
});

describe("release readiness", () => {
  it("fails before running gates when release packages do not share one coordinate", () => {
    const root = releaseFixture();
    write(
      root,
      "packages/pdxscript/package.json",
      contents(root, "packages/pdxscript/package.json").replace(
        '"version": "0.5.0"',
        '"version": "0.5.1"'
      )
    );
    const commands: string[] = [];
    const results = checkRelease(
      root,
      (_root, command, args) => commands.push(`${command} ${args.join(" ")}`),
      null
    ) as Array<{ name: string; passed: boolean }>;

    expect(results[0]).toMatchObject({ name: "release coordinates", passed: false });
    expect(commands[0]).toBe("npm run typecheck");
    expect(commands.indexOf("npm run clean")).toBeLessThan(commands.indexOf("npm run docs:build"));
  });

  it("fails the license files check when a license is missing", () => {
    const root = releaseFixture();
    rmSync(join(root, "packages/sdk/LICENSE"));

    const results = checkRelease(root, () => undefined, null) as Array<{
      name: string;
      passed: boolean;
      error?: string;
    }>;

    expect(results).toContainEqual({
      name: "license files",
      passed: false,
      error: expect.stringContaining(join("packages", "sdk", "LICENSE")),
    });
  });
});

describe("Stellaris IDs revision decision", () => {
  it("requires the next revision only when generated identifiers changed", () => {
    expect(stellarisIdsRevisionDecision("4.4.6-r.4", "4.4.6-r.4", false)).toMatchObject({
      changed: false,
    });
    expect(stellarisIdsRevisionDecision("4.4.6-r.4", "4.4.6-r.4", true)).toMatchObject({
      changed: true,
      message: expect.stringContaining("4.4.6-r.5"),
    });
    expect(stellarisIdsRevisionDecision("4.4.6-r.4", "4.4.7-r.1", true)).toMatchObject({
      changed: true,
      message: expect.stringContaining("4.4.7-r.1"),
    });
  });
});
