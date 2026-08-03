/**
 * The probe mainline: run the scope analysis over a real install and measure
 * what it learns.
 *
 * The question this probe exists to answer is not "does the analysis run" but
 * "does it narrow enough to be worth shipping, without ever narrowing wrongly".
 * So the output is a distribution, not a verdict — the judgment lives in
 * `docs/verdict-scripted-scope.md`, written against these numbers and a
 * hand-verified sample.
 *
 * Nothing here emits. The bodies are read, measured, and discarded; if the
 * verdict is to ship, what crosses into `@pdx-ts/stellaris-ids` is a scope name
 * per definition and nothing else.
 */

import { inferScopes, type Inferred, type Registry } from "./infer.ts";
import { readBodies, type BodyRead } from "./read-bodies.ts";
import { loadScopeTables } from "./scope-tables.ts";

const DIRECTORIES: Record<Registry, string> = {
  trigger: "common/scripted_triggers",
  effect: "common/scripted_effects",
};

export interface RegistryReport {
  readonly registry: Registry;
  readonly files: number;
  readonly parseDiagnostics: number;
  readonly total: number;
  /** Resolved to a real scope set rather than "legal everywhere". */
  readonly narrowed: number;
  readonly single: number;
  readonly atMostThree: number;
  readonly universal: number;
  /** Intersections that went empty and fell back to unconstrained. */
  readonly emptied: number;
  /** Scope-set size -> how many definitions landed on it. */
  readonly bySize: ReadonlyMap<number, number>;
  /** The keys the rules do not cover, by how often they cost a narrowing. */
  readonly unknownKeys: readonly (readonly [string, number])[];
  readonly inferred: readonly Inferred[];
}

export interface ProbeReport {
  readonly trigger: RegistryReport;
  readonly effect: RegistryReport;
}

function measure(
  registry: Registry,
  read: BodyRead,
  inferred: readonly Inferred[]
): RegistryReport {
  const bySize = new Map<number, number>();
  const unknown = new Map<string, number>();
  let narrowed = 0;
  let single = 0;
  let atMostThree = 0;
  let emptied = 0;

  for (const one of inferred) {
    const size = one.scopes === "universal" ? 0 : one.scopes.length;
    bySize.set(size, (bySize.get(size) ?? 0) + 1);
    if (one.scopes !== "universal") {
      narrowed += 1;
      if (size === 1) {
        single += 1;
      }
      if (size <= 3) {
        atMostThree += 1;
      }
    }
    for (const diagnostic of one.diagnostics) {
      if (diagnostic.kind === "unknown-key") {
        unknown.set(diagnostic.detail, (unknown.get(diagnostic.detail) ?? 0) + 1);
      }
      if (diagnostic.kind === "emptied" && diagnostic.detail === one.name) {
        emptied += 1;
      }
    }
  }

  return {
    registry,
    files: read.files,
    parseDiagnostics: read.diagnostics,
    total: inferred.length,
    narrowed,
    single,
    atMostThree,
    universal: inferred.length - narrowed,
    emptied,
    bySize,
    unknownKeys: [...unknown].sort((left, right) => right[1] - left[1]).slice(0, 25),
    inferred,
  };
}

export function runProbe(installRoot: string): ProbeReport {
  const tables = loadScopeTables();
  const read = {
    trigger: readBodies(installRoot, DIRECTORIES.trigger),
    effect: readBodies(installRoot, DIRECTORIES.effect),
  };
  const inferred = inferScopes(tables, {
    trigger: read.trigger.definitions,
    effect: read.effect.definitions,
  });
  return {
    trigger: measure("trigger", read.trigger, inferred.trigger),
    effect: measure("effect", read.effect, inferred.effect),
  };
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

export function formatReport(report: RegistryReport): string {
  const lines = [
    `${report.registry}: ${report.total} definitions from ${report.files} files ` +
      `(${report.parseDiagnostics} parse diagnostics)`,
    `  narrowed        ${report.narrowed} (${percent(report.narrowed, report.total)})`,
    `  exactly one     ${report.single} (${percent(report.single, report.total)})`,
    `  at most three   ${report.atMostThree} (${percent(report.atMostThree, report.total)})`,
    `  unconstrained   ${report.universal} (${percent(report.universal, report.total)})`,
    `  of which empty  ${report.emptied}`,
    `  by scope-set size:`,
  ];
  for (const [size, count] of [...report.bySize].sort((left, right) => left[0] - right[0])) {
    lines.push(`    ${size === 0 ? "universal" : String(size).padStart(9)}  ${count}`);
  }
  lines.push("  keys the rules do not cover, by definitions affected:");
  for (const [key, count] of report.unknownKeys) {
    lines.push(`    ${count.toString().padStart(5)}  ${key}`);
  }
  return lines.join("\n");
}
