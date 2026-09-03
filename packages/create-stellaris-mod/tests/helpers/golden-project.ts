/**
 * The real project a generated file has to survive.
 *
 * A production project plan materialized into a temporary directory. The helper
 * symlinks this repository's packages in as `node_modules`, drops generated
 * source into `src/features/` and declares it in `src/features.ts`, and then
 * runs two child processes over it — `tsc -p` and the project's own build.
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

import { FEATURE_LIST_PATH, featureDeclaration } from "../../src/catalog/declaration.ts";
import type { Resolved } from "../../src/options.ts";
import { planProject } from "../../src/plan.ts";
import { featuresTs } from "../../src/templates/source.ts";

const PACKAGE = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(PACKAGE, "../..");
const TSC = path.resolve(REPO, "node_modules/typescript/lib/tsc.js");

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
  llmSupport: true,
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
  readonly featuresDir: string;
  readonly outDir: string;
  /** Whether this source-linked test harness added its compiler condition. */
  usesSourceCondition(): boolean;
  /**
   * Writes one generated feature source into `src/features/` and rewrites
   * `src/features.ts` to declare every module placed so far. Placing a
   * basename again replaces its contents and keeps its one line.
   */
  place(basename: `${string}.ts`, contents: string): void;
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
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pdx-generate-project-")));
  materializeGoldenProject(dir);
  return {
    dir,
    realDir: dir,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function createGoldenProject(): GoldenProject {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pdx-golden-project-")));
  materializeGoldenProject(dir);
  addHarnessCompilerSettings(dir);

  for (const [specifier, target] of LINKS) {
    const link = path.join(dir, "node_modules", specifier);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(path.join(REPO, target), link);
  }

  const featuresDir = path.join(dir, "src/features");
  const outDir = path.join(dir, "out");
  const placed = new Set<`${string}.ts`>();

  return {
    dir,
    featuresDir,
    outDir,

    usesSourceCondition: () => hasSourceCompilerCondition(dir),

    place(basename, contents) {
      writeFileSync(path.join(featuresDir, basename), contents);
      placed.add(basename);
      writeFileSync(path.join(dir, FEATURE_LIST_PATH), featureList([...placed]));
    },

    typecheck: () => run(process.execPath, [TSC, "-p", dir], dir),

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
 * Materialize the production scaffold, then make the three test-only changes
 * the matrix needs: an empty feature directory, a feature list that declares
 * nothing yet, and a build harness whose output directory is supplied by the
 * test. `createGoldenProject` adds its harness compiler settings afterwards;
 * they are intentionally not production plan data. No committed mirror can
 * silently drift from `planProject`.
 */
function materializeGoldenProject(dir: string): void {
  for (const [relPath, entry] of planProject(GOLDEN_PROJECT, "golden-fixture")) {
    const target = path.join(dir, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    if (entry.kind === "file") {
      writeFileSync(target, entry.contents);
    } else {
      symlinkSync(entry.target, target);
    }
  }

  rmSync(path.join(dir, "src/features/example.ts"));
  rmSync(path.join(dir, "src/features/example.test.ts"));
  writeFileSync(path.join(dir, FEATURE_LIST_PATH), featureList([]));
  writeFileSync(path.join(dir, "src/build-check.ts"), BUILD_CHECK);
}

/**
 * The scaffold's own feature list with its example line replaced by one line
 * per placed module. The docblock is kept so the file is the production one
 * minus the example, and the binding is the stem itself, which every accepted
 * stem can be once suffixed: `class` and `await` are legal stems.
 */
function featureList(basenames: readonly `${string}.ts`[]): string {
  const docblock = featuresTs(GOLDEN_PROJECT).replace(/\nexport \{[^\n]*\n$/, "\n");
  const declarations = basenames.map((basename) =>
    featureDeclaration({ identifier: `${basename.replace(/\.ts$/, "")}_feature`, basename })
  );
  return declarations.length === 0 ? docblock : `${docblock}${declarations.join("\n")}\n`;
}

/**
 * The matrix links unbuilt workspace packages, so TypeScript must resolve their
 * source export condition. Incremental mode is the other harness setting: one
 * project hosts many `typecheck()` runs that differ only in the content file,
 * and the build-info cache turns every run after the first from a full SDK
 * typecheck into a re-check of the swapped file — the swapped file itself is
 * always checked in full, so a gate that must refuse bad source still does.
 * Both are test harness state after materialization, never a generated
 * project's compiler policy: a real scaffold consumes the packages' default
 * `dist/` exports and starts cold.
 */
function addHarnessCompilerSettings(dir: string): void {
  const configPath = path.join(dir, "tsconfig.json");
  const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
  if (parsed.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  }
  const config = parsed.config as { compilerOptions?: Record<string, unknown> };
  config.compilerOptions = {
    ...config.compilerOptions,
    customConditions: ["pdx-source"],
    incremental: true,
    tsBuildInfoFile: "./.tsbuildinfo",
  };
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

import { buildTheMod } from "./build.ts";

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
