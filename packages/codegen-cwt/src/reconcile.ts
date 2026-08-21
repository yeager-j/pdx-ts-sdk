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
import { joinModifierScopes } from "./emit/modifiers.ts";
import type { ModifierDocs } from "./logs/modifier-docs.ts";
import type { ScopeLink } from "./logs/scopes.ts";
import type { DocDump } from "./logs/trigger-docs.ts";
import { UNIVERSAL_SCOPES } from "./overlay.ts";
import { SPECIAL_SCOPE_PATHS } from "./special-scope-paths.ts";

export interface NameDrift {
  /** Declared in the `.cwt` rules but absent from the game's doc dump. */
  readonly rulesOnly: readonly string[];
  /** Documented by the game but absent from the `.cwt` rules. */
  readonly docsOnly: readonly string[];
}

export type ScopeSet = readonly string[] | "any";

export interface ScopeConflict {
  readonly name: string;
  readonly rules: ScopeSet;
  readonly docs: ScopeSet;
}

export interface ScopeResolution {
  readonly id: string;
  readonly selectedAuthority: "rules" | "docs" | "mixed" | "none";
  readonly reason: string;
  readonly evidenceVersion: string;
  readonly expectedLifetime: string;
  readonly conflicts: {
    /** Stable conflict identities, including both normalized scope sets. */
    readonly triggers: readonly string[];
    /** Stable conflict identities, including both normalized scope sets. */
    readonly effects: readonly string[];
  };
  readonly unscopedRules: {
    readonly triggers: readonly string[];
    readonly effects: readonly string[];
  };
}

export interface DriftReport {
  readonly triggers: NameDrift;
  readonly effects: NameDrift;
  /**
   * Static scope links only. Value and `from_data` links are excluded by their
   * own declared markers (the game never dumps them), and the dump's special
   * scope references (`root`, `prev`, …) are excluded from the other side.
   */
  readonly links: NameDrift;
  /**
   * Concrete `modifiers.cwt` names the game's dump does not list. There is no
   * `docsOnly` counterpart: the dump legitimately holds tens of thousands of
   * generated names the curated file only describes as templates.
   */
  readonly modifiers: { readonly rulesOnly: readonly string[] };
  /** Categories either modifier source names that `modifier_categories.cwt` lacks. */
  readonly unknownModifierCategories: readonly string[];
  /** Dumped modifier names the category join left without a single scope. */
  readonly unscopedModifierNames: readonly string[];
  /** `## …` annotations upstream wrote in a shape the parser cannot read. */
  readonly malformedOptions: readonly string[];
  /** Bracketed CWT value keywords the classifier does not understand. */
  readonly unknownKeywords: readonly string[];
  /**
   * Dump blocks `logs/trigger-docs.ts` could not read — no name line or no
   * `Supported Scopes:` line — as `<file>:<line> <text>`. A vendored-dump
   * bump that breaks block parsing moved these silently before: `npm test`
   * pinned {@link DocDump.malformed}'s count, but `npm run codegen` never saw
   * it, so a parser regression could ship without failing the drift gate.
   */
  readonly malformedDocBlocks: readonly string[];
  /** `modifiers.log` lines `logs/modifier-docs.ts` could not read, the same way. */
  readonly malformedModifierBlocks: readonly string[];
  /**
   * Scopes named by either source that `scopes.cwt` does not define, each as
   * `<scope> — <token>, <token>, ...` with sorted tokens summarizing *where*
   * the scope is referenced, so an accepted name cannot silently cover a
   * later reference from somewhere new — the exact case a bare accepted-name
   * list missed. A token is `<file>:<count>` — the number of references to
   * this scope counted in that one file, not a line number, so a dump-line
   * shift from an unrelated edit does not move the baseline — for every
   * source that groups into files (doc dumps, rule declarations, scope
   * links); a modifier-category reference instead contributes one
   * `modifier_categories.cwt category:<name>` token per referencing category,
   * since `RuleSet.modifierCategories` keeps no node location and the
   * category name is itself the finer identity there.
   *
   * Accepted gap: a reference removed from a file and a new one added to the
   * *same* file, in the same regeneration, can leave that file's count
   * unchanged and so go unreported — `compareToBaseline` sees counts, not
   * identities, within one file. Widening this further would mean carrying
   * line numbers again, which is the exact churn counting was chosen to
   * avoid; a swap this narrow is judged unlikely enough to accept.
   */
  readonly unknownScopes: readonly string[];
  /** Rules whose `## scopes` disagree with the game's own dump. */
  readonly scopeConflicts: {
    readonly triggers: readonly ScopeConflict[];
    readonly effects: readonly ScopeConflict[];
  };
  /** Rules with no `## scopes` annotation, even when the dump supplies a fallback. */
  readonly unscopedRules: {
    readonly triggers: readonly string[];
    readonly effects: readonly string[];
  };
}

export interface DriftBaseline extends Omit<DriftReport, "scopeConflicts" | "unscopedRules"> {
  /** Audited explanations for every accepted scope disagreement or missing annotation. */
  readonly scopeResolutions: readonly ScopeResolution[];
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

function scopeSet(scopes: Set<string> | null): ScopeSet {
  return scopes === null ? "any" : [...scopes].sort();
}

function compareScopes(
  table: ReadonlyMap<
    string,
    readonly {
      readonly supportedScopes: readonly string[] | null;
      readonly file: string;
    }[]
  >,
  documented: ReadonlyMap<string, { readonly scopes: readonly string[] }>,
  index: ReadonlyMap<string, string>,
  note: (scopes: readonly string[], file: string) => void
): { conflicts: ScopeConflict[]; unscoped: string[] } {
  const conflicts: ScopeConflict[] = [];
  const unscoped: string[] = [];

  for (const [name, declarations] of table) {
    const declared = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
    if (declarations.every((declaration) => declaration.supportedScopes === null)) {
      unscoped.push(name);
      continue;
    }
    // Per declaration, not the flattened `declared`: a name with several
    // `alias[...]` declarations (an overload) would otherwise lose which one
    // actually wrote a given scope token, and `note` needs that rule's own
    // file to count against.
    for (const declaration of declarations) {
      if (declaration.supportedScopes !== null) {
        note(declaration.supportedScopes, declaration.file);
      }
    }
    const docs = documented.get(name);
    if (docs === undefined) {
      continue;
    }
    const fromRules = normaliseScopes(declared, index);
    const fromDocs = normaliseScopes(docs.scopes, index);
    if (!sameScopes(fromRules, fromDocs)) {
      conflicts.push({ name, rules: scopeSet(fromRules), docs: scopeSet(fromDocs) });
    }
  }

  return {
    conflicts: conflicts.sort((left, right) => left.name.localeCompare(right.name)),
    unscoped: unscoped.sort(),
  };
}

export function reconcile(
  rules: RuleSet,
  docs: DocDump,
  modifierDocs: ModifierDocs,
  dumpLinks: readonly ScopeLink[]
): DriftReport {
  const index = scopeIndex(rules);
  // Scope name -> file -> how many references to it were counted in that
  // file, and scope name -> the literal tokens contributed by sources with no
  // file to count against (modifier categories). Counts rather than
  // locations: the same retired scope name (`pop`) is referenced by hundreds
  // of doc-dump entries, and recording each one's line would churn the
  // baseline on every unrelated dump edit that shifts a line number. See the
  // field doc on `DriftReport.unknownScopes` for the exact shape and its one
  // accepted gap.
  const unknownFileCounts = new Map<string, Map<string, number>>();
  const unknownTokens = new Map<string, Set<string>>();

  const noteCount = (scopes: readonly string[], file: string): void => {
    for (const scope of scopes) {
      if (index.has(scope) || UNIVERSAL_SCOPES.has(scope)) {
        continue;
      }
      const perFile = unknownFileCounts.get(scope) ?? new Map<string, number>();
      perFile.set(file, (perFile.get(file) ?? 0) + 1);
      unknownFileCounts.set(scope, perFile);
    }
  };
  const noteToken = (scopes: readonly string[], token: string): void => {
    for (const scope of scopes) {
      if (index.has(scope) || UNIVERSAL_SCOPES.has(scope)) {
        continue;
      }
      const tokens = unknownTokens.get(scope) ?? new Set<string>();
      tokens.add(token);
      unknownTokens.set(scope, tokens);
    }
  };
  // Two loops rather than one over the merged values: each dump file is its
  // own counting bucket, and a merged loop would have needed to recover which
  // file an entry came from.
  for (const entry of docs.triggers.values()) {
    noteCount(entry.scopes, "triggers.log");
  }
  for (const entry of docs.effects.values()) {
    noteCount(entry.scopes, "effects.log");
  }
  // Modifier categories are the one source with no file-scoped count to give:
  // CWT node position is discarded while `readModifierCategories`
  // (cwt/rules.ts) builds `RuleSet.modifierCategories`, and widening that
  // map's type to carry it is a bigger change than this drift gate warrants.
  // `modifier_categories.cwt` is a single file and a category name is a
  // unique key inside it, so one token per referencing category re-finds the
  // reference just as reliably as a count would.
  for (const [category, tokens] of rules.modifierCategories) {
    noteToken(
      tokens.map((token) => token.toLowerCase()),
      `modifier_categories.cwt category:${category}`
    );
  }

  const staticLinks = [...rules.links.values()].filter(
    (link) => link.type === "scope" && !link.fromData
  );
  for (const link of staticLinks) {
    noteCount(
      link.inputScopes.map((scope) => scope.toLowerCase()),
      link.file
    );
    if (link.outputScope !== null) {
      noteCount([link.outputScope.toLowerCase()], link.file);
    }
  }

  const modifierJoin = joinModifierScopes(
    rules,
    modifierDocs,
    (token) => index.get(token.toLowerCase()) ?? null
  );

  const triggerScopes = compareScopes(rules.triggers, docs.triggers, index, noteCount);
  const effectScopes = compareScopes(rules.effects, docs.effects, index, noteCount);

  const unknownScopeNames = new Set([...unknownFileCounts.keys(), ...unknownTokens.keys()]);
  const unknownScopes = [...unknownScopeNames].sort().map((scope) => {
    const fileTokens = [...(unknownFileCounts.get(scope) ?? new Map<string, number>())].map(
      ([file, count]) => `${file}:${count}`
    );
    const literalTokens = [...(unknownTokens.get(scope) ?? new Set<string>())];
    const tokens = [...fileTokens, ...literalTokens].sort();
    return `${scope} — ${tokens.join(", ")}`;
  });

  return {
    triggers: driftBetween(rules.triggers.keys(), docs.triggers.keys()),
    effects: driftBetween(rules.effects.keys(), docs.effects.keys()),
    links: driftBetween(
      staticLinks.map((link) => link.name),
      dumpLinks.map((link) => link.name).filter((name) => !SPECIAL_SCOPE_PATHS.has(name))
    ),
    modifiers: {
      rulesOnly: diff(rules.modifierDecls.keys(), new Set(modifierDocs.modifiers.keys())),
    },
    unknownModifierCategories: modifierJoin.unknownCategories,
    unscopedModifierNames: modifierJoin.unscoped,
    malformedOptions: rules.diagnostics
      .filter((diagnostic) => diagnostic.kind !== "unknown-keyword")
      .map(describeDiagnostic)
      .sort(),
    unknownKeywords: rules.diagnostics
      .filter((diagnostic) => diagnostic.kind === "unknown-keyword")
      .map(describeDiagnostic)
      .sort(),
    malformedDocBlocks: [...docs.malformed].sort(),
    malformedModifierBlocks: [...modifierDocs.malformed].sort(),
    unknownScopes,
    scopeConflicts: {
      triggers: triggerScopes.conflicts,
      effects: effectScopes.conflicts,
    },
    unscopedRules: {
      triggers: triggerScopes.unscoped,
      effects: effectScopes.unscoped,
    },
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
