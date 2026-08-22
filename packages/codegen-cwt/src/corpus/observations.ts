/**
 * The corpus vocabulary: what one registry's fixture observes and the node
 * types that steer the reader. The reading engine lives in `./read.ts`, the
 * verdicts in `./conformance.ts`.
 */

import type { RuleScopes } from "../lower/scope-facts.ts";

/**
 * What the corpus writes under one key, counted once per definition.
 *
 * Presence alone — the single number this used to be — is what let a
 * block-typed `stages.end` sit at full coverage against 254 scalar writes.
 * Every other member here exists so a lowered type can be measured rather than
 * merely located: block versus scalar, repeated versus single, which scalars,
 * which inner keys.
 */
export interface FieldObservation {
  /** Definitions writing the key at least once. */
  readonly definitions: number;
  /** Definitions writing it more than once at the sibling level. */
  readonly repeated: number;
  /** Definitions writing a scalar value at least once. */
  readonly scalars: number;
  /** Definitions writing a block value at least once. */
  readonly blocks: number;
  /**
   * Definitions whose block value holds a bare scalar rather than entries —
   * `field = { foo bar }`, where a `valueList`'s scalars live.
   */
  readonly bareValues: number;
  /**
   * Definitions whose block value holds a bare, anonymous sub-block —
   * `field = { { key = … } { key = … } }`, what a wrapped struct writes.
   *
   * Counted apart from {@link bareValues} because the two are different
   * evidence about opposite lowerings, and one flag for both hid a real defect:
   * a field misread as a wrapped struct against a corpus of bare *scalars*
   * satisfied the wrapped check and reported nothing.
   */
  readonly bareBlocks: number;
  /**
   * Definitions whose block value holds nothing at all — no entries and no bare
   * items. Reported rather than checked: an empty block is compatible with
   * every block lowering, which is why the interior form check stays silent
   * where it is all the corpus has (see `shapeConformance`).
   *
   * At a `weightModifiers` path it counts after the strip, so it is the number
   * of definitions writing an *ungated* modifier row — a row the SDK could not
   * author at all while `Modifier.when` was required.
   */
  readonly emptyBlocks: number;
  /** Every scalar written, as the game spells it, capped at {@link VALUE_SAMPLE}. */
  readonly values: ReadonlySet<string>;
  /** Every key written directly inside a block value. */
  readonly keys: ReadonlySet<string>;
  /**
   * The same keys, still grouped by the definition that wrote them and
   * deduplicated across definitions writing the same set.
   *
   * {@link keys} merges every definition together, which cannot answer "could
   * one scope have been declared for *this* definition" — a field where one
   * definition writes a planet-only rule and another a ship-only rule looks
   * identical to one definition writing both. Only the second is a defect, and
   * only this can tell them apart.
   */
  readonly keysByDefinition: readonly ReadonlySet<string>[];
}

/**
 * How many distinct scalars to remember per field. Enough to catch a value
 * outside a closed union, few enough that an open `<technology>` field does not
 * carry a thousand ids around.
 *
 * Exported because the cap is a hole in the `literal` verdict as well as a
 * memory bound: a field that reaches it before a later out-of-union spelling
 * never records that spelling, so the stray would go unreported and the
 * baseline would stay green over a value nobody reviewed. Below the cap the
 * sample is the whole set and the verdict is complete, so the corpus gate
 * asserts every field with a closed union stays under it — the one way this
 * stays a bound rather than a silent filter.
 */
export const VALUE_SAMPLE = 64;

export interface RegistryCorpus {
  /** Definitions found, across every file at the registry's path. */
  readonly definitions: number;
  readonly files: number;
  /**
   * Field key -> what definitions write there. A field written inside a block
   * the reader descends into (see {@link DescentNode}) is reported under a
   * dotted path (`stages.icon`, `term_data.discrete_terms.key`) alongside the
   * owning field's own top-level occurrence, so coverage inside the block is
   * visible and attributable instead of collapsing into the single top-level
   * key.
   */
  readonly occurrences: ReadonlyMap<string, FieldObservation>;
}

/**
 * Every value {@link DescentNode.mode} may hold, as a runtime const the type
 * derives from rather than a second, hand-kept list. `descend`'s switch turns
 * every arm here into a compile failure if it is missing one (see its
 * `never`-typed default), and `packages/sdk/tests/codegen/corpus-conformance.test.ts`
 * checks its own `TOTAL_RECORDING_MODES` is a subset of this list instead of
 * an independently maintained set that a new mode could silently outrun.
 */
export const DESCENT_MODES = [
  "struct",
  "wrappedStruct",
  "structMap",
  "repeatedStruct",
  "weightModifiers",
  "triggeredModifierPotential",
  "economicResourceOperationTrigger",
  "triggerStruct",
] as const;

/**
 * One block-valued field the reader descends into, and the nodes for whatever
 * it in turn contains.
 *
 * Emitter-produced, never hand-written: `ContentEmission.corpusDescents` builds
 * these out of the same lowerings that produce `nestedEmittedFields`, so the
 * paths the reader records and the paths the emitter claims cannot drift apart.
 * A descent the emitter did not lower would manufacture "unexpressed" entries
 * for interiors no side ever promised.
 *
 * `mode` says how the container reaches the blocks whose entries are recorded,
 * which is the only thing the arms differ in:
 *
 * - `struct` — the container *is* the block:
 *   `forbidden_peace_offers = { demand_surrender = ... }`.
 * - `wrappedStruct` — its items are bare anonymous blocks:
 *   `resource_terms = { { key = ... value = ... } { ... } }`.
 * - `structMap` — its items are engine-keyed blocks:
 *   `section_slots = { mid = { locator = ... } }`. The engine key stays out of
 *   the path, since the emitter has one field table for every key.
 * - `repeatedStruct` — `keying` decides, taken from the emission rather than
 *   re-derived: "container" holds one id-keyed block per entry, "siblings"
 *   holds the entry's own fields directly and carries the id in `identityKey`,
 *   skipped for the same reason the top level drops `nameField`.
 * - `weightModifiers` — a weight block's `modifier` rows, recorded under
 *   `<field>.modifier` with `strippedKeys` (the maths operations and `desc`)
 *   removed, so what remains is the row's gating trigger. The one mode that
 *   does not record the container's own entries: `base` and the weight
 *   operations are the weight block's own top-level shape, already observed
 *   under the owning key, and recording them here would manufacture interior
 *   paths no emitted field claims.
 * - `triggeredModifierPotential` — a triggered-modifier block's `potential`
 *   condition, recorded under `<field>.potential`. Modifier keys are not
 *   conditions and remain intentionally opaque.
 * - `economicResourceOperationTrigger` — an economic operation's direct
 *   `trigger` condition, recorded under `<field>.trigger`. Resource and
 *   complex-maths keys are operation data, not trigger clauses.
 * - `triggerStruct` — named sibling entries stay at their own paths, while
 *   every other direct entry is observed as the synthetic flattened `when`
 *   trigger.
 */
export interface DescentNode {
  /** The game's key at this level; the corpus path grows `<prefix>.<field>`. */
  readonly field: string;
  readonly mode: (typeof DESCENT_MODES)[number];
  /** `repeatedStruct` only. */
  readonly keying?: "container" | "siblings";
  /** `repeatedStruct` with "siblings" keying only — the field carrying the id. */
  readonly identityKey?: string;
  /** `weightModifiers` only — the gating keys stripped before the rest is recorded. */
  readonly strippedKeys?: ReadonlySet<string>;
  /** `triggerStruct` only — direct keys authored as ordinary struct members. */
  readonly ordinaryKeys?: readonly string[];
  readonly children: readonly DescentNode[];
}

/**
 * One structural alias splice the reader descends into, e.g. `planet`.
 *
 * `members` is a thunk because these are mutually recursive: a `planet` holds
 * `planet` and `moon`, and a `moon` holds `moon`.
 *
 * `descents` are the category's own block-valued fields — `planet`'s
 * `count = { min = ... max = ... }` — from the same emission that produced the
 * category's emitted fields, for the same reason {@link DescentNode} is
 * emitter-produced everywhere else.
 */
export interface SpliceMember {
  readonly key: string;
  readonly members: () => readonly SpliceMember[];
  readonly descents: readonly DescentNode[];
}

// The single declaration lives in `lower/scope-facts.ts`; re-exported here
// because `@pdx-ts/codegen-cwt/corpus` is the subpath its consumers import
// from.
export type { RuleScopes };
