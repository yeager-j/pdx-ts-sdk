/**
 * The corpus drift gate: re-extracts from the local install into a temp
 * directory and compares against the committed fixture.
 *
 * Run with `npm run corpus:check`. Install-gated and maintainer-local,
 * mirroring `codegen:vanilla:check`'s posture exactly: CI has no install, so
 * this cannot run there and is never made to pass vacuously in its absence.
 * Exits nonzero on any drift — a patched game, a changed observation logic —
 * with a summary of what moved; the remedy is always the same, run
 * `npm run corpus:extract` and review the committed fixture diff.
 *
 * `extractedAt` is the one volatile field and is excluded: re-extracting an
 * unchanged install must be clean.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { locateInstall } from "@pdx-ts/sdk/installation";
import { compareUtf8 } from "@pdx-ts/sdk/internals";

import {
  extractCorpus,
  FIXTURE_PATH,
  fixtureStems,
  loadMeta,
  loadRegistryFixture,
  loadScriptUsage,
  SCRIPT_USAGE_FILE,
  writeFixtures,
  type RegistryFixture,
  type ScriptUsageFixture,
  type SerializedObservation,
} from "./fixture.ts";

/** `a b c +N`: the first `limit` items and how many more there are. */
function compactList(items: readonly string[], limit = 8): string {
  return (
    items.slice(0, limit).join(" ") + (items.length > limit ? ` +${items.length - limit}` : "")
  );
}

/** Field-level differences between one registry's committed and fresh fixtures. */
function registryDrift(committed: RegistryFixture, fresh: RegistryFixture): string[] {
  const lines: string[] = [];
  if (committed.definitions !== fresh.definitions) {
    lines.push(`definitions ${committed.definitions} -> ${fresh.definitions}`);
  }
  if (committed.files !== fresh.files) {
    lines.push(`files ${committed.files} -> ${fresh.files}`);
  }
  if (committed.fingerprint !== fresh.fingerprint) {
    lines.push("content fingerprint changed");
  }
  if (JSON.stringify(committed.scalarTuples ?? []) !== JSON.stringify(fresh.scalarTuples ?? [])) {
    lines.push("scalar co-occurrences changed");
  }
  const before = new Map(Object.entries(committed.fields));
  const after = new Map(Object.entries(fresh.fields));
  const added = [...after.keys()].filter((key) => !before.has(key));
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const compact = (keys: string[], of: Map<string, SerializedObservation>): string =>
    compactList(keys.map((key) => `${key}(${of.get(key)!.definitions})`));
  if (added.length > 0) {
    lines.push(`fields added: ${compact(added, after)}`);
  }
  if (removed.length > 0) {
    lines.push(`fields removed: ${compact(removed, before)}`);
  }
  const changed = [...before.keys()].filter(
    (key) => after.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))
  );
  if (changed.length > 0) {
    lines.push(`observations changed: ${compactList(changed)}`);
  }
  return lines;
}

/**
 * Differences between the committed and fresh script usage fixtures. A
 * missing committed file is drift with the same remedy as everything else.
 */
export function scriptUsageDrift(
  committed: ScriptUsageFixture | null,
  fresh: ScriptUsageFixture
): string[] {
  if (committed === null) {
    return [`no committed ${SCRIPT_USAGE_FILE} — run npm run corpus:extract first`];
  }
  const lines: string[] = [];
  if (committed.files !== fresh.files) {
    lines.push(`files ${committed.files} -> ${fresh.files}`);
  }
  if (JSON.stringify(committed.failedFiles) !== JSON.stringify(fresh.failedFiles)) {
    lines.push(`failed files ${committed.failedFiles.join(" ")} -> ${fresh.failedFiles.join(" ")}`);
  }
  if (committed.fingerprint !== fresh.fingerprint) {
    lines.push("content fingerprint changed");
  }
  if (
    committed.vocabulary.size !== fresh.vocabulary.size ||
    committed.vocabulary.fingerprint !== fresh.vocabulary.fingerprint
  ) {
    lines.push(`vocabulary ${committed.vocabulary.size} keys -> ${fresh.vocabulary.size} keys`);
  }
  const roots = [...new Set([...Object.keys(committed.counts), ...Object.keys(fresh.counts)])].sort(
    compareUtf8
  );
  for (const root of roots) {
    const before = new Map(Object.entries(committed.counts[root] ?? {}));
    const after = new Map(Object.entries(fresh.counts[root] ?? {}));
    const added = [...after.keys()].filter((key) => !before.has(key));
    const removed = [...before.keys()].filter((key) => !after.has(key));
    const changed = [...before.keys()].filter(
      (key) => after.has(key) && before.get(key) !== after.get(key)
    );
    if (added.length > 0) {
      lines.push(
        `${root}: keys added: ${compactList(added.map((key) => `${key}(${after.get(key)})`))}`
      );
    }
    if (removed.length > 0) {
      lines.push(
        `${root}: keys removed: ${compactList(removed.map((key) => `${key}(${before.get(key)})`))}`
      );
    }
    if (changed.length > 0) {
      lines.push(
        `${root}: counts changed: ${compactList(
          changed.map((key) => `${key}(${before.get(key)}->${after.get(key)})`)
        )}`
      );
    }
  }
  return lines;
}

const install = locateInstall();
const fresh = extractCorpus(install);

// Written out rather than compared purely in memory so a drifted extraction is
// inspectable: on drift the temp directory survives and is named, and any diff
// tool can be pointed at it against the committed fixture.
const tempDir = mkdtempSync(path.join(tmpdir(), "pdx-corpus-"));
writeFixtures(tempDir, fresh);

const drift: string[] = [];
const committedMeta = loadMeta();
if (committedMeta === null) {
  drift.push(`no committed fixture at ${FIXTURE_PATH} — run npm run corpus:extract first`);
} else {
  if (committedMeta.gameVersion !== fresh.meta.gameVersion) {
    drift.push(`game version ${committedMeta.gameVersion} -> ${fresh.meta.gameVersion}`);
  }
  const committedStems = fixtureStems();
  const freshStems = fresh.registries.map((registry) => registry.registry).sort(compareUtf8);
  for (const stem of committedStems.filter((one) => !freshStems.includes(one))) {
    drift.push(`${stem}: committed fixture but no longer manifested`);
  }
  for (const registry of fresh.registries) {
    const committed = loadRegistryFixture(registry.registry);
    if (committed === null) {
      drift.push(`${registry.registry}: manifested but no committed fixture`);
      continue;
    }
    for (const line of registryDrift(committed, registry)) {
      drift.push(`${registry.registry}: ${line}`);
    }
  }
  for (const line of scriptUsageDrift(loadScriptUsage(), fresh.scriptUsage)) {
    drift.push(`script usage: ${line}`);
  }
}

if (drift.length === 0) {
  const definitions = fresh.registries.reduce((total, one) => total + one.definitions, 0);
  console.log(
    `corpus fixture is current: Stellaris ${fresh.meta.gameVersion}, ` +
      `${fresh.registries.length} registries, ${definitions} definitions, ` +
      `script usage over ${fresh.scriptUsage.files} files`
  );
  rmSync(tempDir, { recursive: true });
} else {
  console.error(`corpus fixture drift against ${FIXTURE_PATH} (${drift.length}):`);
  for (const line of drift) {
    console.error(`  ${line}`);
  }
  console.error(
    `\nThe committed fixture no longer matches what this install's corpus observes, so the ` +
      `hermetic conformance gate is measuring against stale evidence. Run npm run corpus:extract ` +
      `and review the fixture diff. Fresh extraction kept at ${tempDir} for inspection.`
  );
  process.exitCode = 1;
}
