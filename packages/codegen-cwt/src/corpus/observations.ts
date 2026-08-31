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
 * The mode union of {@link DescentNode} is derived from this runtime inventory.
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

type DescentMode = (typeof DESCENT_MODES)[number];

/** The field and nesting every descent arm carries, whatever its mode. */
interface DescentNodeBase {
  /** The game's key at this level; the corpus path grows `<prefix>.<field>`. */
  readonly field: string;
  /** Nested block-valued fields. */
  readonly children: readonly DescentNode[];
}

/**
 * The per-mode properties, all optional-`never` so an arm can refuse the ones
 * it does not use.
 *
 * A discriminated union alone does not close this: TypeScript's excess-property
 * check accepts any property declared on *some* member of the union, so without
 * these guards `{ mode: "struct", strippedKeys }` would compile and then be
 * ignored at read time — the same silent mismatch the union exists to prevent.
 * Each arm re-admits only its own through `Omit`.
 */
interface DescentOptions {
  /** Keying strategy for a repeated struct. */
  readonly keying?: never;
  /** Identifier field omitted from a sibling-keyed repeated struct. */
  readonly identityKey?: never;
  /** Keys omitted before observing a weight modifier's trigger. */
  readonly strippedKeys?: never;
  /** Direct keys that remain regular trigger-struct members. */
  readonly ordinaryKeys?: never;
}

/** A descent whose mode reaches nested blocks with no further configuration. */
type PlainDescentNode = DescentNodeBase &
  DescentOptions & {
    /** Strategy used to reach nested blocks. */
    readonly mode: Exclude<DescentMode, "repeatedStruct" | "weightModifiers" | "triggerStruct">;
  };

/**
 * Where a repeated struct's record key lives, and the identity field that
 * sibling keying needs.
 *
 * The two travel together from `planRepeatedStruct` through emission into the
 * corpus descent, so they are one type rather than two fields each hop has to
 * re-check. `planRepeatedStruct` declines a sibling-keyed struct with no
 * identity field, so pairing them here states a guarantee the producer already
 * establishes instead of asserting it again downstream.
 */
export type RepeatedStructKeying =
  | {
      /** Each entry's own value holds the struct. */
      readonly keying: "container";
      /** Container keying takes its record key from the entry, never from a field. */
      readonly identityKey?: never;
    }
  | {
      /** Sibling keys in the enclosing block hold the struct. */
      readonly keying: "siblings";
      /** Identifier field omitted from the observed members. */
      readonly identityKey: string;
    };

/** A repeated struct, reached according to where its record key lives. */
type RepeatedStructNode = DescentNodeBase &
  Omit<DescentOptions, "keying" | "identityKey"> &
  RepeatedStructKeying & {
    /** Strategy used to reach nested blocks. */
    readonly mode: Extract<DescentMode, "repeatedStruct">;
  };

/** A weight block whose modifier rows are read once their operation keys are stripped. */
type WeightModifiersNode = DescentNodeBase &
  Omit<DescentOptions, "strippedKeys"> & {
    /** Strategy used to reach nested blocks. */
    readonly mode: Extract<DescentMode, "weightModifiers">;
    /** Keys omitted before observing a weight modifier's trigger. */
    readonly strippedKeys: ReadonlySet<string>;
  };

/** A trigger struct whose ordinary members are named apart from its spliced condition. */
type TriggerStructNode = DescentNodeBase &
  Omit<DescentOptions, "ordinaryKeys"> & {
    /** Strategy used to reach nested blocks. */
    readonly mode: Extract<DescentMode, "triggerStruct">;
    /** Direct keys that remain regular trigger-struct members. */
    readonly ordinaryKeys: readonly string[];
  };

/**
 * Describes how the corpus reader reaches fields inside one block-valued field.
 *
 * The emitter derives these nodes from the same lowering that emits nested fields; provide them
 * through {@link RegistryRead.descents} rather than hand-writing unrelated paths.
 */
export type DescentNode =
  PlainDescentNode | RepeatedStructNode | WeightModifiersNode | TriggerStructNode;

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
