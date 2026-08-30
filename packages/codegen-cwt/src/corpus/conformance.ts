import type { EmittedField } from "../lower/fields.ts";
import type { RuleScopes } from "../lower/scope-facts.ts";
import { compareStrings } from "../naming.ts";
import type { FieldObservation, RegistryCorpus } from "./observations.ts";

/**
 * Identifies an observed field that the generated interface does not expose.
 *
 * Read these rows from {@link ConformanceReport.unexpressed} in descending corpus frequency.
 */
export interface UnexpressedField {
  /** Dotted field path. */
  readonly field: string;
  /** Definitions that write the field. */
  readonly count: number;
}

/**
 * Reports whether an emitted registry exposes fields seen in its corpus.
 *
 * Obtain this from {@link conformance}; use `unexpressed` to find missing API and `invented` to
 * review emitted fields that the corpus does not confirm.
 */
export interface ConformanceReport {
  /** Registry that produced the report. */
  readonly registry: string;
  /** Observed registry definitions. */
  readonly corpus: RegistryCorpus;
  /** Emitted fields absent from the corpus. */
  readonly invented: readonly string[];
  /** Observed fields absent from the emitted interface, most frequent first. */
  readonly unexpressed: readonly UnexpressedField[];
  /** Fraction of observed field occurrences the emitted interface covers. */
  readonly coverage: number;
}

/**
 * Compares emitted field names with the field paths observed in one registry corpus.
 *
 * Pass the generated top-level and nested field names. Pass `spliced` for keys accepted through an
 * unkeyed alias splice; they count as covered but are not treated as emitted declarations.
 */
export function conformance(
  registry: string,
  corpus: RegistryCorpus,
  emitted: readonly string[],
  spliced: ReadonlySet<string> = new Set()
): ConformanceReport {
  const emittedSet = new Set(emitted);
  const expressible = (field: string): boolean => emittedSet.has(field) || spliced.has(field);
  const invented = emitted.filter((field) => !corpus.occurrences.has(field)).sort();
  const unexpressed = [...corpus.occurrences]
    .filter(([field]) => !expressible(field))
    .map(([field, observation]) => ({ field, count: observation.definitions }))
    .sort((a, b) => b.count - a.count || compareStrings(a.field, b.field));
  let total = 0;
  let covered = 0;
  for (const [field, observation] of corpus.occurrences) {
    total += observation.definitions;
    if (expressible(field)) {
      covered += observation.definitions;
    }
  }
  return {
    registry,
    corpus,
    invented,
    unexpressed,
    coverage: total === 0 ? 1 : covered / total,
  };
}

/**
 * Classifies a disagreement between a lowered field and corpus evidence.
 *
 * Use `form` and `scope` as unfillable contracts; review `arity` and `literal` against their
 * baseline because the corpus is only evidence of what vanilla writes.
 */
export type ConformanceMismatchKind = "form" | "arity" | "literal" | "scope";

/**
 * Describes one lowered-field mismatch found in the corpus.
 *
 * Use `kind` and `evidence` as stable comparison data; show `detail` only in reports because it
 * contains changing counts and samples.
 */
export interface ShapeMismatch {
  /** Dotted field path. */
  readonly field: string;
  /** Category of mismatch. */
  readonly kind: ConformanceMismatchKind;
  /** Human-readable description. This value is not a stable identity. */
  readonly detail: string;
  /** Stable evidence used to compare literal mismatches. */
  readonly evidence: readonly string[];
}

/**
 * Maps each emitted shape to the form written at its field key.
 *
 * Use this table in shape conformance before comparing observed scalar and block values. `both`
 * accepts either form.
 */
export const WRITTEN_FORM = new Map<string, "scalar" | "block" | "both">([
  ["value", "scalar"],
  ["dual", "both"],
  ["valueList", "block"],
  ["trigger", "block"],
  ["effect", "block"],
  ["economicResources", "block"],
  ["economicResourceOperation", "block"],
  ["economicResourcesNoProduce", "block"],
  ["triggeredModifierBlock", "block"],
  ["modifierBlock", "block"],
  ["weightBlock", "block"],
  ["weightBlockWithLoc", "block"],
  ["weightModifier", "block"],
  ["weightedEvents", "block"],
  ["struct", "block"],
  ["triggerStruct", "block"],
  ["aliasStruct", "block"],
  ["structMap", "block"],
  ["scalarMap", "block"],
  ["repeatedStruct", "block"],
]);

/**
 * Explains emitted shapes that have no top-level field for {@link WRITTEN_FORM} to check.
 *
 * Keep this map aligned with the emitted shape inventory; each value states why its shape is
 * exempt instead of silently missing.
 */
export const WRITTEN_FORM_EXEMPT = new Map<string, string>([
  [
    "inlineModifiers",
    "splices modifiers unkeyed at the block root (lowerTopLevelSplice in " +
      "emit/fields.ts): there is no field key of its own, so no EmittedField " +
      "carrying this shape is ever produced to look it up.",
  ],
  [
    "inlineTrigger",
    "the generated descriptor's own metadata names this shape, but the " +
      "corpus-facing nested field it produces is measured under the plain " +
      '"trigger" shape instead (the inlineTrigger arm of structShape in ' +
      "emit/fields.ts) — the interior IS checked, just under trigger's " +
      "existing row rather than one of its own.",
  ],
]);

/** Whether a field scope admits a rule scope. */
function fieldAdmits(field: readonly string[] | "any", rule: RuleScopes): boolean {
  if (rule === "universal") {
    return true;
  }
  if (field === "any") {
    return false;
  }
  return field.every((scope) => rule.includes(scope));
}

function scopeVerdict(scope: readonly string[] | "any", clause: "trigger" | "effect"): string {
  if (scope !== "any") {
    return `typed for scope ${scope.join("/")}, which rejects`;
  }
  return clause === "trigger"
    ? "unchecked (Trigger<never>): no declared scope admits"
    : "typed for EffectBlock<ScopeName>, which rejects";
}

/** Returns declared scopes that admit every known key in one definition. */
function workableScopes(
  declared: readonly string[],
  keys: ReadonlySet<string>,
  scopesOf: (key: string) => RuleScopes | null
): readonly string[] {
  const scoped = [...keys].flatMap((key) => {
    const rule = scopesOf(key);
    return rule === null ? [] : [rule];
  });
  return declared.filter((scope) => scoped.every((rule) => fieldAdmits([scope], rule)));
}

function findFormMismatches(
  emittedField: EmittedField,
  observation: FieldObservation,
  writtenFormOf: (shape: string) => "scalar" | "block" | "both" | undefined
): ShapeMismatch[] {
  const mismatches: ShapeMismatch[] = [];
  const writtenForm = writtenFormOf(emittedField.shape);
  const definitionSummary = `${observation.definitions} defs`;
  if (writtenForm === "block" && observation.scalars > 0) {
    mismatches.push({
      field: emittedField.field,
      kind: "form",
      detail:
        `lowered as ${emittedField.shape}, but ${observation.scalars}/${definitionSummary} write a scalar ` +
        `(${[...observation.values].slice(0, 4).join(" ")})`,
      evidence: [],
    });
  }
  if (writtenForm === "scalar" && observation.blocks > 0) {
    mismatches.push({
      field: emittedField.field,
      kind: "form",
      detail:
        `lowered as a scalar, but ${observation.blocks}/${definitionSummary} write a block ` +
        `(${[...observation.keys].slice(0, 4).join(" ") || "bare values"})`,
      evidence: [],
    });
  }
  const observedBlockContents: string[] = [];
  if (observation.keys.size > 0) {
    observedBlockContents.push(`named keys (${[...observation.keys].slice(0, 4).join(" ")})`);
  }
  if (observation.bareValues > 0) {
    observedBlockContents.push(`bare scalars (${[...observation.values].slice(0, 4).join(" ")})`);
  }
  if (observation.bareBlocks > 0) {
    observedBlockContents.push("bare blocks");
  }
  if (observation.blocks === 0 || writtenForm !== "block" || observedBlockContents.length === 0) {
    return mismatches;
  }
  const observedContents = observedBlockContents.join(" and ");
  if (emittedField.shape === "valueList" && observation.bareValues === 0) {
    mismatches.push({
      field: emittedField.field,
      kind: "form",
      detail: `lowered as a value list, but its ${observation.blocks} blocks hold ${observedContents}`,
      evidence: [],
    });
  } else if (emittedField.wrapped === true && observation.bareBlocks === 0) {
    mismatches.push({
      field: emittedField.field,
      kind: "form",
      detail: `lowered as a wrapped struct, but its ${observation.blocks} blocks hold ${observedContents}`,
      evidence: [],
    });
  } else if (
    emittedField.shape !== "valueList" &&
    emittedField.wrapped !== true &&
    observation.keys.size === 0
  ) {
    mismatches.push({
      field: emittedField.field,
      kind: "form",
      detail: `lowered as ${emittedField.shape}, but its ${observation.blocks} blocks hold ${observedContents}`,
      evidence: [],
    });
  }
  return mismatches;
}

function findArityMismatches(
  emittedField: EmittedField,
  observation: FieldObservation
): ShapeMismatch[] {
  if (!emittedField.repeated || observation.repeated > 0) {
    return [];
  }
  return [
    {
      field: emittedField.field,
      kind: "arity",
      detail: `lowered as a list, but no definition writes it twice (${observation.definitions} defs)`,
      evidence: [],
    },
  ];
}

function findLiteralMismatches(
  emittedField: EmittedField,
  observation: FieldObservation
): ShapeMismatch[] {
  const cannotAttributeDualLiterals = emittedField.shape === "dual" && observation.bareValues > 0;
  if (emittedField.literals === undefined || cannotAttributeDualLiterals) {
    return [];
  }
  const literalSet = new Set(emittedField.literals);
  const unlistedValues = [...observation.values].filter((value) => !literalSet.has(value));
  if (unlistedValues.length === 0) {
    return [];
  }
  return [
    {
      field: emittedField.field,
      kind: "literal",
      detail: `outside the emitted union: ${unlistedValues.slice(0, 6).join(" ")}`,
      evidence: unlistedValues,
    },
  ];
}

function findScopeMismatches(
  emittedField: EmittedField,
  observation: FieldObservation,
  scopesOf: (clause: "trigger" | "effect", key: string) => RuleScopes | null
): ShapeMismatch[] {
  if (emittedField.clause === undefined || emittedField.scope === undefined) {
    return [];
  }
  const clause = emittedField.clause;
  const fieldScope = emittedField.scope;
  const ruleScopesOf = (key: string): RuleScopes | null => scopesOf(clause, key);
  if (typeof fieldScope === "object" && "parameter" in fieldScope) {
    const declared = fieldScope.parameter;
    const unworkableKeySets = observation.keysByDefinition.filter(
      (keys) => workableScopes(declared, keys, ruleScopesOf).length === 0
    );
    if (unworkableKeySets.length === 0) {
      return [];
    }
    const unworkableKeys = unworkableKeySets[0]!;
    return [
      {
        field: emittedField.field,
        kind: "scope",
        detail:
          `no single scope of ${declared.join("/")} expresses one definition's ` +
          `own conditions here (${[...unworkableKeys].slice(0, 6).join(" ")})`,
        evidence: [],
      },
    ];
  }
  const rejectedKeys = [...observation.keys].filter((key) => {
    const scopes = ruleScopesOf(key);
    return scopes !== null && !fieldAdmits(fieldScope, scopes);
  });
  if (rejectedKeys.length === 0) {
    return [];
  }
  return [
    {
      field: emittedField.field,
      kind: "scope",
      detail:
        `${scopeVerdict(fieldScope, clause)} ` +
        rejectedKeys.slice(0, 6).join(" ") +
        (rejectedKeys.length > 6 ? ` +${rejectedKeys.length - 6}` : ""),
      evidence: [],
    },
  ];
}

/**
 * Checks whether each emitted field shape can represent values observed in the corpus.
 *
 * Pass the emitted field metadata and a resolver for known trigger or effect scopes. Unknown
 * clause keys return `null` and are skipped because they are rule coverage, not shape evidence.
 * Pass `writtenFormOf` to replace the default form lookup in focused tests.
 */
export function shapeConformance(
  corpus: RegistryCorpus,
  emitted: readonly EmittedField[],
  scopesOf: (clause: "trigger" | "effect", key: string) => RuleScopes | null,
  writtenFormOf: (shape: string) => "scalar" | "block" | "both" | undefined = (shape) =>
    WRITTEN_FORM.get(shape)
): readonly ShapeMismatch[] {
  return emitted.flatMap((emittedField) => {
    const observation = corpus.occurrences.get(emittedField.field);
    if (observation === undefined) {
      return [];
    }
    return [
      ...findFormMismatches(emittedField, observation, writtenFormOf),
      ...findArityMismatches(emittedField, observation),
      ...findLiteralMismatches(emittedField, observation),
      ...findScopeMismatches(emittedField, observation, scopesOf),
    ];
  });
}
