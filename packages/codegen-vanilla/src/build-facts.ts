import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { eventKinds, type EventKindSpec } from "@pdx-ts/codegen-cwt/lower/event-kinds";
import { loadScopeFacts } from "@pdx-ts/codegen-cwt/lower/scope-facts";
import { scanInstallPaths, type VanillaPathScan } from "@pdx-ts/sdk/installation";

import { compareIdentifiers } from "./emit.ts";
import { inferScopes, type InferredScope, type ScriptedKind } from "./infer-scopes.ts";
import { VANILLA_MANIFEST, type VanillaIdRow, type VanillaScriptedRow } from "./manifest.ts";
import { readComplexEnumMembers, type ComplexEnumMembers } from "./read-complex-enums.ts";
import { readVanillaEvents, type VanillaEventsRead } from "./read-events.ts";
import { readRegistryIds, type RegistryIds } from "./read-ids.ts";
import { readLocalizationKeys, type LocalizationKeys } from "./read-localization.ts";
import { readScriptedDefinitions, type ScriptedRegistry } from "./read-scripted.ts";
import { resolveRegistries, type RegistrySpec } from "./resolve.ts";

export interface VanillaBuildFactsOptions {
  readonly installRoot: string;
  readonly gameVersion: string;
  readonly configRoot: string;
  readonly docsRoot: string;
}

export interface EvidenceHash {
  readonly sha256: string;
}

export interface VersionedEvidence extends EvidenceHash {
  readonly version: string;
}

export interface VanillaBuildFacts {
  readonly formatVersion: 1;
  readonly gameVersion: string;
  readonly evidence: {
    readonly install: EvidenceHash;
    readonly cwt: VersionedEvidence;
    readonly docs: VersionedEvidence;
  };
  readonly eventKinds: readonly EventKindSpec[];
  readonly events: VanillaEventsRead;
  readonly registries: readonly RegistryBuildFacts[];
  readonly complexEnums: readonly ComplexEnumMembers[];
  readonly scripted: Readonly<Record<ScriptedKind, ScriptedRegistry>>;
  readonly inferredScopes: Readonly<Record<ScriptedKind, readonly InferredScope[]>>;
  /**
   * Which paths the install occupies — the loose files plus the DLC archives'
   * entry names. Read through the SDK's own scanner rather than a second walk
   * here, because the SDK checks a mod's paths against a live install with the
   * same code that produced the packaged inventory.
   */
  readonly paths: VanillaPathScan;
  /** Every localization key the install's english tree defines. */
  readonly localization: LocalizationKeys;
}

export interface RegistryBuildFacts {
  readonly spec: RegistrySpec;
  readonly read: RegistryIds;
}

function versionParts(version: string): readonly [string, string, string] | null {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : [match[1]!, match[2]!, match[3]!];
}

function docsVersion(docsRoot: string): string {
  const version = path.basename(docsRoot).replace(/^v/, "");
  if (versionParts(version) === null) {
    throw new Error(
      `script docs directory ${JSON.stringify(path.basename(docsRoot))} has no version`
    );
  }
  return version;
}

function assertCompatible(gameVersion: string, evidenceVersion: string): void {
  const game = versionParts(gameVersion);
  if (game === null) {
    throw new Error(`game version ${JSON.stringify(gameVersion)} is not major.minor.patch`);
  }
  const docs = versionParts(evidenceVersion)!;
  if (game[0] !== docs[0] || game[1] !== docs[1]) {
    throw new Error(
      `Stellaris ${gameVersion} is incompatible with script docs ${evidenceVersion}; ` +
        "their major.minor compatibility versions must match"
    );
  }
}

function filesUnder(root: string, recurse: boolean): string[] {
  try {
    if (!statSync(root).isDirectory()) {
      return [root];
    }
  } catch {
    return [];
  }
  const names = readdirSync(root).sort(compareIdentifiers);
  return names.flatMap((name) => {
    const full = path.join(root, name);
    return statSync(full).isDirectory() ? (recurse ? filesUnder(full, recurse) : []) : [full];
  });
}

interface EvidenceInput {
  readonly root: string;
  readonly extension?: string;
  readonly recurse: boolean;
}

function evidenceHash(root: string, inputs: readonly EvidenceInput[]): string {
  const hash = createHash("sha256");
  const unique = new Map(
    inputs.map((input) => [
      `${input.root}\0${input.extension ?? ""}\0${input.recurse ? "1" : "0"}`,
      input,
    ])
  );
  for (const input of [...unique.values()].sort(
    (left, right) =>
      compareIdentifiers(left.root, right.root) ||
      compareIdentifiers(left.extension ?? "", right.extension ?? "") ||
      Number(left.recurse) - Number(right.recurse)
  )) {
    const absolute = path.join(root, input.root);
    const files = filesUnder(absolute, input.recurse).filter(
      (file) => input.extension === undefined || file.endsWith(input.extension)
    );
    if (files.length === 0) {
      hash.update(`missing\0${input.root}\0${input.extension ?? ""}\0`);
      continue;
    }
    for (const file of files) {
      const relative = path.relative(root, file).split(path.sep).join("/");
      hash.update(relative);
      hash.update("\0");
      hash.update(readFileSync(file));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

function cwtVersion(configRoot: string): string {
  const versionFile = path.join(path.dirname(configRoot), "VERSION.md");
  const text = readFileSync(versionFile, "utf8");
  const commit = /`([0-9a-f]{40})`/.exec(text)?.[1];
  if (commit === undefined) {
    throw new Error(`${versionFile} has no 40-character upstream commit`);
  }
  return commit;
}

export function buildVanillaFacts(options: VanillaBuildFactsOptions): VanillaBuildFacts {
  const evidenceDocsVersion = docsVersion(options.docsRoot);
  assertCompatible(options.gameVersion, evidenceDocsVersion);

  const scriptedRows = VANILLA_MANIFEST.filter(
    (row): row is VanillaScriptedRow => row.kind === "scripted"
  );
  const idRows = VANILLA_MANIFEST.filter((row): row is VanillaIdRow => row.kind === "ids");
  const rowFor = (registry: string): VanillaScriptedRow => {
    const row = scriptedRows.find((one) => one.registry === registry);
    if (row === undefined) {
      throw new Error(`vanilla manifest has no ${registry} row`);
    }
    return row;
  };
  const read = (registry: string): ScriptedRegistry => {
    const row = rowFor(registry);
    return readScriptedDefinitions(options.installRoot, row.registry, row.dir);
  };

  const rules = loadRules(options.configRoot);
  const kinds = eventKinds(rules);
  const events = readVanillaEvents(options.installRoot, options.configRoot, kinds);
  const registries = resolveRegistries(options.configRoot, idRows).map((spec) => ({
    spec,
    read: readRegistryIds(options.installRoot, spec),
  }));
  const complexEnums = [...rules.complexEnums.values()].map((spec) =>
    readComplexEnumMembers(options.installRoot, spec)
  );
  const scripted = {
    trigger: read("scripted_trigger"),
    effect: read("scripted_effect"),
  } satisfies Record<ScriptedKind, ScriptedRegistry>;
  const inferredScopes = inferScopes(loadScopeFacts(options.configRoot, options.docsRoot), {
    trigger: scripted.trigger.definitions,
    effect: scripted.effect.definitions,
  });
  // After the id readers on purpose. Those are what a poisoned install fails
  // on, and a whole-install walk that ran first would decide the failure of a
  // run whose real complaint is a name that must not be emitted.
  const paths = scanInstallPaths(options.installRoot);
  const localization = readLocalizationKeys(options.installRoot);
  const installEvidenceInputs: EvidenceInput[] = [
    { root: events.path, extension: events.extension, recurse: true },
    ...scriptedRows.map((row) => ({ root: row.dir, extension: ".txt", recurse: true })),
    ...registries.map(({ spec }) => ({
      root: spec.path,
      extension: spec.extension,
      recurse: !spec.pathStrict,
    })),
    ...[...rules.complexEnums.values()].map((spec) => ({
      root: spec.path.replace(/^game\//, ""),
      extension: spec.extension,
      recurse: true,
    })),
  ];

  return {
    formatVersion: 1,
    gameVersion: options.gameVersion,
    evidence: {
      install: {
        sha256: evidenceHash(options.installRoot, installEvidenceInputs),
      },
      cwt: {
        version: cwtVersion(options.configRoot),
        sha256: evidenceHash(options.configRoot, [{ root: ".", extension: ".cwt", recurse: true }]),
      },
      docs: {
        version: evidenceDocsVersion,
        sha256: evidenceHash(options.docsRoot, [
          { root: "triggers.log", recurse: false },
          { root: "effects.log", recurse: false },
          { root: "scopes.log", recurse: false },
        ]),
      },
    },
    eventKinds: kinds,
    events,
    registries,
    complexEnums,
    scripted,
    inferredScopes,
    paths,
    localization,
  };
}
