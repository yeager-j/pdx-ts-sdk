/**
 * The syntax coverage report over the real rules, emitters, fixtures, and
 * ledgers: every row it prints reconciles with the evidence it claims to
 * summarize.
 *
 * `coverage-model.test.ts` proves the arithmetic over synthetic inputs; this
 * file proves the join. Vitest type-checks only `.test-d.ts` files, so
 * `npm run typecheck` is this file's type gate.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildCoverage } from "../src/coverage-inputs.ts";
import type { CoverageClass, CoverageSite } from "../src/coverage/index.ts";
import { committedRegistryReports, loadScriptUsage, MEASUREMENTS } from "../src/fixture.ts";
import { ACKNOWLEDGED_GAPS } from "../src/gaps.ts";
import { MODIFIER_NAMES, RULES, SCRIPT_VOCABULARY } from "../src/generator-sources.ts";
import { ACKNOWLEDGED_MISMATCHES } from "../src/observations.ts";

const build = buildCoverage();
const { report } = build;
const usage = loadScriptUsage();
const registryReports = committedRegistryReports();

/** The remainder of one surface, by label. */
function remainderOf(label: string): readonly CoverageSite[] {
  const surface = report.surfaces.find((one) => one.summary.label === label);
  if (surface === undefined) {
    throw new Error(`no surface labelled ${label}`);
  }
  return surface.remainder;
}

/** Every remainder site of one class across the registry surfaces, as `registry.field`. */
function registryRemainder(
  cls: CoverageClass
): { registry: string; field: string; site: CoverageSite }[] {
  return registryReports.flatMap((one) =>
    remainderOf(one.registry)
      .filter((site) => site.class === cls)
      .map((site) => ({ registry: one.registry, field: site.key, site }))
  );
}

const sorted = (names: readonly string[]): string[] => [...names].sort();

describe("the script usage fixture", () => {
  it("is committed and was filtered to the current vocabulary", () => {
    expect(usage).not.toBeNull();
    expect(usage?.vocabulary).toEqual({
      size: SCRIPT_VOCABULARY.keys.size,
      fingerprint: SCRIPT_VOCABULARY.fingerprint,
    });
  });

  it("records counts only for keys the rules declare", () => {
    const foreign = Object.entries(usage?.counts ?? {}).flatMap(([root, counts]) =>
      Object.keys(counts)
        .filter((key) => !SCRIPT_VOCABULARY.keys.has(key))
        .map((key) => `${root}: ${key}`)
    );
    expect(foreign).toEqual([]);
  });
});

describe("the script surfaces", () => {
  it("count every declared rule once", () => {
    const sites = Object.fromEntries(
      report.surfaces.map((surface) => [surface.summary.label, surface.summary.sites])
    );
    expect(sites.triggers).toBe(RULES.triggers.size);
    expect(sites.effects).toBe(RULES.effects.size);
    expect(sites["scope links"]).toBe(RULES.links.size);
    expect(sites.modifiers).toBe(MODIFIER_NAMES.length);
  });

  it("list exactly the ledger's tracked gaps as trigger and effect gaps", () => {
    const listed = [
      ...remainderOf("triggers").map((site) => ({ ...site, kind: "trigger" })),
      ...remainderOf("effects").map((site) => ({ ...site, kind: "effect" })),
    ]
      .filter((site) => site.class === "gap")
      .map((site) => `${site.kind}:${site.key} ${site.issue ?? "untracked"}`);
    const tracked = build.scriptGaps.trackedGaps.map(
      (gap) => `${gap.kind}:${gap.name} ${gap.issue}`
    );
    expect(sorted(listed)).toEqual(sorted(tracked));
  });

  it("list exactly the rules' removed keys as removed sites", () => {
    const removedOf = (table: typeof RULES.triggers): string[] =>
      [...table]
        .filter(([, declarations]) =>
          declarations.every((declaration) => declaration.apiStatus === "removed")
        )
        .map(([key]) => key);
    const listed = (label: string): string[] =>
      remainderOf(label)
        .filter((site) => site.class === "removed")
        .map((site) => site.key);
    expect(sorted(listed("triggers"))).toEqual(sorted(removedOf(RULES.triggers)));
    expect(sorted(listed("effects"))).toEqual(sorted(removedOf(RULES.effects)));
  });

  it("weigh a link with a declared prefix by that prefix", () => {
    // `pop_faction_parameter` is only ever written `parameter:x`, which the
    // counter credits to `parameter:`; the site must not weigh zero for that.
    const prefix = RULES.links.get("pop_faction_parameter")?.prefix;
    expect(prefix).toBe("parameter:");
    const site = remainderOf("scope links").find((one) => one.key === "pop_faction_parameter");
    expect(site?.used).toBe(
      Object.values(usage?.counts ?? {}).reduce((sum, counts) => sum + (counts[prefix!] ?? 0), 0)
    );
    expect(site?.used).toBeGreaterThan(0);
  });

  it("weigh the modifier value link by its prefix, not by the modifier field", () => {
    const site = remainderOf("scope links").find((one) => one.key === "modifier");
    const bareModifier = Object.values(usage?.counts ?? {}).reduce(
      (sum, counts) => sum + (counts.modifier ?? 0),
      0
    );
    expect(bareModifier).toBeGreaterThan(site?.used ?? 0);
  });
});

describe("the registry surfaces", () => {
  it("list exactly the acknowledged gaps as tracked gaps", () => {
    const listed = registryRemainder("gap")
      .filter(({ site }) => site.issue !== undefined)
      .map(({ registry, field, site }) => `${registry}.${field} ${site.issue}`);
    const acknowledged = ACKNOWLEDGED_GAPS.map(
      (gap) => `${gap.registry}.${gap.field} ${gap.issue}`
    );
    expect(sorted(listed)).toEqual(sorted(acknowledged));
  });

  it("list exactly the declined paths as declined sites", () => {
    const listed = registryRemainder("declined").map(
      ({ registry, field }) => `${registry}.${field}`
    );
    const declined = MEASUREMENTS.flatMap((measurement) =>
      [...measurement.declinedPaths].map((path) => `${measurement.registry}.${path}`)
    );
    expect(sorted(listed)).toEqual(sorted(declined));
    // The observed ones are what the conformance gate reports as declined.
    const observed = registryRemainder("declined")
      .filter(({ site }) => site.used > 0)
      .map(({ registry, field }) => `${registry}.${field}`);
    const gateDeclined = registryReports.flatMap((one) =>
      one.declined.map((entry) => `${one.registry}.${entry.field}`)
    );
    expect(sorted(observed)).toEqual(sorted(gateDeclined));
  });

  it("list exactly the acknowledged form mismatches as partial sites", () => {
    const listed = registryRemainder("partial").map(
      ({ registry, field }) => `${registry}.${field}`
    );
    const forms = ACKNOWLEDGED_MISMATCHES.filter((row) => row.kind === "form").map(
      (row) => `${row.registry}.${row.field}`
    );
    expect(sorted(listed)).toEqual(sorted(forms));
  });

  it("list every unauthorable field the conformance gate sees as a gap", () => {
    const gaps = new Set(
      registryRemainder("gap").map(({ registry, field }) => `${registry}.${field}`)
    );
    const missing = registryReports.flatMap((one) =>
      one.unauthorable
        .map((entry) => `${one.registry}.${entry.field}`)
        .filter((name) => !gaps.has(name))
    );
    expect(missing).toEqual([]);
  });
});

describe("the summary rows", () => {
  it("sum every class to the site count, on every row", () => {
    const rows = [
      ...report.surfaces.map((surface) => surface.summary),
      report.registries,
      report.overall,
    ];
    for (const row of rows) {
      const total = Object.values(row.counts).reduce((sum, count) => sum + count, 0);
      expect(total, row.label).toBe(row.sites);
    }
  });

  it("aggregate the registries once and everything overall", () => {
    const scriptLabels = new Set([
      "triggers",
      "effects",
      "modifiers",
      "scope links",
      "event fields",
    ]);
    const sitesOf = (rows: typeof report.surfaces): number =>
      rows.reduce((sum, surface) => sum + surface.summary.sites, 0);
    const registries = report.surfaces.filter(
      (surface) => !scriptLabels.has(surface.summary.label)
    );
    expect(registries).toHaveLength(registryReports.length);
    expect(report.registries.sites).toBe(sitesOf(registries));
    expect(report.overall.sites).toBe(sitesOf(report.surfaces));
  });
});

describe("the report", () => {
  it("prints the same lines twice", () => {
    expect(buildCoverage().lines).toEqual(build.lines);
  });

  it("prints one row per registry with a committed fixture", () => {
    const labels = report.surfaces.map((surface) => surface.summary.label);
    for (const one of registryReports) {
      expect(labels).toContain(one.registry);
    }
  });

  it("never reads an install", () => {
    // The report is hermetic: the vanilla evidence is the committed fixtures.
    for (const file of ["../src/coverage-inputs.ts", "../src/coverage-report.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(source, file).not.toContain("@pdx-ts/sdk/installation");
    }
  });
});
