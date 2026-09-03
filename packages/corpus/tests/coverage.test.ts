/**
 * The syntax coverage report over the real rules, emitters, fixtures, and
 * ledgers: every row it prints reconciles with the evidence it claims to
 * summarize.
 *
 * `coverage-model.test.ts` proves the arithmetic over synthetic inputs; this
 * file proves the join. Vitest type-checks only `.test-d.ts` files, so
 * `npm run typecheck` is this file's type gate.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cwtFiles, loadContentTypesFrom } from "@pdx-ts/codegen-cwt/cwt/load";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/policy/effects";
import { CONTENT_MANIFEST } from "@pdx-ts/codegen-cwt/policy/manifest";
import { CWT_CONFIG_DIRECTORY } from "@pdx-ts/codegen-cwt/sources";
import { describe, expect, it } from "vitest";

import { buildCoverage, CoverageInputError } from "../src/coverage-inputs.ts";
import {
  TYPES_COUNTED_ELSEWHERE,
  UNEXPOSED_TYPE_DISPOSITIONS,
  type CoverageClass,
  type CoverageSite,
} from "../src/coverage/index.ts";
import {
  committedRegistryReports,
  FIXTURE_DIR,
  loadScriptUsage,
  MEASUREMENTS,
  SCRIPT_USAGE_FILE,
  UNEXPOSED_TYPES_FILE,
} from "../src/fixture.ts";
import { ACKNOWLEDGED_GAPS } from "../src/gaps.ts";
import {
  MODIFIER_NAMES,
  relativeTypePath,
  RULES,
  SCRIPT_VOCABULARY,
  UNEXPOSED_TYPES,
} from "../src/generator-sources.ts";
import { ACKNOWLEDGED_MISMATCHES } from "../src/observations.ts";

const build = buildCoverage();
const { report } = build;
const usage = loadScriptUsage();
const registryReports = committedRegistryReports();
const effectPolicy = createEffectPolicy(RULES);

/** A copy of the committed fixtures, for tests that damage one. */
function fixtureCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pdx-coverage-"));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

/** Every surface, its own row or grouped. */
const allSurfaces = [...report.surfaces, ...report.groups.flatMap((group) => group.surfaces)];

/** The remainder of one surface, by label. */
function remainderOf(label: string): readonly CoverageSite[] {
  const surface = allSurfaces.find((one) => one.summary.label === label);
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

  it("list the ledger's tracked gaps and the unsupported structural keys as gaps", () => {
    // The ledger forbids policy categories (SDK-242), so a structural key
    // nobody can write is a gap only here, derived from the effect policy.
    const listed = [
      ...remainderOf("triggers").map((site) => ({ ...site, kind: "trigger" })),
      ...remainderOf("effects").map((site) => ({ ...site, kind: "effect" })),
    ]
      .filter((site) => site.class === "gap")
      .map((site) => `${site.kind}:${site.key} ${site.issue ?? "untracked"}`);
    const tracked = build.scriptGaps.trackedGaps.map(
      (gap) => `${gap.kind}:${gap.name} ${gap.issue}`
    );
    const unsupported = [...effectPolicy.unsupportedStructuralKeys].map(
      (key) => `effect:${key} untracked`
    );
    expect(sorted(listed)).toEqual(sorted([...tracked, ...unsupported]));
  });

  it("derive the unsupported structural keys from the policy's null-method rows", () => {
    const byPolicy = [...effectPolicy.byKey.values()]
      .filter((entry) => entry.owner === "structural" && entry.method === null)
      .map(
        (entry) =>
          `${entry.key} ${entry.recordedBy === null ? "unsupported" : `via ${entry.recordedBy}`}`
      );
    expect(sorted(byPolicy)).toEqual([
      "else via if",
      "else_if via if",
      "inverted_switch unsupported",
      "switch unsupported",
    ]);
    expect(sorted([...effectPolicy.unsupportedStructuralKeys])).toEqual([
      "inverted_switch",
      "switch",
    ]);
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
    const exposed = report.surfaces.filter((surface) => !scriptLabels.has(surface.summary.label));
    const grouped = report.groups.flatMap((group) => group.surfaces);
    expect(exposed).toHaveLength(registryReports.length);
    expect(report.groups.map((group) => group.summary.label)).toEqual(["registries not exposed"]);
    expect(grouped).toHaveLength(UNEXPOSED_TYPES.length);
    expect(report.registries.sites).toBe(sitesOf(exposed) + sitesOf(grouped));
    expect(report.overall.sites).toBe(sitesOf(report.surfaces) + sitesOf(grouped));
  });
});

describe("the unexposed types", () => {
  /** Every CWT type with a path, from every `.cwt` file, not only the manifest's sources. */
  const declaredWithPath = [
    ...loadContentTypesFrom(
      CWT_CONFIG_DIRECTORY,
      cwtFiles(CWT_CONFIG_DIRECTORY)
    ).contentTypes.values(),
  ].filter((type) => type.path !== null);

  it("cover every declared type with a path, minus the manifest and the types counted elsewhere", () => {
    // Manifest `type` names, not registry names: `sprite` is exposed as `spriteType`.
    const manifested = new Set<string>(CONTENT_MANIFEST.map((entry) => entry.type));
    const expected = declaredWithPath
      .map((type) => type.name)
      .filter((name) => !manifested.has(name) && !TYPES_COUNTED_ELSEWHERE.has(name));
    const listed = report.groups.flatMap((group) => group.surfaces.map((s) => s.summary.label));
    expect(sorted(listed)).toEqual(sorted(expected));
    expect(expected.length).toBeGreaterThan(100);
  });

  it("count the types another surface counts exactly once", () => {
    // `event` is the event fields surface; each swapped type names the
    // manifested registry and the emitted field whose nested sites carry it.
    for (const [type, where] of TYPES_COUNTED_ELSEWHERE) {
      expect(declaredWithPath.map((one) => one.name)).toContain(type);
      if (where === "event fields surface") {
        expect(type).toBe("event");
        continue;
      }
      const [registry, ...field] = where.split(".");
      const measurement = MEASUREMENTS.find((one) => one.registry === registry);
      expect(measurement, where).toBeDefined();
      expect(
        measurement?.emitted.map((one) => one.field),
        where
      ).toContain(field.join("."));
    }
  });

  it("give every unexposed type at least one site, all gap, policy-owned, or declined", () => {
    const offending = report.groups
      .flatMap((group) => group.surfaces)
      .flatMap((surface) => {
        const counts = surface.summary.counts;
        const other = counts.authorable + counts.partial + counts.removed;
        return surface.summary.sites === 0 || other > 0 ? [surface.summary.label] : [];
      });
    expect(offending).toEqual([]);
  });

  it("name a declared CWT type path in every disposition row", () => {
    const paths = new Set(declaredWithPath.map(relativeTypePath));
    for (const folder of UNEXPOSED_TYPE_DISPOSITIONS.keys()) {
      expect([...paths], folder).toContain(folder);
    }
    const labelsOf = (cls: "policy-owned" | "declined"): string[] =>
      sorted(
        report.groups
          .flatMap((group) => group.surfaces)
          .filter((surface) => surface.summary.counts[cls] > 0)
          .map((surface) => surface.summary.label)
      );
    expect(labelsOf("policy-owned")).toEqual(["event_namespace", "on_action"]);
    expect(labelsOf("declined")).toEqual(["scripted_effect", "scripted_trigger"]);
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

  it("refuses a fixture directory missing a registry file", () => {
    const dir = fixtureCopy();
    const registry = MEASUREMENTS[0]!.registry;
    rmSync(path.join(dir, `${registry}.json`));
    expect(() => buildCoverage(dir)).toThrow(CoverageInputError);
    expect(() => buildCoverage(dir)).toThrow(`no committed fixture for ${registry}`);
  });

  it("refuses a usage fixture whose roots differ from the declared ones", () => {
    const dir = fixtureCopy();
    const file = path.join(dir, SCRIPT_USAGE_FILE);
    const reversed = { ...usage, roots: [...(usage?.roots ?? [])].reverse() };
    writeFileSync(file, JSON.stringify(reversed), "utf8");
    expect(() => buildCoverage(dir)).toThrow(CoverageInputError);
    expect(() => buildCoverage(dir)).toThrow("counts roots events, common, not common, events");
  });

  it("refuses an unexposed-type fixture that records a different set of types", () => {
    const dir = fixtureCopy();
    const file = path.join(dir, UNEXPOSED_TYPES_FILE);
    const fixture = JSON.parse(readFileSync(file, "utf8")) as { types: Record<string, unknown> };
    const [first] = Object.keys(fixture.types);
    delete fixture.types[first!];
    writeFileSync(file, JSON.stringify(fixture), "utf8");
    expect(() => buildCoverage(dir)).toThrow(CoverageInputError);
    expect(() => buildCoverage(dir)).toThrow(`(+${first})`);
    rmSync(file);
    expect(() => buildCoverage(dir)).toThrow(
      `no committed packages/corpus/fixtures/${UNEXPOSED_TYPES_FILE}`
    );
  });

  it("never reads an install", () => {
    // The report is hermetic: the vanilla evidence is the committed fixtures.
    for (const file of ["../src/coverage-inputs.ts", "../src/coverage-report.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(source, file).not.toContain("@pdx-ts/sdk/installation");
    }
  });
});
