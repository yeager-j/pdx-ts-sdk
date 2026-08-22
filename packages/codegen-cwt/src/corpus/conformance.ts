/**
 * The corpus verdicts: {@link conformance} asks whether a field is *present*
 * in the emitted interface; {@link shapeConformance} asks whether its lowered
 * type can hold what real definitions put there. The vocabulary lives in
 * `./observations.ts`, the reading engine in `./read.ts`.
 */

import type { EmittedField } from "../lower/fields.ts";
import type { RuleScopes } from "../lower/scope-facts.ts";
import type { RegistryCorpus } from "./observations.ts";

export interface ConformanceReport {
  readonly registry: string;
  readonly corpus: RegistryCorpus;
  /** Emitted fields no definition in the corpus writes: likely a misreading. */
  readonly invented: readonly string[];
  /** Observed fields the emitted interface cannot express, most frequent first. */
  readonly unexpressed: readonly { readonly field: string; readonly count: number }[];
  /** Share of observed field occurrences the emitted interface covers, 0-1. */
  readonly coverage: number;
}

/**
 * Measures the emitted interface against the corpus.
 *
 * `spliced` names keys the interface admits without enumerating them: an alias
 * category spliced unkeyed into the definition body (`static_modifier`'s
 * modifier names) is one authoring member covering thousands of legal keys. They
 * count as covered, but never as `invented` — the emitter did not claim each
 * one individually, so "the corpus never writes it" says nothing about whether
 * the shape was read correctly.
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
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
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
 * The four ways a lowered type can disagree with the values behind it.
 *
 * `form` is hard: the corpus writes something no value of the emitted type can
 * express, so the field is unfillable however legal it is. `scope` is hard in
 * one of its two cases only — a pinned scope rejects the rule, and the field is
 * unfillable the same way, but an unpinned trigger clause is widened to
 * `Trigger<never>` (see `contravariantScopeType`), which accepts the rule with
 * nothing checked. What the corpus proves there is that the emitted type
 * carries no claim, not that an author is stuck; both are reported, and the
 * detail says which. `arity` and `literal` are softer — a list where the game
 * happens never to repeat is legal, and a value outside a closed union may be
 * an upstream spelling quirk. Softer is not unreviewed: the gate holds the two
 * of them against a committed baseline of classified rows, so a *new or
 * changed* observation fails until somebody says which kind of legal it is.
 */
export type ConformanceMismatchKind = "form" | "arity" | "literal" | "scope";

export interface ShapeMismatch {
  readonly field: string;
  readonly kind: ConformanceMismatchKind;
  /**
   * The finding in prose, for a human reading a failure. Deliberately volatile:
   * it carries definition counts that move with every game patch and samples
   * that truncate, so nothing may treat it as an identity.
   */
  readonly detail: string;
  /**
   * The values that produced the verdict — every stray for `literal`, and empty
   * for the kinds whose verdict is its own evidence. This is the half a
   * baseline compares, as a set: a seventh stray the prose does not show still
   * has to be reviewed, and a definition count that moved is not a new
   * observation.
   *
   * Untruncated, unlike {@link detail} — but drawn from a value set the reader
   * caps at `VALUE_SAMPLE`, so "every stray" holds only while the field
   * stays under that cap. The corpus gate asserts it does.
   */
  readonly evidence: readonly string[];
}

/**
 * What the writer puts on the right of each runtime shape's key. `both` is a
 * field lowered to a union of a scalar and a block, dispatched at write time by
 * what the author passed.
 *
 * A shape missing here gets no form verdict rather than a guessed one — which
 * is only sound for a shape whose own top-level `EmittedField` never reaches
 * this lookup in the first place. Every other `CONTENT_SHAPES` member
 * must have a row: the table is string-keyed, so a typo'd or forgotten shape
 * silently exempts a field rather than failing loudly. `written-form.test.ts`
 * pins `CONTENT_SHAPES` against this map's keys plus {@link WRITTEN_FORM_EXEMPT}
 * in both directions, so a fifth gap cannot join either list unreviewed.
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
 * `CONTENT_SHAPES` members with no {@link WRITTEN_FORM} row, each with
 * the reason its own top-level occurrence never reaches the lookup — not
 * merely "nobody got to it yet".
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

/**
 * Whether a rule legal in `rule` can be written into a field typed for `field`.
 *
 * `Trigger<S>` is contravariant in its scope, so the field admits exactly the
 * rules legal in *every* scope it names, and `"any"` — nothing pinned it —
 * names every scope there is, so only a universal rule satisfies it. That is a
 * question about the declared scopes rather than about the emitted type: what a
 * failure costs depends on how the field lowered, which is
 * {@link scopeVerdict}'s job to say.
 */
function fieldAdmits(field: readonly string[] | "any", rule: RuleScopes): boolean {
  if (rule === "universal") {
    return true;
  }
  if (field === "any") {
    return false;
  }
  return field.every((scope) => rule.includes(scope));
}

/**
 * How a rejected key reads against the type the field really lowered to.
 *
 * A pinned scope rejects the rule, so the field is unfillable. An unpinned one
 * need not: a trigger clause nothing pinned is widened to `Trigger<never>` (see
 * `contravariantScopeType`), which accepts every condition and checks none, so
 * the defect there is a lost check rather than a value no author can write. An
 * unpinned effect keeps `EffectBlock<ScopeName>` — no such widening — and does
 * reject, which is why the two clauses do not read alike.
 */
function scopeVerdict(scope: readonly string[] | "any", clause: "trigger" | "effect"): string {
  if (scope !== "any") {
    return `typed for scope ${scope.join("/")}, which rejects`;
  }
  return clause === "trigger"
    ? "unchecked (Trigger<never>): no declared scope admits"
    : "typed for EffectBlock<ScopeName>, which rejects";
}

/**
 * The declared scopes under which one definition's writes are all expressible.
 *
 * A parameterised field's scope is chosen once per *definition*, so this is the
 * question the gate has to ask per definition rather than per key: asking
 * whether each key is legal under *some* declared scope would pass a definition
 * that writes a planet-only rule beside a ship-only one, which no single choice
 * of S can express. Keys nothing knows are skipped, as everywhere else.
 */
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

/**
 * Measures each lowered type against the values the corpus writes under it.
 *
 * The other half of {@link conformance}, which only asks whether a field is
 * present. Fields the corpus never writes are silent here: the corpus is a
 * lower bound, so absence proves nothing about shape either.
 *
 * `scopesOf` resolves one trigger or effect key to the scopes it is legal in,
 * or `null` when nothing knows it — a vanilla scripted trigger, a scope link, a
 * rule the emitter skipped. Unknown keys are skipped rather than counted
 * against the field, since they are a coverage gap in the rules rather than
 * evidence about this field's scope.
 */
export function shapeConformance(
  corpus: RegistryCorpus,
  emitted: readonly EmittedField[],
  scopesOf: (clause: "trigger" | "effect", key: string) => RuleScopes | null
): readonly ShapeMismatch[] {
  const mismatches: ShapeMismatch[] = [];
  for (const field of emitted) {
    const observation = corpus.occurrences.get(field.field);
    if (observation === undefined) {
      continue;
    }
    const report = (
      kind: ConformanceMismatchKind,
      detail: string,
      evidence: readonly string[] = []
    ): void => {
      mismatches.push({ field: field.field, kind, detail, evidence });
    };
    const form = WRITTEN_FORM.get(field.shape);
    const seen = `${observation.definitions} defs`;
    if (form === "block" && observation.scalars > 0) {
      report(
        "form",
        `lowered as ${field.shape}, but ${observation.scalars}/${seen} write a scalar ` +
          `(${[...observation.values].slice(0, 4).join(" ")})`
      );
    }
    if (form === "scalar" && observation.blocks > 0) {
      report(
        "form",
        `lowered as a scalar, but ${observation.blocks}/${seen} write a block ` +
          `(${[...observation.keys].slice(0, 4).join(" ") || "bare values"})`
      );
    }
    // A block whose interior form is wrong is the same defect one level in: a
    // list type against `{ trigger = { … } }`, or a struct against `{ a b c }`.
    // A dual is exempt: admitting two interiors is the whole point of it, and
    // the arms were each checked against the rules that produced them.
    //
    // Three interiors, one per lowering, and each is what the other two being
    // wrong looks like: a value list holds bare scalars, a wrapped struct holds
    // bare sub-blocks, every other block shape holds named keys. The three are
    // asked separately — one "is it bare" flag passed a wrapped struct against
    // a corpus of bare scalars — and none is asked when every block is empty,
    // since `resources = { }` written 16 times is compatible with all three and
    // is absence of interior evidence rather than evidence of a defect.
    const interior = [
      ...(observation.keys.size > 0
        ? [`named keys (${[...observation.keys].slice(0, 4).join(" ")})`]
        : []),
      ...(observation.bareValues > 0
        ? [`bare scalars (${[...observation.values].slice(0, 4).join(" ")})`]
        : []),
      ...(observation.bareBlocks > 0 ? ["bare blocks"] : []),
    ];
    if (observation.blocks > 0 && form === "block" && interior.length > 0) {
      const found = interior.join(" and ");
      if (field.shape === "valueList") {
        if (observation.bareValues === 0) {
          report(
            "form",
            `lowered as a value list, but its ${observation.blocks} blocks hold ${found}`
          );
        }
      } else if (field.wrapped === true) {
        if (observation.bareBlocks === 0) {
          report(
            "form",
            `lowered as a wrapped struct, but its ${observation.blocks} blocks hold ${found}`
          );
        }
      } else if (observation.keys.size === 0) {
        report(
          "form",
          `lowered as ${field.shape}, but its ${observation.blocks} blocks hold ${found}`
        );
      }
    }
    if (field.repeated && observation.repeated === 0) {
      // No evidence beyond the verdict: the definition count is context a reader
      // wants and a baseline must not key on, since it moves with every patch
      // while the finding — this list is never repeated — does not.
      report("arity", `lowered as a list, but no definition writes it twice (${seen})`);
    }
    // A dual carries its *scalar* arm's literals (see `lowerDual`), while
    // `values` merges every scalar the field wrote — the scalar arm's, and the
    // bare values inside the block arm's blocks. Nothing in the observation says
    // which position a value came from, so a closed scalar union cannot judge
    // them: `ship_size.graphical_culture` is `bool` beside
    // `{ <graphical_culture> }`, and reading its 25 culture ids as strays
    // outside `yes`/`no` measured one arm against the other. Same exemption, and
    // the same reason, as the interior form check's.
    const unattributable = field.shape === "dual" && observation.bareValues > 0;
    if (field.literals !== undefined && !unattributable) {
      const closed = new Set(field.literals);
      const stray = [...observation.values].filter((value) => !closed.has(value));
      if (stray.length > 0) {
        // The prose truncates and the evidence does not: a seventh stray is a
        // value nobody has classified, and hiding it behind the sample would let
        // it ride along under a row written for the first six.
        report("literal", `outside the emitted union: ${stray.slice(0, 6).join(" ")}`, stray);
      }
    }
    if (field.clause !== undefined && field.scope !== undefined) {
      const clause = field.clause;
      const rules = (key: string): RuleScopes | null => scopesOf(clause, key);
      if (typeof field.scope === "object" && "parameter" in field.scope) {
        // Per definition, not per key: the author picks one scope for the whole
        // definition, so a definition whose writes have no scope in common is
        // unfillable even though each rule alone is fine under some choice.
        const declared = field.scope.parameter;
        const stranded = observation.keysByDefinition.filter(
          (keys) => workableScopes(declared, keys, rules).length === 0
        );
        if (stranded.length > 0) {
          const worst = stranded[0]!;
          report(
            "scope",
            `no single scope of ${declared.join("/")} expresses one definition's ` +
              `own conditions here (${[...worst].slice(0, 6).join(" ")})`
          );
        }
      } else {
        const scope = field.scope;
        const rejected = [...observation.keys].filter((key) => {
          const scopes = rules(key);
          return scopes !== null && !fieldAdmits(scope, scopes);
        });
        if (rejected.length > 0) {
          report(
            "scope",
            `${scopeVerdict(scope, clause)} ` +
              rejected.slice(0, 6).join(" ") +
              (rejected.length > 6 ? ` +${rejected.length - 6}` : "")
          );
        }
      }
    }
  }
  return mismatches;
}
