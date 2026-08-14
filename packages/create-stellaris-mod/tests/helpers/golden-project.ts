/**
 * The real project a generated file has to survive.
 *
 * A production project plan materialized into a temporary directory. The helper
 * symlinks this repository's packages in as `node_modules`, drops generated
 * source into the content directory, and then runs two child processes over it
 * — `tsc -p` and the project's own build.
 *
 * Child processes, not in-process imports, and for a specific reason: `#mod` is
 * resolved by Node's own resolver reading a real `package.json`, and
 * The source-linked matrix deliberately adds `pdx-source` to its materialized
 * tsconfig after planning, while a production scaffold correctly consumes
 * published `dist/`. Vitest's resolver would answer both questions its own way,
 * and then the gate would be proving something other than what a mod author
 * runs.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

import type { Resolved } from "../../src/options.ts";
import { planFiles } from "../../src/plan.ts";

const PACKAGE = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(PACKAGE, "../..");

const GOLDEN_PROJECT: Resolved = {
  targetDir: "/tmp/golden-project",
  name: "Golden Fixture",
  prefix: "golden_mod",
  supportedVersion: "v4.4.*",
  tags: ["Technologies"],
  installPath: undefined,
  installPathIsExplicit: false,
  gameVersion: undefined,
  localSdk: undefined,
  prettier: false,
  eslint: false,
  git: false,
  install: false,
  packageManager: "npm",
};

/**
 * The packages the fixture resolves through `node_modules`. `@pdx-ts/pdxscript`
 * and `@pdx-ts/stellaris-ids` are here because `@pdx-ts/sdk` declares them —
 * the first as a dependency, the second as the peer whose id tables it imports
 * (ADR-0006) — so resolving the SDK's sources means resolving both; `@types` is
 * what makes `"types": ["node"]` findable without an install.
 */
const LINKS: readonly (readonly [string, string])[] = [
  ["@pdx-ts/sdk", "packages/sdk"],
  ["@pdx-ts/pdxscript", "packages/pdxscript"],
  ["@pdx-ts/stellaris-ids", "packages/stellaris-ids"],
  ["@types", "node_modules/@types"],
  ["vitest", "node_modules/vitest"],
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
  /** Whether this source-linked test harness added its compiler condition. */
  usesSourceCondition(): boolean;
  /** Writes one generated feature source into the project's content directory. */
  place(basename: string, contents: string): void;
  typecheck(): CommandResult;
  build(): CommandResult;
  /** Every file the build wrote, as `/`-separated paths relative to `outDir`. */
  outFiles(): string[];
  readOut(relPath: string): string;
  dispose(): void;
}

export interface TempProject {
  /** The copy, as a test refers to it. */
  readonly dir: string;
  /** The same directory after `realpath`, which is what the CLI prints. */
  readonly realDir: string;
  dispose(): void;
}

/**
 * The production plan, materialized *without* the `node_modules` symlinks.
 *
 * That absence is the point rather than an economy: `generate` never loads the
 * SDK, so a project it can generate into is one that has not been installed
 * yet. The fixture's own `package.json` declares `@pdx-ts/sdk` in
 * `devDependencies`, which is what the compatibility preflight reads.
 */
export function createTempProject(): TempProject {
  const dir = mkdtempSync(path.join(tmpdir(), "pdx-generate-project-"));
  materializeGoldenProject(dir);
  return {
    dir,
    // macOS puts temporary directories under a symlinked /var, so the path the
    // CLI resolves and prints is not the one `mkdtemp` returned.
    realDir: realpathSync(dir),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function createGoldenProject(): GoldenProject {
  const dir = mkdtempSync(path.join(tmpdir(), "pdx-golden-project-"));
  materializeGoldenProject(dir);
  addSourceLinkedCompilerCondition(dir);

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

    usesSourceCondition: () => hasSourceCompilerCondition(dir),

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

/**
 * Materialize the production scaffold, then make the two test-only changes the
 * matrix needs: an empty content directory and a build harness whose output
 * directory is supplied by the test. `createGoldenProject` adds its source-link
 * compiler condition afterwards; it is intentionally not production plan data.
 * No committed mirror can silently drift from `planFiles`.
 */
function materializeGoldenProject(dir: string): void {
  for (const [relPath, contents] of planFiles(GOLDEN_PROJECT, "golden-fixture")) {
    const target = path.join(dir, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }

  rmSync(path.join(dir, "src/content/example.ts"));
  rmSync(path.join(dir, "src/content/example.test.ts"));
  writeFileSync(path.join(dir, "src/build-check.ts"), BUILD_CHECK);
}

/**
 * The matrix links unbuilt workspace packages, so TypeScript must resolve their
 * source export condition. This is test harness state after materialization,
 * never a generated project's compiler policy: a real scaffold consumes the
 * packages' default `dist/` exports.
 */
function addSourceLinkedCompilerCondition(dir: string): void {
  const configPath = path.join(dir, "tsconfig.json");
  const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
  if (parsed.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  }
  const config = parsed.config as { compilerOptions?: Record<string, unknown> };
  config.compilerOptions = { ...config.compilerOptions, customConditions: ["pdx-source"] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function hasSourceCompilerCondition(dir: string): boolean {
  const config = JSON.parse(readFileSync(path.join(dir, "tsconfig.json"), "utf8")) as {
    compilerOptions?: { customConditions?: unknown };
  };
  return (
    Array.isArray(config.compilerOptions?.customConditions) &&
    config.compilerOptions.customConditions.includes("pdx-source")
  );
}

const BUILD_CHECK = `/** The matrix harness's parameterized production build. */
import { render, write } from "@pdx-ts/sdk";

import { buildTheMod } from "./mod.ts";

const outDir = process.argv[2];
if (outDir === undefined) {
  throw new Error("usage: node --conditions=pdx-source src/build-check.ts <outDir>");
}

const mod = await buildTheMod();
const files = render(mod);
await write(outDir, files);

for (const warning of mod.warnings) {
  console.warn(\`warning (\${warning.code}): \${warning.message}\`);
}
for (const relPath of files.keys()) {
  console.log(\`wrote \${relPath}\`);
}
`;

function run(command: string, args: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}
