/** Compares reconciliation reports with the committed drift baseline and updates it explicitly. */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  diff,
  type DriftBaseline,
  type DriftReport,
  type ScopeConflict,
  type ScopeSet,
} from "./reconcile.ts";

const BASELINE_PATH = fileURLToPath(new URL("../drift-baseline.json", import.meta.url));
const VALID_SCOPE_AUTHORITIES = new Set(["rules", "docs", "mixed", "none"]);
const SCOPE_EVIDENCE_LABELS = {
  triggerConflicts: "trigger scope conflict",
  effectConflicts: "effect scope conflict",
  unscopedTriggers: "unscoped trigger rule",
  unscopedEffects: "unscoped effect rule",
} as const;

interface ScopeBaselineAnalysis {
  readonly conflicts: { readonly triggers: string[]; readonly effects: string[] };
  readonly unscopedRules: { readonly triggers: string[]; readonly effects: string[] };
  readonly errors: string[];
}

function describeListDifferences(
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

function analyzeScopeBaseline(baseline: DriftBaseline): ScopeBaselineAnalysis {
  const conflicts = { triggers: [] as string[], effects: [] as string[] };
  const unscopedRules = { triggers: [] as string[], effects: [] as string[] };
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const resolution of baseline.scopeResolutions) {
    const resolutionId = resolution.id || "<missing id>";
    if (ids.has(resolution.id)) {
      errors.push(`  ! duplicate scope resolution id: ${resolution.id}`);
    }
    ids.add(resolution.id);
    if (!VALID_SCOPE_AUTHORITIES.has(resolution.selectedAuthority)) {
      errors.push(`  ! scope resolution ${resolutionId} has invalid selectedAuthority`);
    }
    for (const [field, value] of [
      ["id", resolution.id],
      ["reason", resolution.reason],
      ["evidenceVersion", resolution.evidenceVersion],
      ["expectedLifetime", resolution.expectedLifetime],
    ] as const) {
      if (value.trim() === "") {
        errors.push(`  ! scope resolution ${resolutionId} has no ${field}`);
      }
    }
    conflicts.triggers.push(...resolution.conflicts.triggers);
    conflicts.effects.push(...resolution.conflicts.effects);
    unscopedRules.triggers.push(...resolution.unscopedRules.triggers);
    unscopedRules.effects.push(...resolution.unscopedRules.effects);
    const resolvesEvidence = [
      resolution.conflicts.triggers,
      resolution.conflicts.effects,
      resolution.unscopedRules.triggers,
      resolution.unscopedRules.effects,
    ].some((entries) => entries.length > 0);
    if (!resolvesEvidence) {
      errors.push(`  ! scope resolution ${resolution.id} resolves no scope evidence`);
    }
  }

  for (const [kind, entries] of [
    [SCOPE_EVIDENCE_LABELS.triggerConflicts, conflicts.triggers],
    [SCOPE_EVIDENCE_LABELS.effectConflicts, conflicts.effects],
    [SCOPE_EVIDENCE_LABELS.unscopedTriggers, unscopedRules.triggers],
    [SCOPE_EVIDENCE_LABELS.unscopedEffects, unscopedRules.effects],
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
  const expected = analyzeScopeBaseline(baseline);
  return [
    ...expected.errors,
    ...describeListDifferences(
      SCOPE_EVIDENCE_LABELS.triggerConflicts,
      report.scopeConflicts.triggers.map(describeScopeConflict),
      expected.conflicts.triggers
    ),
    ...describeListDifferences(
      SCOPE_EVIDENCE_LABELS.effectConflicts,
      report.scopeConflicts.effects.map(describeScopeConflict),
      expected.conflicts.effects
    ),
    ...describeListDifferences(
      SCOPE_EVIDENCE_LABELS.unscopedTriggers,
      report.unscopedRules.triggers,
      expected.unscopedRules.triggers
    ),
    ...describeListDifferences(
      SCOPE_EVIDENCE_LABELS.unscopedEffects,
      report.unscopedRules.effects,
      expected.unscopedRules.effects
    ),
  ];
}

/**
 * Describes every difference between a reconciliation report and its reviewed baseline.
 * An empty result means the report matches the baseline.
 */
export function compareToBaseline(report: DriftReport, baseline: DriftBaseline): string[] {
  return [
    ...describeListDifferences(
      "trigger only in rules",
      report.triggers.rulesOnly,
      baseline.triggers.rulesOnly
    ),
    ...describeListDifferences(
      "trigger only in docs",
      report.triggers.docsOnly,
      baseline.triggers.docsOnly
    ),
    ...describeListDifferences(
      "effect only in rules",
      report.effects.rulesOnly,
      baseline.effects.rulesOnly
    ),
    ...describeListDifferences(
      "effect only in docs",
      report.effects.docsOnly,
      baseline.effects.docsOnly
    ),
    ...describeListDifferences(
      "link only in rules",
      report.links.rulesOnly,
      baseline.links.rulesOnly
    ),
    ...describeListDifferences("link only in docs", report.links.docsOnly, baseline.links.docsOnly),
    ...describeListDifferences(
      "modifier only in rules",
      report.modifiers.rulesOnly,
      baseline.modifiers.rulesOnly
    ),
    ...describeListDifferences(
      "unknown modifier category",
      report.unknownModifierCategories,
      baseline.unknownModifierCategories
    ),
    ...describeListDifferences(
      "unknown modifier scope token",
      report.unknownModifierScopeTokens,
      baseline.unknownModifierScopeTokens
    ),
    ...describeListDifferences(
      "unscoped modifier name",
      report.unscopedModifierNames,
      baseline.unscopedModifierNames
    ),
    ...describeListDifferences(
      "malformed option",
      report.malformedOptions,
      baseline.malformedOptions
    ),
    ...describeListDifferences(
      "unknown CWT keyword",
      report.unknownKeywords,
      baseline.unknownKeywords
    ),
    ...describeListDifferences(
      "malformed trigger/effect doc block",
      report.malformedDocBlocks,
      baseline.malformedDocBlocks
    ),
    ...describeListDifferences(
      "malformed modifier doc block",
      report.malformedModifierBlocks,
      baseline.malformedModifierBlocks
    ),
    ...describeListDifferences(
      "malformed scope-link doc block",
      report.malformedScopeLinkBlocks,
      baseline.malformedScopeLinkBlocks
    ),
    ...describeListDifferences(
      "duplicate documentation entry",
      report.duplicateDocEntries,
      baseline.duplicateDocEntries
    ),
    ...describeListDifferences(
      "duplicate modifier entry",
      report.duplicateModifierEntries,
      baseline.duplicateModifierEntries
    ),
    ...describeListDifferences(
      "duplicate scope-link entry",
      report.duplicateScopeLinkEntries,
      baseline.duplicateScopeLinkEntries
    ),
    ...describeListDifferences("unknown scope", report.unknownScopes, baseline.unknownScopes),
    ...compareScopeEvidence(report, baseline),
  ];
}

/**
 * Accepts non-scope drift while preserving the reviewed rationale for scope drift.
 * New scope evidence must first be assigned to an explicit resolution in the baseline.
 *
 * @throws When the report's scope evidence does not match those resolutions.
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

function readBaseline(): DriftBaseline {
  // Missing join fields represent empty evidence so a newly added join surfaces all current drift.
  return {
    links: { rulesOnly: [], docsOnly: [] },
    unknownModifierScopeTokens: [],
    malformedDocBlocks: [],
    malformedModifierBlocks: [],
    malformedScopeLinkBlocks: [],
    duplicateDocEntries: [],
    duplicateModifierEntries: [],
    duplicateScopeLinkEntries: [],
    ...(JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Partial<DriftBaseline>),
  } as DriftBaseline;
}

/**
 * Enforces the committed drift baseline for code generation.
 * Rebaseline mode writes accepted non-scope drift; check mode exits the process on differences.
 */
export function checkDrift(report: DriftReport, rebaseline: boolean): void {
  const baseline = readBaseline();
  if (rebaseline) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(updatedBaseline(report, baseline), null, 2)}\n`,
      "utf8"
    );
    console.log(`Rebaselined drift: ${BASELINE_PATH}`);
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
