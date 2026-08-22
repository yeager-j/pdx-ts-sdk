import type { RuleScopes } from "../lower/scope-facts.ts";

/**
 * Aggregates how one field appears across a registry corpus.
 *
 * The reader produces this value; conformance checks use its counts and samples to compare a
 * lowered field shape with real definitions.
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
  /** Definitions with anonymous sub-blocks inside the field's block. Use to check wrapped structs. */
  readonly bareBlocks: number;
  /** Definitions with an empty block after descent-specific filtering. Empty blocks provide no interior-form evidence. */
  readonly emptyBlocks: number;
  /** Scalar spellings observed for the field, capped at {@link VALUE_SAMPLE}. Use for closed-literal checks. */
  readonly values: ReadonlySet<string>;
  /** Every key written directly inside a block value. */
  readonly keys: ReadonlySet<string>;
  /** Distinct direct-key sets per definition. Use when one declared scope must admit a whole definition. */
  readonly keysByDefinition: readonly ReadonlySet<string>[];
}

/**
 * Limits distinct scalar spellings retained for one field.
 *
 * Use it when constructing or validating observations; closed literal unions must remain below
 * this cap so their evidence is complete.
 */
export const VALUE_SAMPLE = 64;

/**
 * Holds the definitions and fields observed while reading one registry.
 *
 * Obtain this from {@link readRegistryCorpus} and pass it to presence or shape conformance checks.
 */
export interface RegistryCorpus {
  /** Definitions found, across every file at the registry's path. */
  readonly definitions: number;
  /** Files scanned at the registry's path. */
  readonly files: number;
  /** Observations by dotted field path. Look up a top-level key or descended path such as `stages.icon`. */
  readonly occurrences: ReadonlyMap<string, FieldObservation>;
}

/**
 * Lists the block traversal strategies the corpus reader supports.
 *
 * Emit a {@link DescentNode} with one of these modes when a lowered field exposes nested paths.
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
 * Describes how the corpus reader reaches fields inside one block-valued field.
 *
 * The emitter derives these nodes from the same lowering that emits nested fields; provide them
 * through {@link RegistryRead.descents} rather than hand-writing unrelated paths.
 */
export interface DescentNode {
  /** The game's key at this level; the corpus path grows `<prefix>.<field>`. */
  readonly field: string;
  /** Strategy used to reach nested blocks. Choose the mode matching the field's emitted lowering. */
  readonly mode: (typeof DESCENT_MODES)[number];
  /** Keying strategy for a repeated struct. Set only when `mode` is `repeatedStruct`. */
  readonly keying?: "container" | "siblings";
  /** Identifier field omitted from a sibling-keyed repeated struct. Set only with `keying: "siblings"`. */
  readonly identityKey?: string;
  /** Keys omitted before observing a weight modifier's trigger. Set only when `mode` is `weightModifiers`. */
  readonly strippedKeys?: ReadonlySet<string>;
  /** Direct keys that remain regular trigger-struct members. Set only when `mode` is `triggerStruct`. */
  readonly ordinaryKeys?: readonly string[];
  /** Nested block-valued fields. */
  readonly children: readonly DescentNode[];
}

/**
 * Describes one structural alias member and its recursive children.
 *
 * Create these with {@link spliceMembersOf}; keep `members` lazy so recursive aliases can be read.
 */
export interface SpliceMember {
  /** Key written for this member. */
  readonly key: string;
  /** Lazily resolves nested members to support recursive structures. */
  readonly members: () => readonly SpliceMember[];
  /** Block-valued fields within this member. */
  readonly descents: readonly DescentNode[];
}

/** Scope facts shared by corpus conformance consumers. */
export type { RuleScopes };
