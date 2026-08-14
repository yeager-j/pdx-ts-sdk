/**
 * Where a Reference build's five source versions come from.
 *
 * Every one is read from the repo at assembly time rather than typed into the
 * snapshot. A version somebody maintains by hand is a version that is wrong
 * within two commits, and the whole point of recording them is that a reader
 * can tell whether a claim describes the SDK they installed.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BuildIdentity } from "../build.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function packageVersion(relative: string): string {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, relative), "utf8")) as {
    version?: string;
  };
  const version = manifest.version;
  if (version === undefined) {
    throw new Error(`${relative} states no version, so the build cannot record what it describes`);
  }
  return version;
}

/**
 * The vendored rules' upstream commit, from the snapshot's own VERSION.md —
 * the same line `codegen` stamps into every generated header, so a Reference
 * build and the generated surface it describes name the same commit or the
 * mismatch is visible.
 */
function cwtCommit(): string {
  const version = readFileSync(
    path.join(ROOT, "vendor/cwtools-stellaris-config/VERSION.md"),
    "utf8"
  );
  const commit = /`([0-9a-f]{40})`/.exec(version)?.[1];
  if (commit === undefined) {
    throw new Error(
      "vendor/cwtools-stellaris-config/VERSION.md no longer states a commit hash, so a build " +
        "cannot say which rules its claims were projected from"
    );
  }
  return commit;
}

/**
 * The documentation dump codegen reads, discovered rather than hardcoded: the
 * vendor snapshot ships exactly one `script-docs` directory, and reading its
 * name is how the build stays right across a version bump.
 */
function docsRevision(): string {
  const dir = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs");
  const entries = readdirSync(dir).filter((name) => name.startsWith("v"));
  if (entries.length !== 1) {
    throw new Error(
      `expected exactly one vendored script-docs revision, found ${entries.length} — the build ` +
        "has to name the one codegen actually reads, and cannot pick"
    );
  }
  return entries[0]!;
}

function corpusGameVersion(): string {
  const meta = JSON.parse(
    readFileSync(path.join(ROOT, "packages/sdk/tests/fixtures/corpus/meta.json"), "utf8")
  ) as { gameVersion: string };
  return meta.gameVersion;
}

export function buildIdentity(): BuildIdentity {
  return {
    sdkVersion: packageVersion("packages/sdk/package.json"),
    cwtCommit: cwtCommit(),
    docsRevision: docsRevision(),
    corpusGameVersion: corpusGameVersion(),
    vanillaIdsVersion: packageVersion("packages/stellaris-ids/package.json"),
  };
}
