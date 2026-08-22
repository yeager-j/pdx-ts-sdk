/**
 * The committed drift baseline: compares a {@link DriftReport} against
 * `src/drift-baseline.json`, updates it on an intentional rebaseline, and
 * gates codegen on any movement. The join that produces the report lives in
 * `./reconcile.ts`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  diff,
  type DriftBaseline,
  type DriftReport,
  type ScopeConflict,
  type ScopeSet,
} from "./reconcile.ts";

const BASELINE = fileURLToPath(new URL("../drift-baseline.json", import.meta.url));

function compareList(
  label: string,
  actual: readonly string[],
  expected: readonly string[]
): string[] {
  const added = diff(actual, new Set(expected));
  const removed = diff(expected, new Set(actual));
  return [
    ...added.map((name) => `  + ${label}: ${name}`),
    ...removed.map((name) => `  - ${label}: ${name}`),
  ];
}

function describeScopeSet(scopes: ScopeSet): string {
  return scopes === "any" ? "any" : scopes.join(" ");
}

function describeScopeConflict(conflict: ScopeConflict): string {
  return (
    `${conflict.name}: rules say [${describeScopeSet(conflict.rules)}], ` +
    `docs say [${describeScopeSet(conflict.docs)}]`
  );
}

function scopeBaseline(baseline: DriftBaseline): {
  conflicts: { triggers: string[]; effects: string[] };
  unscopedRules: { triggers: string[]; effects: string[] };
  errors: string[];
} {
  const conflicts = { triggers: [] as string[], effects: [] as string[] };
  const unscopedRules = { triggers: [] as string[], effects: [] as string[] };
  const errors: string[] = [];
  const ids = new Set<string>();
  const authorities = new Set(["rules", "docs", "mixed", "none"]);

  for (const resolution of baseline.scopeResolutions) {
    if (ids.has(resolution.id)) {
      errors.push(`  ! duplicate scope resolution id: ${resolution.id}`);
    }
    ids.add(resolution.id);
    if (!authorities.has(resolution.selectedAuthority)) {
      errors.push(
        `  ! scope resolution ${resolution.id || "<missing id>"} has invalid selectedAuthority`
      );
    }
    for (const [field, value] of [
      ["id", resolution.id],
      ["reason", resolution.reason],
      ["evidenceVersion", resolution.evidenceVersion],
      ["expectedLifetime", resolution.expectedLifetime],
    ] as const) {
      if (value.trim() === "") {
        errors.push(`  ! scope resolution ${resolution.id || "<missing id>"} has no ${field}`);
      }
    }
    conflicts.triggers.push(...resolution.conflicts.triggers);
    conflicts.effects.push(...resolution.conflicts.effects);
    unscopedRules.triggers.push(...resolution.unscopedRules.triggers);
    unscopedRules.effects.push(...resolution.unscopedRules.effects);
    if (
      resolution.conflicts.triggers.length === 0 &&
      resolution.conflicts.effects.length === 0 &&
      resolution.unscopedRules.triggers.length === 0 &&
      resolution.unscopedRules.effects.length === 0
    ) {
      errors.push(`  ! scope resolution ${resolution.id} resolves no scope evidence`);
    }
  }

  for (const [kind, entries] of [
    ["trigger scope conflict", conflicts.triggers],
    ["effect scope conflict", conflicts.effects],
    ["unscoped trigger rule", unscopedRules.triggers],
    ["unscoped effect rule", unscopedRules.effects],
  ] as const) {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry)) {
        errors.push(`  ! duplicate accepted ${kind}: ${entry}`);
      }
      seen.add(entry);
    }
  }

  return { conflicts, unscopedRules, errors };
}

function compareScopeEvidence(report: DriftReport, baseline: DriftBaseline): string[] {
  const expected = scopeBaseline(baseline);
  return [
    ...expected.errors,
    ...compareList(
      "trigger scope conflict",
      report.scopeConflicts.triggers.map(describeScopeConflict),
      expected.conflicts.triggers
    ),
    ...compareList(
      "effect scope conflict",
      report.scopeConflicts.effects.map(describeScopeConflict),
      expected.conflicts.effects
    ),
    ...compareList(
      "unscoped trigger rule",
      report.unscopedRules.triggers,
      expected.unscopedRules.triggers
    ),
    ...compareList(
      "unscoped effect rule",
      report.unscopedRules.effects,
      expected.unscopedRules.effects
    ),
  ];
}

/** Returns a human-readable line per difference; empty means the baseline holds. */
export function compareToBaseline(report: DriftReport, baseline: DriftBaseline): string[] {
  return [
    ...compareList("trigger only in rules", report.triggers.rulesOnly, baseline.triggers.rulesOnly),
    ...compareList("trigger only in docs", report.triggers.docsOnly, baseline.triggers.docsOnly),
    ...compareList("effect only in rules", report.effects.rulesOnly, baseline.effects.rulesOnly),
    ...compareList("effect only in docs", report.effects.docsOnly, baseline.effects.docsOnly),
    ...compareList("link only in rules", report.links.rulesOnly, baseline.links.rulesOnly),
    ...compareList("link only in docs", report.links.docsOnly, baseline.links.docsOnly),
    ...compareList(
      "modifier only in rules",
      report.modifiers.rulesOnly,
      baseline.modifiers.rulesOnly
    ),
    ...compareList(
      "unknown modifier category",
      report.unknownModifierCategories,
      baseline.unknownModifierCategories
    ),
    ...compareList(
      "unscoped modifier name",
      report.unscopedModifierNames,
      baseline.unscopedModifierNames
    ),
    ...compareList("malformed option", report.malformedOptions, baseline.malformedOptions),
    ...compareList("unknown CWT keyword", report.unknownKeywords, baseline.unknownKeywords),
    ...compareList(
      "malformed trigger/effect doc block",
      report.malformedDocBlocks,
      baseline.malformedDocBlocks
    ),
    ...compareList(
      "malformed modifier doc block",
      report.malformedModifierBlocks,
      baseline.malformedModifierBlocks
    ),
    ...compareList("unknown scope", report.unknownScopes, baseline.unknownScopes),
    ...compareScopeEvidence(report, baseline),
  ];
}

/**
 * Accepts non-scope drift while preserving the reviewed rationale for scope drift.
 * New scope evidence must first be assigned to an explicit resolution in the baseline.
 */
export function updatedBaseline(report: DriftReport, baseline: DriftBaseline): DriftBaseline {
  const differences = compareScopeEvidence(report, baseline);
  if (differences.length > 0) {
    throw new Error(
      "Scope drift cannot be rebaselined without an explicit resolution:\n" + differences.join("\n")
    );
  }
  const { scopeConflicts: _scopeConflicts, unscopedRules: _unscopedRules, ...rest } = report;
  return { ...rest, scopeResolutions: baseline.scopeResolutions };
}

export function checkDrift(report: DriftReport, rebaseline: boolean): void {
  // A baseline written before a join existed reads as that join being empty,
  // so adding a join reports its entire current state as drift to review
  // instead of crashing on the missing field.
  const baseline = {
    links: { rulesOnly: [], docsOnly: [] },
    malformedDocBlocks: [],
    malformedModifierBlocks: [],
    ...(JSON.parse(readFileSync(BASELINE, "utf8")) as Partial<DriftBaseline>),
  } as DriftBaseline;
  if (rebaseline) {
    writeFileSync(
      BASELINE,
      `${JSON.stringify(updatedBaseline(report, baseline), null, 2)}\n`,
      "utf8"
    );
    console.log(`Rebaselined drift: ${BASELINE}`);
    return;
  }
  const differences = compareToBaseline(report, baseline);
  if (differences.length === 0) {
    return;
  }
  console.error("\nThe two rule sources drifted since the recorded baseline:\n");
  console.error(differences.join("\n"));
  console.error(
    "\nEach line is a trigger, effect, or annotation that exists in one source and not\n" +
      "the other, which means codegen would emit a wrong signature or silently skip it.\n" +
      "Review the change, then re-run with --rebaseline to accept it."
  );
  process.exit(1);
}
