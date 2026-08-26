import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { locateInstall } from "@pdx-ts/sdk/installation";
import semver from "semver";

/** The public packages that share one SDK release coordinate. */
export const RELEASE_PACKAGES = [
  { name: "create-stellaris-mod", directory: "packages/create-stellaris-mod" },
  { name: "@pdx-ts/pdxscript", directory: "packages/pdxscript" },
  {
    name: "@pdx-ts/sdk",
    directory: "packages/sdk",
    dependencies: [{ section: "dependencies", name: "@pdx-ts/pdxscript" }],
    scaffolderManifestKey: "sdk",
  },
  {
    name: "@pdx-ts/sdk-testing",
    directory: "packages/sdk-testing",
    dependencies: [
      { section: "dependencies", name: "@pdx-ts/pdxscript" },
      { section: "peerDependencies", name: "@pdx-ts/sdk" },
    ],
    scaffolderManifestKey: "sdkTesting",
  },
];

const RELEASE_LITERAL_FILES = [
  "packages/create-stellaris-mod/tests/transcripts.test.ts",
  "packages/create-stellaris-mod/tests/goldens/transcripts/generate-sdk-range-not-subset.txt",
];

const PACKAGE_MANIFEST = "package.json";
const SCAFFOLDER_RELEASE_MANIFEST = "packages/create-stellaris-mod/src/release-manifest.ts";
const IDENTIFIERS_PACKAGE = "@pdx-ts/stellaris-ids";

/** Refuses anything other than an exact semantic version coordinate. */
export function validateReleaseVersion(version) {
  if (semver.valid(version) !== version) {
    throw new Error(
      `Release version must be an exact semantic version; received ${JSON.stringify(version)}.`
    );
  }
  return version;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceJsonStringProperty(contents, name, value, file) {
  const pattern = new RegExp(`("${escapeRegularExpression(name)}":\\s*")[^"]*(")`, "g");
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${file} must contain exactly one ${JSON.stringify(name)} string property.`);
  }
  return contents.replace(pattern, `$1${value}$2`);
}

function releasePackageManifest(root, releasePackage) {
  return join(root, releasePackage.directory, PACKAGE_MANIFEST);
}

/** Reads and proves the current release coordinate shared by all release packages. */
export function currentReleaseVersion(root) {
  const versions = RELEASE_PACKAGES.map((releasePackage) => {
    const manifest = readJson(releasePackageManifest(root, releasePackage));
    if (typeof manifest.version !== "string") {
      throw new Error(`${releasePackage.directory}/package.json has no string version.`);
    }
    return { packageName: releasePackage.name, version: manifest.version };
  });
  const [first] = versions;
  if (first === undefined) {
    throw new Error("The release package list is empty.");
  }
  const mismatched = versions.filter(({ version }) => version !== first.version);
  if (mismatched.length > 0) {
    throw new Error(
      `Release packages do not share one current version: ${versions
        .map(({ packageName, version }) => `${packageName}@${version}`)
        .join(", ")}.`
    );
  }
  return first.version;
}

function releaseVersionsIn(contents) {
  return (
    contents.match(
      /(?<![\w.-])\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?![\w.-])/g
    ) ?? []
  );
}

function assertReleaseLiteralsCurrent(root, version) {
  const stale = RELEASE_LITERAL_FILES.flatMap((file) =>
    releaseVersionsIn(readFileSync(join(root, file), "utf8"))
      .filter((literal) => literal !== version)
      .map((literal) => `${file}: ${literal}`)
  );
  if (stale.length > 0) {
    throw new Error(
      `Stale release version literal(s) found; update them before preparing a release:\n${stale
        .map((entry) => `  - ${entry}`)
        .join("\n")}`
    );
  }
}

function replaceLiteral(file, oldVersion, newVersion) {
  const contents = readFileSync(file, "utf8");
  writeFileSync(file, contents.replaceAll(oldVersion, newVersion));
}

function updateScaffolderManifest(root, version) {
  const file = join(root, SCAFFOLDER_RELEASE_MANIFEST);
  let contents = readFileSync(file, "utf8");
  for (const releasePackage of RELEASE_PACKAGES) {
    if (releasePackage.scaffolderManifestKey === undefined) {
      continue;
    }
    const pattern = new RegExp(
      `(\\s${releasePackage.scaffolderManifestKey}: \\{\\n\\s+packageName: "${releasePackage.name}",\\n\\s+range: ")[^"]+("[,])`
    );
    if (!pattern.test(contents)) {
      throw new Error(
        `Could not update ${releasePackage.scaffolderManifestKey} in ${SCAFFOLDER_RELEASE_MANIFEST}.`
      );
    }
    contents = contents.replace(pattern, `$1${version}$2`);
  }
  writeFileSync(file, contents);
}

function updatePackageManifest(root, releasePackage, version) {
  const file = releasePackageManifest(root, releasePackage);
  let contents = readFileSync(file, "utf8");
  contents = replaceJsonStringProperty(contents, "version", version, file);
  for (const dependency of releasePackage.dependencies ?? []) {
    contents = replaceJsonStringProperty(contents, dependency.name, `^${version}`, file);
  }
  writeFileSync(file, contents);
}

/** Updates only release-owned coordinates, leaving unrelated dependencies untouched. */
export function prepareReleaseCoordinates(root, version) {
  validateReleaseVersion(version);
  const previousVersion = currentReleaseVersion(root);
  assertReleaseLiteralsCurrent(root, previousVersion);

  for (const releasePackage of RELEASE_PACKAGES) {
    for (const dependency of releasePackage.dependencies ?? []) {
      const manifest = readJson(releasePackageManifest(root, releasePackage));
      const dependencies = manifest[dependency.section];
      if (
        typeof dependencies !== "object" ||
        dependencies === null ||
        !(dependency.name in dependencies)
      ) {
        throw new Error(
          `${releasePackage.directory}/package.json has no ${dependency.section}.${dependency.name}.`
        );
      }
    }
    updatePackageManifest(root, releasePackage, version);
  }

  updateScaffolderManifest(root, version);
  for (const file of RELEASE_LITERAL_FILES) {
    replaceLiteral(join(root, file), previousVersion, version);
  }
  assertReleaseLiteralsCurrent(root, version);
  return { previousVersion, version, packages: RELEASE_PACKAGES };
}

function run(root, command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

/** Prepares package coordinates and refreshes the npm lockfile without publishing anything. */
export function prepareRelease(root, version, execute = run) {
  const prepared = prepareReleaseCoordinates(root, version);
  execute(root, "npm", ["install", "--package-lock-only", "--ignore-scripts"]);
  return prepared;
}

/** States whether regenerated identifiers require a manually chosen new revision. */
export function stellarisIdsRevisionDecision(version, changed) {
  if (!changed) {
    return {
      changed: false,
      message: `${IDENTIFIERS_PACKAGE} did not change; no new revision is needed.`,
    };
  }
  const match = /^(.*)-r\.(\d+)$/.exec(version);
  const next = match === null ? "a new -r.1 revision" : `${match[1]}-r.${Number(match[2]) + 1}`;
  return {
    changed: true,
    message: `${IDENTIFIERS_PACKAGE} changed; it needs a new revision (${next}) before publication.`,
  };
}

function cleanPackageDists(root) {
  for (const name of readdirSync(join(root, "packages"))) {
    rmSync(join(root, "packages", name, "dist"), { recursive: true, force: true });
  }
}

function installedStellarisPath() {
  try {
    return locateInstall();
  } catch {
    return undefined;
  }
}

function trackedIdentifierFiles(root) {
  const ids = join(root, "packages", "stellaris-ids");
  const result = [];
  const collect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        collect(file);
      } else if (entry.isFile()) {
        result.push([relative(ids, file), readFileSync(file)]);
      }
    }
  };
  collect(join(ids, "src"));
  result.push([PACKAGE_MANIFEST, readFileSync(join(ids, PACKAGE_MANIFEST))]);
  return result;
}

function identifierFilesChanged(before, after) {
  if (before.length !== after.length) {
    return true;
  }
  return before.some(
    ([file, contents], index) => file !== after[index][0] || !contents.equals(after[index][1])
  );
}

function runCheckStep(results, name, action) {
  try {
    action();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Runs the release gates and returns each result so callers can print a concise summary. */
export function checkRelease(root, execute = run, installPath = installedStellarisPath()) {
  const results = [];
  const npm = (name, args) => runCheckStep(results, name, () => execute(root, "npm", args));

  npm("typecheck", ["run", "typecheck"]);
  npm("test", ["test"]);
  npm("asset-scale", ["run", "test:asset-scale"]);
  runCheckStep(results, "docs from clean sources", () => {
    cleanPackageDists(root);
    execute(root, "npm", ["run", "docs:build"]);
  });
  npm("build", ["run", "build"]);
  npm("CWT codegen drift", ["run", "codegen:check"]);
  npm("verified-build drift", ["run", "codegen:verified-build:check"]);

  for (const releasePackage of [...RELEASE_PACKAGES, { name: IDENTIFIERS_PACKAGE }]) {
    npm(`pack ${releasePackage.name}`, ["pack", "--dry-run", "--workspace", releasePackage.name]);
  }

  if (installPath === undefined) {
    results.push({
      name: "vanilla codegen drift",
      passed: false,
      skipped: true,
      error: "SKIPPED: no Stellaris install found; codegen:vanilla:check was not run.",
    });
    return results;
  }

  const before = trackedIdentifierFiles(root);
  runCheckStep(results, "vanilla codegen drift", () =>
    execute(root, "npm", ["run", "codegen:vanilla:check"])
  );
  const changed = identifierFilesChanged(before, trackedIdentifierFiles(root));
  const version = readJson(join(root, "packages", "stellaris-ids", PACKAGE_MANIFEST)).version;
  results.push({
    name: "stellaris-ids revision",
    passed: !changed,
    ...stellarisIdsRevisionDecision(version, changed),
  });
  return results;
}

function printCoordinates(prepared) {
  console.log(`Prepared ${prepared.version} from ${prepared.previousVersion}:`);
  for (const releasePackage of prepared.packages) {
    console.log(`  ${releasePackage.name}@${prepared.version}`);
  }
}

function printSummary(results) {
  for (const result of results) {
    const status = result.passed ? "PASS" : result.skipped ? "SKIPPED" : "FAIL";
    console.log(`${status} ${result.name}${result.error === undefined ? "" : `: ${result.error}`}`);
  }
  const passed = results.every((result) => result.passed);
  console.log(passed ? "Release readiness: PASS" : "Release readiness: FAIL");
  return passed;
}

function main(args) {
  const [command, version] = args;
  if (command === "prepare" && version !== undefined && args.length === 2) {
    printCoordinates(prepareRelease(process.cwd(), version));
    return;
  }
  if (command === "check" && args.length === 1) {
    if (!printSummary(checkRelease(process.cwd()))) {
      process.exitCode = 1;
    }
    return;
  }
  throw new Error("Usage: node scripts/release.mjs prepare <version> | check");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
