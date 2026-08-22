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

import type { CwtDiagnostic } from "../cwt/parser.ts";
import { scopeIndex, type RuleSet } from "../cwt/rules.ts";
import { joinModifierScopes } from "../emit/script/modifiers.ts";
import type { ModifierDocs } from "../logs/modifier-docs.ts";
import type { ScopeLink } from "../logs/scopes.ts";
import type { DocDump } from "../logs/trigger-docs.ts";
import { UNIVERSAL_SCOPES } from "../overlay/index.ts";
import { SPECIAL_SCOPE_PATHS } from "../special-scope-paths.ts";

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

/** Sorted set difference; exported for the baseline compare in `./baseline.ts`. */
export function diff(left: Iterable<string>, right: ReadonlySet<string>): string[] {
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
