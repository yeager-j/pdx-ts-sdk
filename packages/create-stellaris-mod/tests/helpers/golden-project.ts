/**
 * The real project a generated file has to survive.
 *
 * `tests/fixtures/golden-project/` is a committed mod project: its own
 * `package.json#imports`, its own Project Manifest, its own `src/mod.ts`. A test
 * copies it to a temporary directory, symlinks this repository's packages in as
 * `node_modules`, drops generated source into the content directory, and then
 * runs two child processes over it — `tsc -p` and the project's own build.
 *
 * Child processes, not in-process imports, and for a specific reason: `#mod` is
 * resolved by Node's own resolver reading a real `package.json`, and
 * `--conditions=pdx-source` is what points the SDK at its sources instead of a
 * `dist/` this repository never builds. Vitest's resolver would answer both
 * questions its own way, and then the gate would be proving something other
 * than what a mod author runs.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PACKAGE = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(PACKAGE, "../..");
const FIXTURE = path.join(PACKAGE, "tests/fixtures/golden-project");

/**
 * The packages the fixture resolves through `node_modules`. `@pdx-ts/pdxscript`
 * is here because `@pdx-ts/sdk` declares it as a dependency, so resolving the
 * SDK's sources means resolving that too; `@types` is what makes `"types":
 * ["node"]` findable without an install.
 */
const LINKS: readonly (readonly [string, string])[] = [
  ["@pdx-ts/sdk", "packages/sdk"],
  ["@pdx-ts/pdxscript", "packages/pdxscript"],
  ["@types", "node_modules/@types"],
];

export interface CommandResult {
  readonly status: number;
  /** stdout and stderr interleaved, which is how a failure reads. */
  readonly output: string;
}

export interface GoldenProject {
  readonly dir: string;
  readonly contentDir: string;
  readonly outDir: string;
  /** Writes one generated feature source into the project's content directory. */
  place(basename: string, contents: string): void;
  typecheck(): CommandResult;
  build(): CommandResult;
  /** Every file the build wrote, as `/`-separated paths relative to `outDir`. */
  outFiles(): string[];
  readOut(relPath: string): string;
  dispose(): void;
}

export function createGoldenProject(): GoldenProject {
  const dir = mkdtempSync(path.join(tmpdir(), "pdx-golden-project-"));
  cpSync(FIXTURE, dir, { recursive: true });

  for (const [specifier, target] of LINKS) {
    const link = path.join(dir, "node_modules", specifier);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(path.join(REPO, target), link);
  }

  const contentDir = path.join(dir, "src/content");
  const outDir = path.join(dir, "out");

  return {
    dir,
    contentDir,
    outDir,

    place(basename, contents) {
      writeFileSync(path.join(contentDir, basename), contents);
    },

    typecheck: () => run(path.join(REPO, "node_modules/.bin/tsc"), ["-p", dir], dir),

    build: () =>
      run(process.execPath, ["--conditions=pdx-source", "src/build-check.ts", outDir], dir),

    outFiles: () =>
      readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)))
        .map((relPath) => relPath.split(path.sep).join("/"))
        .sort(),

    readOut: (relPath) => readFileSync(path.join(outDir, relPath), "utf8"),

    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function run(command: string, args: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}
