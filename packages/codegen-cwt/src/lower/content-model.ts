/** Render-free field evidence shared by emission and corpus conformance. */

/** One supported authoring field in the form measured by the corpus gate. */
export interface EmittedField {
  /** The game's key, or a dotted path for a nested field. */
  readonly field: string;
  /** Author-facing member path preserved through nested lowering. */
  readonly authoredPath?: readonly string[];
  /** Runtime field shape selected by lowering. */
  readonly shape: string;
  /** Whether the key may repeat among siblings. */
  readonly repeated: boolean;
  /** Whether anonymous repetition occurs inside one key. */
  readonly wrapped?: boolean;
  /** Every admitted scalar when the rules close the set. */
  readonly literals?: readonly string[];
  /** Canonical closure scopes, an unpinned scope, or an enclosing parameter. */
  readonly scope?:
    | readonly string[]
    | "any"
    | {
        /** Scopes admitted by the enclosing definition parameter. */
        readonly parameter: readonly string[];
      };
  /** Script clause held by a block field. */
  readonly clause?: "trigger" | "effect";
}

/** Scope evidence needed by corpus-interior lowering. */
export interface FieldScopeFacts {
  /** Canonical scopes, or `"any"` when the field is unpinned. */
  readonly scopes: readonly string[] | "any";
}
