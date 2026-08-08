/**
 * The real binary, once.
 *
 * Everything else in this package drives `main` in-process, which is what makes
 * the transcripts readable and the filesystem tests fast. It also means nothing
 * else proves the parts that only exist in a real process: the shebang, argv
 * reaching `main` in the right shape, the compiled output actually being
 * loadable, and `process.exitCode` becoming an exit status.
 *
 * So this spawns `dist/bin.js` directly — no `node` prefix, because running it
 * as a program is the thing being tested — against a copy of the fixture
 * project with no `node_modules` in it at all. That absence is deliberate:
 * `generate` never loads the SDK, and a smoke test that needed an install would
 * be quietly proving the opposite.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTempProject, type TempProject } from "./helpers/golden-project.ts";

const PACKAGE = path.resolve(import.meta.dirname, "..");
const BIN = path.join(PACKAGE, "dist/bin.js");
const GOLDEN = path.join(PACKAGE, "tests/goldens/recipes/technology/default.ts");

let project: TempProject;

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: PACKAGE, stdio: "pipe" });
  // npm restores the executable bit on install; a freshly compiled file in a
  // checkout has whatever tsc gave it.
  chmodSync(BIN, 0o755);
  project = createTempProject();
}, 120_000);

afterAll(() => {
  project?.dispose();
});

describe("the compiled binary", () => {
  it("generates a feature file and exits zero", () => {
    const result = spawnSync(BIN, ["generate", "technology", "Resonance Theory", "--yes"], {
      cwd: project.dir,
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const written = path.join(project.realDir, "src/content/resonance_theory.ts");
    // stdout is exactly the path, so `generate ... | xargs $EDITOR` works.
    expect(result.stdout).toBe(`${written}\n`);
    expect(readFileSync(written, "utf8")).toBe(readFileSync(GOLDEN, "utf8"));
  });
});
