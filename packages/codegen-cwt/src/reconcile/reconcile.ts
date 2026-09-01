/** Reconciles CWT rules with independent game documentation into a deterministic drift report. */

import { scopeGroupName, type RuleType, type ScopeContext } from "../cwt/model.ts";
import type { CwtDiagnostic } from "../cwt/parser.ts";
import {
  scopeGroupIndex,
  scopeIndex,
  type AliasDecl,
  type LinkDecl,
  type RuleSet,
} from "../cwt/rules.ts";
import { joinModifierScopes } from "../emit/script/modifiers.ts";
import type { ModifierDocs } from "../logs/modifier-docs.ts";
import type { ScopeLinks } from "../logs/scopes.ts";
import type { DocDump } from "../logs/trigger-docs.ts";
import { compareStrings } from "../naming.ts";
import { UNIVERSAL_SCOPES } from "../overlay/index.ts";
import { AMBIENT_SCOPE_KEYS, SPECIAL_SCOPE_PATHS } from "../special-scope-paths.ts";

/** Names present in only one side of a rules-and-documentation comparison. */
export interface NameDrift {
  /** Declared in the `.cwt` rules but absent from the game's doc dump. */
  readonly rulesOnly: readonly string[];
  /** Documented by the game but absent from the `.cwt` rules. */
  readonly docsOnly: readonly string[];
}

/** Canonical scope names, or `"any"` when a declaration admits every scope. */
export type ScopeSet = readonly string[] | "any";

/** A named rule whose CWT and game documentation declare different scopes. */
export interface ScopeConflict {
  /** The trigger or effect name. */
  readonly name: string;
  /** Scopes declared by the CWT rules. */
  readonly rules: ScopeSet;
  /** Scopes declared by the game documentation. */
  readonly docs: ScopeSet;
}

/** Reviewed evidence that accepts a defined set of scope discrepancies. */
export interface ScopeResolution {
  /** Stable identifier for this reviewed resolution. */
  readonly id: string;
  /** Evidence source recorded as authoritative for this resolution. */
  readonly selectedAuthority: "rules" | "docs" | "mixed" | "none";
  /** Reason the listed discrepancies are accepted. */
  readonly reason: string;
  /** Versions of the evidence reviewed for this resolution. */
  readonly evidenceVersion: string;
  /** Condition under which the resolution should be reviewed again. */
  readonly expectedLifetime: string;
  /** Scope conflicts accepted by this resolution. */
  readonly conflicts: {
    /** Stable conflict identities, including both normalized scope sets. */
    readonly triggers: readonly string[];
    /** Stable conflict identities, including both normalized scope sets. */
    readonly effects: readonly string[];
  };
  /** Rules without scope annotations accepted by this resolution. */
  readonly unscopedRules: {
    /** Accepted trigger rules without scope annotations. */
    readonly triggers: readonly string[];
    /** Accepted effect rules without scope annotations. */
    readonly effects: readonly string[];
  };
  /**
   * For a `mixed` authority only: the reviewed scope set per rule name, since
   * neither source states it. Required for every rule the resolution decides.
   */
  readonly resolvedScopes?: {
    /** Reviewed scope sets for trigger rules. */
    readonly triggers?: Readonly<Record<string, readonly string[]>>;
    /** Reviewed scope sets for effect rules. */
    readonly effects?: Readonly<Record<string, readonly string[]>>;
  };
}

/** All deterministic differences between the CWT rules and game documentation. */
export interface DriftReport {
  /** Trigger names present in only one source. */
  readonly triggers: NameDrift;
  /** Effect names present in only one source. */
  readonly effects: NameDrift;
  /**
   * Static scope-link names present in only one source. Value links, data-driven links,
   * and contextual scope paths are outside this comparison.
   */
  readonly links: NameDrift;
  /**
   * Concrete modifier names declared only by CWT. Generated names in the game documentation are
   * excluded because CWT represents them as templates.
   */
  readonly modifiers: {
    /** Concrete modifier names declared only by the CWT rules. */
    readonly rulesOnly: readonly string[];
  };
  /** Modifier categories referenced by either source but absent from `modifier_categories.cwt`. */
  readonly unknownModifierCategories: readonly string[];
  /** Unknown scope tokens referenced by modifier categories, with their category. */
  readonly unknownModifierScopeTokens: readonly string[];
  /** Dumped modifier names the category join left without a single scope. */
  readonly unscopedModifierNames: readonly string[];
  /** Parser and classifier diagnostics other than unknown CWT value keywords. */
  readonly malformedOptions: readonly string[];
  /** Bracketed CWT value keywords the classifier does not understand. */
  readonly unknownKeywords: readonly string[];
  /** Trigger or effect documentation blocks without a name or supported-scope line. */
  readonly malformedDocBlocks: readonly string[];
  /** Modifier documentation lines that do not match the supported entry shape. */
  readonly malformedModifierBlocks: readonly string[];
  /** Scope-link documentation blocks that look like entries but could not be parsed. */
  readonly malformedScopeLinkBlocks: readonly string[];
  /** Duplicate trigger or effect documentation names, identified by later location. */
  readonly duplicateDocEntries: readonly string[];
  /** Duplicate modifier documentation names, identified by later location. */
  readonly duplicateModifierEntries: readonly string[];
  /** Duplicate scope-link documentation names, identified by later location. */
  readonly duplicateScopeLinkEntries: readonly string[];
  /**
   * Undefined scope names and stable summaries of their references. Scopes named by rule
   * annotations, body fields, alias declarations, links, and the documentation dumps use
   * `<file>:<count>` tokens; modifier categories use `modifier_categories.cwt category:<name>`;
   * a content subtype's `push_scope` uses `<typeName> subtype:<subtypeName>`, because the
   * parsed type declaration retains no source file.
   * Replacing one reference with another in the same file can leave its count unchanged.
   */
  readonly unknownScopes: readonly string[];
  /**
   * Scope annotations that place a scope group in a scope slot (`from = scope_group[x]`).
   * The generator cannot narrow one slot to several scopes, so it leaves an ambient slot
   * inaccessible; a group in the `this` slot is listed here too but fails lowering, since
   * leaving it unpinned would widen the block instead. Each entry is the group and its
   * `<file>:<count>` references.
   */
  readonly scopeGroupAmbientSlots: readonly string[];
  /** Rules whose `## scopes` disagree with the game's own dump. */
  readonly scopeConflicts: {
    /** Trigger rules whose normalized scope sets disagree. */
    readonly triggers: readonly ScopeConflict[];
    /** Effect rules whose normalized scope sets disagree. */
    readonly effects: readonly ScopeConflict[];
  };
  /** Rules with no `## scopes` annotation, even when the dump supplies a fallback. */
  readonly unscopedRules: {
    /** Trigger rules without a scope annotation. */
    readonly triggers: readonly string[];
    /** Effect rules without a scope annotation. */
    readonly effects: readonly string[];
  };
}

/** A reviewed drift report with scope discrepancies grouped by their accepted resolution. */
export interface DriftBaseline extends Omit<DriftReport, "scopeConflicts" | "unscopedRules"> {
  /** Audited explanations for every accepted scope disagreement or missing annotation. */
  readonly scopeResolutions: readonly ScopeResolution[];
}

/** Returns the sorted values present in `left` and absent from `right`. */
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

function classifyDiagnostics(diagnostics: readonly CwtDiagnostic[]): {
  malformedOptions: string[];
  unknownKeywords: string[];
} {
  const malformedOptions: string[] = [];
  const unknownKeywords: string[] = [];
  for (const diagnostic of diagnostics) {
    const destination = diagnostic.kind === "unknown-keyword" ? unknownKeywords : malformedOptions;
    destination.push(describeDiagnostic(diagnostic));
  }
  malformedOptions.sort();
  unknownKeywords.sort();
  return { malformedOptions, unknownKeywords };
}

/** Normalizes aliases in a scope list to canonical names. Returns `null` for every scope. */
export function normaliseScopes(
  scopes: readonly string[],
  canonicalScopes: ReadonlyMap<string, string>
): Set<string> | null {
  if (scopes.some((scope) => UNIVERSAL_SCOPES.has(scope))) {
    return null;
  }
  return new Set(scopes.map((scope) => canonicalScopes.get(scope) ?? scope));
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
  ruleDeclarations: ReadonlyMap<string, readonly AliasDecl[]>,
  documentedScopes: ReadonlyMap<string, { readonly scopes: readonly string[] }>,
  canonicalScopes: ReadonlyMap<string, string>
): { conflicts: ScopeConflict[]; unscoped: string[] } {
  const conflicts: ScopeConflict[] = [];
  const unscoped: string[] = [];

  for (const [name, declarations] of ruleDeclarations) {
    if (declarations.every((declaration) => declaration.supportedScopes === null)) {
      unscoped.push(name);
      continue;
    }
    const docs = documentedScopes.get(name);
    if (docs === undefined) {
      continue;
    }
    const declared = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
    const fromRules = normaliseScopes(declared, canonicalScopes);
    const fromDocs = normaliseScopes(docs.scopes, canonicalScopes);
    if (!sameScopes(fromRules, fromDocs)) {
      conflicts.push({ name, rules: scopeSet(fromRules), docs: scopeSet(fromDocs) });
    }
  }

  return {
    conflicts: conflicts.sort((left, right) => compareStrings(left.name, right.name)),
    unscoped: unscoped.sort(),
  };
}

/** A CWT field or bare value: the two nested nodes that carry a scope annotation. */
interface ScopedMember {
  /** The node's own `push_scope` or `replace_scopes` annotation, when present. */
  readonly scope: ScopeContext | null;
  /** The node's accepted value type, which may nest further members. */
  readonly type: RuleType;
}

/**
 * The fields and bare values nested directly inside one rule type.
 *
 * The switch is exhaustive so a future nesting `RuleType` variant fails to
 * compile here rather than silently hiding the scopes below it.
 */
function nestedMembers(type: RuleType): readonly ScopedMember[] {
  switch (type.kind) {
    case "block":
      return [...type.fields, ...type.bare];
    case "bool":
    case "int":
    case "float":
    case "scalar":
    case "localisation":
    case "valueField":
    case "enum":
    case "typeRef":
    case "valueSet":
    case "scope":
    case "scopeGroup":
    case "filepath":
    case "icon":
    case "colour":
    case "aliasMatchLeft":
    case "singleAliasRight":
    case "unknownKeyword":
    case "literal":
      return [];
  }
}

/** Every scope one annotation names, across `this` and the ambient slots. */
function annotatedScopes(scope: ScopeContext | null): readonly string[] {
  if (scope === null) {
    return [];
  }
  return [scope.this, ...AMBIENT_SCOPE_KEYS.map((key) => scope[key])]
    .filter((name) => name !== null)
    .map((name) => name.toLowerCase());
}

/** Where one class of scope name was referenced, kept as stable identities. */
interface ScopeReferences {
  /** Reference counts per source file. */
  readonly fileCounts: Map<string, Map<string, number>>;
  /** Named references for sources that retain no file location. */
  readonly namedTokens: Map<string, Set<string>>;
}

function emptyScopeReferences(): ScopeReferences {
  return { fileCounts: new Map(), namedTokens: new Map() };
}

function describeScopeReferences(references: ScopeReferences): string[] {
  const names = new Set([...references.fileCounts.keys(), ...references.namedTokens.keys()]);
  return [...names].sort().map((scope) => {
    const fileTokens = [...(references.fileCounts.get(scope) ?? [])].map(
      ([file, count]) => `${file}:${count}`
    );
    const tokens = [...fileTokens, ...(references.namedTokens.get(scope) ?? [])].sort();
    return `${scope} — ${tokens.join(", ")}`;
  });
}

/** The scope references the drift report keeps, split by why each one is notable. */
interface ScopeReferenceReport {
  /** Undefined scope names and stable summaries of their references. */
  readonly unknownScopes: readonly string[];
  /** Declared scope groups placed in an ambient slot, and their references. */
  readonly scopeGroupAmbientSlots: readonly string[];
}

function collectScopeReferences(
  rules: RuleSet,
  docs: DocDump,
  staticLinks: readonly LinkDecl[],
  canonicalScopes: ReadonlyMap<string, string>
): ScopeReferenceReport {
  const unknown = emptyScopeReferences();
  const groupSlots = emptyScopeReferences();
  // Matched the way `Emitter.scopeGroup` matches, so the report and lowering
  // never disagree about whether a group reference resolves.
  const scopeGroups = scopeGroupIndex(rules);

  /** Which list a referenced scope belongs in, or `null` when it is ordinary. */
  const listFor = (scope: string): ScopeReferences | null => {
    const group = scopeGroupName(scope);
    if (group !== null) {
      return scopeGroups.has(group.toLowerCase()) ? groupSlots : unknown;
    }
    return canonicalScopes.has(scope) || UNIVERSAL_SCOPES.has(scope) ? null : unknown;
  };

  const recordFileReferences = (scopes: readonly string[], file: string): void => {
    for (const scope of scopes) {
      const list = listFor(scope);
      if (list === null) {
        continue;
      }
      const countsForScope = list.fileCounts.get(scope) ?? new Map<string, number>();
      countsForScope.set(file, (countsForScope.get(file) ?? 0) + 1);
      list.fileCounts.set(scope, countsForScope);
    }
  };

  const recordCategoryReference = (scopes: readonly string[], token: string): void => {
    for (const scope of scopes) {
      const list = listFor(scope);
      if (list === null) {
        continue;
      }
      const tokensForScope = list.namedTokens.get(scope) ?? new Set<string>();
      tokensForScope.add(token);
      list.namedTokens.set(scope, tokensForScope);
    }
  };

  for (const entry of docs.triggers.values()) {
    recordFileReferences(entry.scopes, "triggers.log");
  }
  for (const entry of docs.effects.values()) {
    recordFileReferences(entry.scopes, "effects.log");
  }
  for (const ruleTable of [rules.triggers, rules.effects]) {
    for (const declarations of ruleTable.values()) {
      for (const declaration of declarations) {
        if (declaration.supportedScopes !== null) {
          recordFileReferences(declaration.supportedScopes, declaration.file);
        }
      }
    }
  }

  const recordNestedScopes = (type: RuleType, file: string): void => {
    for (const member of nestedMembers(type)) {
      recordFileReferences(annotatedScopes(member.scope), file);
      recordNestedScopes(member.type, file);
    }
  };

  for (const body of rules.bodies.values()) {
    recordFileReferences(annotatedScopes(body.scope), body.file);
    for (const field of body.fields) {
      recordFileReferences(annotatedScopes(field.scope), body.file);
      recordNestedScopes(field.type, body.file);
    }
  }

  for (const aliasTable of [rules.triggers, rules.effects, ...rules.aliasCategories.values()]) {
    for (const declarations of aliasTable.values()) {
      for (const declaration of declarations) {
        recordFileReferences(annotatedScopes(declaration.scope), declaration.file);
        recordNestedScopes(declaration.type, declaration.file);
      }
    }
  }

  // Parsed type declarations do not retain source locations, so the type and
  // subtype names provide stable identities.
  for (const contentType of rules.contentTypes.values()) {
    for (const subtype of contentType.subtypes) {
      if (subtype.pushScope !== null) {
        recordCategoryReference(
          [subtype.pushScope.toLowerCase()],
          `${contentType.name} subtype:${subtype.name}`
        );
      }
    }
  }

  // Modifier categories do not retain source locations, so their names provide stable identities.
  for (const [category, scopes] of rules.modifierCategories) {
    recordCategoryReference(
      scopes.map((scope) => scope.toLowerCase()),
      `modifier_categories.cwt category:${category}`
    );
  }

  for (const link of staticLinks) {
    recordFileReferences(
      link.inputScopes.map((scope) => scope.toLowerCase()),
      link.file
    );
    if (link.outputScope !== null) {
      recordFileReferences([link.outputScope.toLowerCase()], link.file);
    }
  }

  return {
    unknownScopes: describeScopeReferences(unknown),
    scopeGroupAmbientSlots: describeScopeReferences(groupSlots),
  };
}

/**
 * Compares classified CWT rules with the game documentation used as independent evidence.
 * The returned report is sorted where order has no semantic meaning and is safe to baseline.
 */
export function reconcile(
  rules: RuleSet,
  docs: DocDump,
  modifierDocs: ModifierDocs,
  dumpLinks: ScopeLinks
): DriftReport {
  const canonicalScopes = scopeIndex(rules);
  const staticLinks = [...rules.links.values()].filter(
    (link) => link.type === "scope" && !link.fromData
  );
  const modifierJoin = joinModifierScopes(
    rules,
    modifierDocs,
    (token) => canonicalScopes.get(token.toLowerCase()) ?? null
  );
  const diagnostics = classifyDiagnostics(rules.diagnostics);
  const triggerScopes = compareScopes(rules.triggers, docs.triggers, canonicalScopes);
  const effectScopes = compareScopes(rules.effects, docs.effects, canonicalScopes);

  return {
    triggers: driftBetween(rules.triggers.keys(), docs.triggers.keys()),
    effects: driftBetween(rules.effects.keys(), docs.effects.keys()),
    links: driftBetween(
      staticLinks.map((link) => link.name),
      dumpLinks.links.map((link) => link.name).filter((name) => !SPECIAL_SCOPE_PATHS.has(name))
    ),
    modifiers: {
      rulesOnly: diff(rules.modifierDecls.keys(), new Set(modifierDocs.modifiers.keys())),
    },
    unknownModifierCategories: modifierJoin.unknownCategories,
    unknownModifierScopeTokens: modifierJoin.unknownScopeTokens,
    unscopedModifierNames: modifierJoin.unscoped,
    malformedOptions: diagnostics.malformedOptions,
    unknownKeywords: diagnostics.unknownKeywords,
    malformedDocBlocks: [...docs.malformed].sort(),
    malformedModifierBlocks: [...modifierDocs.malformed].sort(),
    malformedScopeLinkBlocks: [...dumpLinks.malformed].sort(),
    duplicateDocEntries: [...docs.duplicates].sort(),
    duplicateModifierEntries: [...modifierDocs.duplicates].sort(),
    duplicateScopeLinkEntries: [...dumpLinks.duplicates].sort(),
    ...collectScopeReferences(rules, docs, staticLinks, canonicalScopes),
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
