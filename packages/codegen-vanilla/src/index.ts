/**
 * Regenerates `packages/stellaris-ids/` from an installed copy of the game.
 *
 * Run with `npm run codegen:vanilla`. Separate from `@pdx-ts/codegen-cwt` because
 * the source is different in kind: cwtools rules are
 * vendored and versioned in-repo, an install is a machine-local artifact that
 * changes when Paradox ships a patch. Different sources, different regeneration
 * triggers, different failure modes — one script each.
 *
 * Everything decided here is impure: which install, which version, where the
 * bytes land. The generation itself is `generate.ts`.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locateInstall } from "@pdx-ts/sdk/stellaris";

import { formatEmitted } from "./format.ts";
import { generateVanillaPackage, type VanillaReport } from "./generate.ts";

/**
 * Anchored to the module rather than the process, so the repo this writes into
 * is the repo this script lives in whatever directory npm was invoked from.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");
/** Repo-relative, for the report; {@link PACKAGE_DIR} is what the writes use. */
const PACKAGE = "packages/stellaris-ids";
const PACKAGE_DIR = path.join(ROOT, PACKAGE);
const OUT = path.join(PACKAGE_DIR, "src");

/**
 * Written through Prettier so the committed output matches the repo's style and
 * the pre-commit hook has nothing left to reformat — otherwise `lint-staged`
 * would rewrite these files and the drift check would report a false diff.
 */
function write(relative: string, contents: string): void {
  const target = path.join(OUT, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

function existingFiles(dir: string, prefix = ""): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? existingFiles(full, `${prefix}${name}/`)
      : [`${prefix}${name}`];
  });
}

/**
 * The install's own version, or a loud stop.
 *
 * The package version *is* the game version, so a missing or unexpected version
 * string cannot be defaulted past: it would stamp a package that claims to
 * describe a build nobody can identify. Paradox occasionally ships a four-part
 * version, which npm cannot express — that needs a deliberate mapping decision,
 * not a silent truncation.
 */
function readGameVersion(installRoot: string): string {
  const file = path.join(installRoot, "launcher-settings.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`${file} is missing, so the install states no version to stamp`);
  }
  const settings = JSON.parse(raw) as { rawVersion?: unknown };
  if (typeof settings.rawVersion !== "string" || settings.rawVersion === "") {
    throw new Error(`${file} has no rawVersion string`);
  }
  const version = settings.rawVersion.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `${file} states rawVersion ${settings.rawVersion}, which is not major.minor.patch. ` +
        "The package version is the game version, so a four-part Paradox version needs a " +
        "deliberate mapping to semver (and a note in PROVENANCE.md) before regenerating — " +
        "pick the npm version by hand rather than letting this script guess."
    );
  }
  return version;
}

function stampVersion(version: string): void {
  const file = path.join(PACKAGE_DIR, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  manifest["version"] = version;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function reportSection(title: string, lines: readonly string[]): void {
  if (lines.length === 0) {
    return;
  }
  console.log(`\n${title} (${lines.length}):`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

function printReport(report: VanillaReport, removed: readonly string[]): void {
  const ids = report.registries.reduce((total, one) => total + one.ids, 0);
  const names = report.scripted.reduce((total, one) => total + one.definitions, 0);
  console.log(`Stellaris ${report.gameVersion} -> ${PACKAGE}`);
  console.log(
    `\n${report.registries.length} registries, ${ids} ids | ` +
      `${report.scripted.length} scripted tables, ${names} names | ` +
      `${report.emittedFiles} files emitted`
  );
  console.log(
    `licensing gate: ${report.identifiersChecked} identifiers checked, ` +
      `${report.rejections} rejected | parser diagnostics: ${report.diagnostics}`
  );

  reportSection(
    "Registries",
    report.registries.map(
      (one) => `${one.registry}: ${one.ids} ids from ${one.files} files` + suffix(one)
    )
  );
  reportSection(
    "Tries",
    report.registries.flatMap((one) =>
      one.trie === null
        ? []
        : [
            `${one.registry}: ${one.trie.buckets} top-level keys ` +
              `(${one.trie.rootLeaves} of them ids, not buckets), ` +
              `largest bucket ${one.trie.largestBucket} ids, ` +
              `${one.trie.flatOnly} routed to the flat union only`,
          ]
    )
  );
  reportSection(
    "Scripted",
    report.scripted.map(
      (one) =>
        `${one.registry}: ${one.definitions} definitions from ${one.files} files ` +
        `(${one.parameterized} parameterized)` +
        (one.missing ? " — DIRECTORY MISSING" : "")
    )
  );
  reportSection("Inferred scopes", report.scripted.map(scopeLine));
  reportSection(
    "Keys the rules do not cover, by bindings they cost a narrowing",
    report.scripted.flatMap((one) =>
      one.unknownKeys.map(([key, count]) => `${one.registry}: ${count} × ${key}`)
    )
  );
  reportSection(
    "Scope intersections that emptied and fell back to unconstrained",
    report.scripted.flatMap((one) => one.emptied.map((name) => `${one.registry}: ${name}`))
  );
  reportSection(
    "Bindings renamed to avoid a collision",
    report.scripted.flatMap((one) => one.renamed)
  );
  reportSection("Registries with no definitions found", emptyRegistries(report));
  reportSection("Stale generated files removed", removed);
}

/**
 * What the scope inference achieved, per registry.
 *
 * Read this after a game patch. Every binding is *correct* whatever the numbers
 * say — an unreadable body widens to `any`, it never narrows wrongly — so a
 * collapse toward "unconstrained" is not a broken build. It means vanilla
 * started writing something the rules do not cover, the emitted types quietly
 * got weaker, and the analysis needs a look.
 *
 * The two sections after this one are what make that look possible: they name
 * the keys that cost the narrowings and the definitions whose intersection
 * emptied. A share on its own says coverage moved without saying what moved it.
 */
function scopeLine(one: VanillaReport["scripted"][number]): string {
  const total = one.definitions;
  const at = (size: number) => one.scopeSizes.get(size) ?? 0;
  const within = (limit: number) =>
    [...one.scopeSizes].reduce(
      (sum, [size, count]) => (size >= 1 && size <= limit ? sum + count : sum),
      0
    );
  const share = (count: number) => (total === 0 ? "n/a" : `${((count / total) * 100).toFixed(1)}%`);
  return (
    `${one.registry}: ${share(total - at(0))} narrowed — ` +
    `${at(1)} to one scope, ${within(5)} to five or fewer, ${at(0)} unconstrained`
  );
}

function suffix(one: VanillaReport["registries"][number]): string {
  if (one.missing) {
    return " — DIRECTORY MISSING";
  }
  return one.diagnostics === 0 ? "" : ` (${one.diagnostics} parser repairs)`;
}

function emptyRegistries(report: VanillaReport): string[] {
  return report.registries
    .filter((one) => one.ids === 0)
    .map(
      (one) =>
        `${one.registry} — ${one.missing ? "path does not exist" : `${one.files} files, no ids`}; ` +
        "the resolved path or keyword is wrong"
    );
}

async function main(): Promise<void> {
  const installRoot = locateInstall();
  const gameVersion = readGameVersion(installRoot);
  const { files, report } = generateVanillaPackage({
    installRoot,
    gameVersion,
    configRoot: CONFIG,
    docsRoot: DOCS,
  });

  // Only ever inside `src/`: package.json, LICENSE, PROVENANCE.md, README.md,
  // tsconfig.json, and tests/ are hand-written and none of this script's
  // business.
  const formatted = await formatEmitted(files, OUT);
  const stale = existingFiles(OUT).filter((file) => !formatted.has(file));
  for (const file of stale) {
    rmSync(path.join(OUT, file));
  }
  for (const [file, contents] of formatted) {
    write(file, contents);
  }
  stampVersion(gameVersion);
  printReport(report, stale);
}

await main();
