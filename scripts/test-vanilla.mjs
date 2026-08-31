/**
 * Runs the two pdxscript suites that need a real Stellaris install, with a
 * missing install treated as a failure rather than a skip.
 *
 * They are the package's only external evidence — the fixpoint over every
 * shipped file, and agreement with an independent parser — and both skip
 * themselves during an ordinary `npm test`, because a CI runner has no game
 * install. That leaves the default command able to go green without them, so
 * this is the command that cannot (SDK-320). `release:check` runs it.
 *
 * The flag travels in the environment because vitest passes no arguments
 * through to a test file, and it is set here rather than in the npm script so
 * the spelling works on Windows too.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locateInstall } from "@pdx-ts/sdk/installation";

const SUITES = [
  "packages/pdxscript/tests/corpus.test.ts",
  "packages/pdxscript/tests/differential.test.ts",
];

/**
 * The install, found the way the rest of the repo finds it: `STELLARIS_PATH`,
 * then the Steam default *for this platform*, with a sentinel check that the
 * directory really is a game root.
 *
 * The suites themselves know only `STELLARIS_PATH`, so the path is resolved
 * here and passed down. Without this they would look in the macOS location on
 * every platform, and `release:check` — which locates the install through this
 * same function before deciding to run at all — would find one and then fail
 * the gate it had just decided it could satisfy.
 */
function installPath() {
  if (process.env["STELLARIS_PATH"] !== undefined) {
    return process.env["STELLARIS_PATH"];
  }
  try {
    return locateInstall();
  } catch {
    // Left unset on purpose: PDX_REQUIRE_INSTALL makes the suites report the
    // absence themselves, with the path they looked for.
    return undefined;
  }
}

const located = installPath();
const result = spawnSync("npx", ["vitest", "run", ...SUITES], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    PDX_REQUIRE_INSTALL: "1",
    ...(located === undefined ? {} : { STELLARIS_PATH: located }),
  },
});

if (result.error !== undefined) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
