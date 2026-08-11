import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadRules } from "@pdx-ts/codegen-cwt/cwt/rules";
import { eventKinds, type EventKindSpec } from "@pdx-ts/codegen-cwt/event-kinds";
import { loadScopeFacts } from "@pdx-ts/codegen-cwt/scope-facts";

import { compareIdentifiers } from "./emit.ts";
import { inferScopes, type InferredScope, type ScriptedKind } from "./infer-scopes.ts";
import { VANILLA_MANIFEST, type VanillaScriptedRow } from "./manifest.ts";
import { readVanillaEvents, type VanillaEventsRead } from "./read-events.ts";
import { readScriptedDefinitions, type ScriptedRegistry } from "./read-scripted.ts";

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
  readonly scripted: Readonly<Record<ScriptedKind, ScriptedRegistry>>;
  readonly inferredScopes: Readonly<Record<ScriptedKind, readonly InferredScope[]>>;
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

function filesUnder(root: string): string[] {
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
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

function evidenceHash(
  root: string,
  relativeRoots: readonly string[],
  includes: (relative: string) => boolean
): string {
  const hash = createHash("sha256");
  for (const relativeRoot of [...relativeRoots].sort(compareIdentifiers)) {
    const absolute = path.join(root, relativeRoot);
    const files = filesUnder(absolute).filter((file) =>
      includes(path.relative(root, file).split(path.sep).join("/"))
    );
    if (files.length === 0) {
      hash.update(`missing\0${relativeRoot}\0`);
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

  const kinds = eventKinds(loadRules(options.configRoot));
  const events = readVanillaEvents(options.installRoot, options.configRoot, kinds);
  const scripted = {
    trigger: read("scripted_trigger"),
    effect: read("scripted_effect"),
  } satisfies Record<ScriptedKind, ScriptedRegistry>;
  const inferredScopes = inferScopes(loadScopeFacts(options.configRoot, options.docsRoot), {
    trigger: scripted.trigger.definitions,
    effect: scripted.effect.definitions,
  });
  const installEvidenceRoots = ["events", ...scriptedRows.map((row) => row.dir)];

  return {
    formatVersion: 1,
    gameVersion: options.gameVersion,
    evidence: {
      install: {
        sha256: evidenceHash(options.installRoot, installEvidenceRoots, (file) =>
          file.endsWith(".txt")
        ),
      },
      cwt: {
        version: cwtVersion(options.configRoot),
        sha256: evidenceHash(options.configRoot, ["."], (file) => file.endsWith(".cwt")),
      },
      docs: {
        version: evidenceDocsVersion,
        sha256: evidenceHash(
          options.docsRoot,
          ["triggers.log", "effects.log", "scopes.log"],
          () => true
        ),
      },
    },
    eventKinds: kinds,
    events,
    scripted,
    inferredScopes,
  };
}
