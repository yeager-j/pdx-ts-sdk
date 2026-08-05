/** A diagnostic collected while authoring or compiling a mod. */
export interface ModWarning {
  readonly code:
    | "missing-prefix"
    | "loc-quote-replaced"
    | "unstable-desc-key"
    | "loc-key-looks-like-text"
    | "unchecked-vanilla-ids";
  readonly message: string;
}
