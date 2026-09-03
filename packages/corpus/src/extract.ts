/**
 * Regenerates the committed corpus fixture from an installed copy of the game.
 *
 * Run with `npm run corpus:extract`. Install-gated and maintainer-local, like
 * `codegen:vanilla`: CI never runs this — it runs the hermetic conformance
 * test against what this commits. Re-extract when the game patches (the
 * version canary in `conformance.test.ts` will say so) or when the
 * observation logic itself changes, then review the fixture diff the way a
 * `src/generated/` diff is reviewed and commit it with the change that
 * produced it.
 *
 * The report is the point, not a courtesy: a registry at zero definitions
 * means the path or keyword is wrong (this script exits nonzero on one), and
 * the unauthorable-field sections preview exactly what the hermetic presence
 * floor will fail or report.
 */

import { locateInstall } from "@pdx-ts/sdk/installation";

import {
  extractCorpus,
  FIXTURE_DIR,
  FIXTURE_PATH,
  MEASUREMENTS,
  NEAR_FLOOR,
  PRESENCE_FLOOR,
  registryReport,
  writeFixtures,
  type ExtractedCorpus,
} from "./fixture.ts";

function reportSection(title: string, lines: readonly string[]): void {
  if (lines.length === 0) {
    return;
  }
  console.log(`\n${title} (${lines.length}):`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

/** Prints the extraction report; returns the zero-definition registries. */
function printReport(extracted: ExtractedCorpus): string[] {
  const byRegistry = new Map(extracted.registries.map((registry) => [registry.registry, registry]));
  const reports = MEASUREMENTS.map((measurement) =>
    registryReport(measurement, byRegistry.get(measurement.registry)!)
  );

  const definitions = reports.reduce((total, one) => total + one.fixture.definitions, 0);
  const fields = reports.reduce((total, one) => total + Object.keys(one.fixture.fields).length, 0);
  console.log(`Stellaris ${extracted.meta.gameVersion} -> ${FIXTURE_PATH}`);
  console.log(
    `\n${reports.length} registries, ${definitions} definitions, ${fields} observed fields | ` +
      `fingerprint ${extracted.meta.fingerprint.slice(0, 12)}`
  );

  const rows = [...reports]
    .sort((a, b) => a.coverage - b.coverage)
    .map(({ fixture, registry, coverage }) => {
      const percent = Math.round(coverage * 100);
      return (
        `${registry.padEnd(32)} ${String(percent).padStart(3)}%  ` +
        `${String(fixture.definitions).padStart(5)} defs  ${String(fixture.files).padStart(4)} files  ` +
        `${String(Object.keys(fixture.fields).length).padStart(4)} fields`
      );
    });
  console.log("\nregistry                        cover   defs  files  fields");
  for (const row of rows) {
    console.log(row);
  }

  reportSection(
    `Unauthorable at or above the presence floor (>=${PRESENCE_FLOOR}; the hermetic gate fails ` +
      "these without an acknowledged-gaps row)",
    reports.flatMap(({ registry, unauthorable }) =>
      unauthorable
        .filter((entry) => entry.count >= PRESENCE_FLOOR)
        .map((entry) => `${registry}.${entry.field} (${entry.count})`)
    )
  );
  reportSection(
    `Unauthorable near the floor (${NEAR_FLOOR}-${PRESENCE_FLOOR - 1}; reported by the gate, ` +
      "not failed — what a floor ratchet would add)",
    reports.flatMap(({ registry, unauthorable }) =>
      unauthorable
        .filter((entry) => entry.count >= NEAR_FLOOR && entry.count < PRESENCE_FLOOR)
        .map((entry) => `${registry}.${entry.field} (${entry.count})`)
    )
  );

  const usage = extracted.scriptUsage;
  const observed = Object.values(usage.counts).reduce(
    (total, counts) => total + Object.keys(counts).length,
    0
  );
  console.log(
    `\nscript usage: ${usage.files} files parsed under ${usage.roots.join("/")}, ` +
      `${usage.failedFiles.length} failed, ${observed} vocabulary keys observed ` +
      `(vocabulary ${usage.vocabulary.size}) | fingerprint ${usage.fingerprint.slice(0, 12)}`
  );
  reportSection("files the parser rejected", usage.failedFiles);

  const unexposed = Object.entries(extracted.unexposedTypes.types);
  const unexposedDefinitions = unexposed.reduce((total, [, type]) => total + type.definitions, 0);
  const folders = Object.entries(extracted.unexposedTypes.folders);
  const folderDefinitions = folders.reduce((total, [, folder]) => total + folder.definitions, 0);
  console.log(
    `\nunexposed types: ${unexposed.length} CWT types without a manifest row, ` +
      `${unexposedDefinitions} definitions | ${folders.length} common/ folders without a CWT ` +
      `type, ${folderDefinitions} definitions | fingerprint ` +
      extracted.unexposedTypes.fingerprint.slice(0, 12)
  );
  reportSection(
    "unexposed types whose directory the install does not have",
    unexposed.filter(([, type]) => type.fingerprint === "missing").map(([name]) => name)
  );

  const empty = reports.filter(({ fixture }) => fixture.definitions === 0);
  reportSection(
    "ANOMALY: zero definitions — the registry path or keyword is wrong; fix the extractor " +
      "or manifest rather than committing this fixture",
    empty.map(({ registry }) => registry)
  );
  return empty.map(({ registry }) => registry);
}

const install = locateInstall();
const extracted = extractCorpus(install);
writeFixtures(FIXTURE_DIR, extracted);
const empty = printReport(extracted);
console.log(`\nwrote ${extracted.registries.length + 3} files to ${FIXTURE_PATH}`);
if (empty.length > 0) {
  process.exitCode = 1;
}
