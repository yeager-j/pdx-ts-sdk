/**
 * Joins the two sources and refuses to generate when they disagree in a new way.
 *
 * The `.cwt` rules are hand-maintained; the doc dumps come out of the game. They
 * drift, in both directions: the rules track scope renames the dump has not
 * caught up with (`carrier`, and `pop` becoming `pop_group`), while the dump
 * catches triggers the rules have not added yet. Either way, a name or a scope
 * present in only one source means codegen is about to emit a wrong signature or
 * silently omit a trigger, so both joins are compared against a checked-in
 * baseline and any movement fails the build.
 */

import type { CwtDiagnostic } from "./cwt/parser.ts";
import { scopeIndex, type RuleSet } from "./cwt/rules.ts";
import type { DocDump } from "./logs/trigger-docs.ts";
import { UNIVERSAL_SCOPES } from "./overlay.ts";

export interface NameDrift {
  /** Declared in the `.cwt` rules but absent from the game's doc dump. */
  readonly rulesOnly: readonly string[];
  /** Documented by the game but absent from the `.cwt` rules. */
  readonly docsOnly: readonly string[];
}

export interface DriftReport {
  readonly triggers: NameDrift;
  readonly effects: NameDrift;
  /** `## …` annotations upstream wrote in a shape the parser cannot read. */
  readonly malformedOptions: readonly string[];
  /** Scopes named by either source that `scopes.cwt` does not define. */
  readonly unknownScopes: readonly string[];
  /** Triggers whose `## scopes` disagree with the game's own dump. */
  readonly scopeConflicts: readonly string[];
  /** Triggers the rules declare with no `## scopes` annotation at all. */
  readonly unscopedTriggers: readonly string[];
}

function diff(left: Iterable<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((name) => !right.has(name)).sort();
}

function driftBetween(rules: Iterable<string>, docs: Iterable<string>): NameDrift {
  const ruleNames = new Set(rules);
  const docNames = new Set(docs);
  return { rulesOnly: diff(ruleNames, docNames), docsOnly: diff(docNames, ruleNames) };
}

function describeDiagnostic(diagnostic: CwtDiagnostic): string {
  return `${diagnostic.file}:${diagnostic.line} ${diagnostic.text}`;
}

/** Normalises a scope list to canonical names, or to `null` for "every scope". */
export function normaliseScopes(
  scopes: readonly string[],
  index: ReadonlyMap<string, string>
): Set<string> | null {
  if (scopes.some((scope) => UNIVERSAL_SCOPES.has(scope))) {
    return null;
  }
  return new Set(scopes.map((scope) => index.get(scope) ?? scope));
}

function sameScopes(left: Set<string> | null, right: Set<string> | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.size === right.size && [...left].every((scope) => right.has(scope));
}

function describeScopes(scopes: Set<string> | null): string {
  return scopes === null ? "any" : [...scopes].sort().join(" ");
}

export function reconcile(rules: RuleSet, docs: DocDump): DriftReport {
  const index = scopeIndex(rules);
  const unknown = new Set<string>();
  const conflicts: string[] = [];
  const unscoped: string[] = [];

  const note = (scopes: readonly string[]): void => {
    for (const scope of scopes) {
      if (!index.has(scope) && !UNIVERSAL_SCOPES.has(scope)) {
        unknown.add(scope);
      }
    }
  };
  for (const entry of [...docs.triggers.values(), ...docs.effects.values()]) {
    note(entry.scopes);
  }

  for (const [name, declarations] of rules.triggers) {
    const declared = declarations.flatMap((d) => d.supportedScopes ?? []);
    if (declarations.every((d) => d.supportedScopes === null)) {
      unscoped.push(name);
      continue;
    }
    note(declared);
    const documented = docs.triggers.get(name);
    if (documented === undefined) {
      continue;
    }
    const fromRules = normaliseScopes(declared, index);
    const fromDocs = normaliseScopes(documented.scopes, index);
    if (!sameScopes(fromRules, fromDocs)) {
      conflicts.push(
        `${name}: rules say [${describeScopes(fromRules)}], docs say [${describeScopes(fromDocs)}]`
      );
    }
  }

  return {
    triggers: driftBetween(rules.triggers.keys(), docs.triggers.keys()),
    effects: driftBetween(rules.effects.keys(), docs.effects.keys()),
    malformedOptions: rules.diagnostics.map(describeDiagnostic).sort(),
    unknownScopes: [...unknown].sort(),
    scopeConflicts: conflicts.sort(),
    unscopedTriggers: unscoped.sort(),
  };
}

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

/** Returns a human-readable line per difference; empty means the baseline holds. */
export function compareToBaseline(report: DriftReport, baseline: DriftReport): string[] {
  return [
    ...compareList("trigger only in rules", report.triggers.rulesOnly, baseline.triggers.rulesOnly),
    ...compareList("trigger only in docs", report.triggers.docsOnly, baseline.triggers.docsOnly),
    ...compareList("effect only in rules", report.effects.rulesOnly, baseline.effects.rulesOnly),
    ...compareList("effect only in docs", report.effects.docsOnly, baseline.effects.docsOnly),
    ...compareList("malformed option", report.malformedOptions, baseline.malformedOptions),
    ...compareList("unknown scope", report.unknownScopes, baseline.unknownScopes),
    ...compareList("scope conflict", report.scopeConflicts, baseline.scopeConflicts),
    ...compareList("unscoped trigger", report.unscopedTriggers, baseline.unscopedTriggers),
  ];
}
