import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { stringify } from "yaml";

import type { PureMod } from "./compiler/model.ts";
import { installedVanillaPackagePin } from "./identifiers/package-pin.ts";
import { vanillaPackageGameVersion } from "./identifiers/version-scheme.ts";
import { parseProjectLayout } from "./project-layout.ts";
import { resolveProjectRootPath } from "./project-root.ts";
import type { ModProjectManifest } from "./project.ts";

/** Configuration for the YAML project inspection command. */
export interface RunInspectOptions {
  /** Project Manifest used by the build. */
  readonly manifest: ModProjectManifest;
  /** Absolute project directory containing `package.json`. */
  readonly projectRoot: string | URL;
  /** Destination for the YAML report. Defaults to `process.stdout`. */
  readonly output?: Writable;
  /** Destination for a concise failure message. Defaults to `process.stderr`. */
  readonly errorOutput?: Writable;
}

interface PackageReport {
  readonly name: string | null;
  readonly version: string | null;
  readonly dependencies: {
    readonly sdk: { readonly requested: string | null; readonly resolved: string | null };
    readonly stellarisIds: {
      readonly requested: string | null;
      readonly resolved: string | null;
      readonly gameVersion: string | null;
    };
  };
}

interface PackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
}

/**
 * Compiles a mod inspection and writes one deterministic YAML document.
 *
 * Beyond evaluating `modInput`, the command reads only the project's package metadata. It does not
 * render or write the mod. A rejected build or unreadable package sets `process.exitCode` to `1`
 * and writes no partial YAML.
 *
 * @example
 * ```ts
 * await runInspect(buildTheMod(), {
 *   manifest,
 *   projectRoot: new URL("../", import.meta.url),
 * });
 * ```
 */
export async function runInspect(
  modInput: PureMod | PromiseLike<PureMod>,
  options: RunInspectOptions
): Promise<void> {
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;

  try {
    const projectRoot = resolveProjectRootPath(options.projectRoot);
    const [mod, projectPackage, sdkPackage] = await Promise.all([
      modInput,
      readPackage(path.join(projectRoot, "package.json")),
      readPackage(new URL("../package.json", import.meta.url)),
    ]);
    const idsPin = installedVanillaPackagePin();
    const idsVersion = idsPin.state === "read" ? idsPin.version : null;
    const report = inspectionReport(
      mod,
      options.manifest,
      packageReport(projectPackage, sdkPackage, idsVersion)
    );
    output.write(stringify(report, { aliasDuplicateObjects: false, lineWidth: 0 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorOutput.write(`Inspection failed: ${message}\n`);
    process.exitCode = 1;
  }
}

async function readPackage(location: string | URL): Promise<PackageJson> {
  const source = await readFile(location, "utf8");
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Package metadata at ${String(location)} must be a JSON object`);
  }
  return parsed;
}

function packageReport(
  projectPackage: PackageJson,
  sdkPackage: PackageJson,
  idsVersion: string | null
): PackageReport {
  const dependencies = requestedDependencies(projectPackage);
  const idsGameVersion =
    idsVersion === null || idsVersion === "0.0.0" ? null : vanillaPackageGameVersion(idsVersion);
  return {
    name: stringOrNull(projectPackage.name),
    version: stringOrNull(projectPackage.version),
    dependencies: {
      sdk: {
        requested: dependencies["@pdx-ts/sdk"] ?? null,
        resolved: stringOrNull(sdkPackage.version),
      },
      stellarisIds: {
        requested: dependencies["@pdx-ts/stellaris-ids"] ?? null,
        resolved: idsVersion,
        gameVersion: idsGameVersion,
      },
    },
  };
}

function requestedDependencies(packageJson: PackageJson): Readonly<Record<string, string>> {
  return {
    ...recordOfStrings(packageJson.peerDependencies),
    ...recordOfStrings(packageJson.devDependencies),
    ...recordOfStrings(packageJson.dependencies),
    ...recordOfStrings(packageJson.optionalDependencies),
  };
}

function inspectionReport(
  mod: PureMod,
  manifest: ModProjectManifest,
  projectPackage: PackageReport
): object {
  const layout = parseProjectLayout(manifest);
  const patches = mod.patchPlans.flatMap((plan) =>
    plan.assertions.map((assertion) => ({
      registry: assertion.registry,
      id: assertion.key,
      confidence: assertion.confidence,
    }))
  );

  return {
    schema: "pdx-sdk-inspection/v1",
    project: {
      manifest: "stellaris-mod.json",
      contentDirectory: layout.contentDirectory,
      package: projectPackage,
    },
    mod: {
      name: mod.config.name,
      prefix: mod.config.prefix,
      version: mod.config.version ?? null,
      supportedVersion: mod.config.supportedVersion,
      tags: mod.config.tags ?? [],
    },
    vanilla: {
      identifiers: "packaged",
      loadedView: mod.compileInputs.vanilla.loadedView,
      gameVersion: mod.compileInputs.vanilla.gameVersion ?? null,
      pathInventory: mod.compileInputs.vanilla.pathInventory ? "packaged-and-loaded" : "packaged",
    },
    summary: {
      features: mod.compileInputs.features.length,
      items: mod.compileInputs.features.reduce((count, feature) => count + feature.itemCount, 0),
      patches: patches.length,
      warnings: mod.warnings.length,
    },
    features: mod.compileInputs.features.map((feature) => ({
      stem: feature.stem ?? null,
      itemCount: feature.itemCount,
      itemIds: feature.itemIds,
    })),
    patches,
    warnings: mod.warnings.map((warning) => ({ ...warning })),
  };
}

function recordOfStrings(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
