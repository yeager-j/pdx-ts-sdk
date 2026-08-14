/**
 * The claim model: what a reference page is allowed to say, and on what footing.
 *
 * Every author-facing sentence carries one status. Flattening them is the
 * failure this whole spike is testing against — a page that reads uniformly
 * confident about a guaranteed contract, a thing vanilla happens to do once,
 * and a question nobody has answered is worse than no page, because a reader
 * cannot tell which sentence will cost them an afternoon.
 *
 * Browser-safe by construction: types and pure helpers only, no Node imports.
 * The viewer and the build share this file so the statuses cannot drift apart.
 */

/** The five footings a claim can stand on. */
export type ClaimStatus =
  /** Guaranteed by the current generated authoring surface or its build-time checks. */
  | "supported-contract"
  /** Found in a named, versioned source. Occurrence, not legality, not advice. */
  | "observed-example"
  /** A maintainer judgment, held honest by explicit guidance dependencies. */
  | "curated-convention"
  /** Deliberately declined or not yet supported, with a recorded disposition. */
  | "known-omission"
  /** The available evidence does not justify a reliable answer. */
  | "unresolved-behavior";

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "supported-contract",
  "observed-example",
  "curated-convention",
  "known-omission",
  "unresolved-behavior",
];

/** How a status reads to an author, one line each. */
export const STATUS_LABEL: Readonly<Record<ClaimStatus, string>> = {
  "supported-contract": "Supported contract",
  "observed-example": "Observed example",
  "curated-convention": "Curated convention",
  "known-omission": "Known omission",
  "unresolved-behavior": "Unresolved behavior",
};

export const STATUS_MEANING: Readonly<Record<ClaimStatus, string>> = {
  "supported-contract": "The generated authoring surface or a build-time check guarantees this.",
  "observed-example":
    "Observed in a named, versioned source. Evidence that the form occurs — not that it is " +
    "generally legal, and not a recommendation.",
  "curated-convention":
    "A maintainer judgment about a useful pattern. It declares the contracts and evidence it " +
    "interprets, and is invalidated for review when any of them change.",
  "known-omission":
    "The SDK deliberately declines this or does not support it yet, with the disposition and " +
    "reason recorded.",
  "unresolved-behavior":
    "The rules, documentation, corpus, and oracle evidence available do not justify a reliable " +
    "answer. The gap is preserved rather than guessed.",
};

/** Where a claim's support comes from. */
export type ProvenanceKind =
  /** A `.cwt` rule declaration in the vendored config. */
  | "cwt-rule"
  /** A decision the codegen lowering made, read off the post-overlay model. */
  | "codegen-projection"
  /** Hand-written SDK source that asserts a contract the rules do not state. */
  | "sdk-source"
  /** The committed, game-versioned corpus fixture. */
  | "corpus"
  /** A committed table in this repo recording a disposition. */
  | "recorded-disposition"
  /** A named maintainer judgment, with no stronger footing available. */
  | "maintainer";

export interface Provenance {
  readonly kind: ProvenanceKind;
  /** Repo-relative file, with a line or row anchor where one exists. */
  readonly source: string;
  readonly detail?: string;
}

/**
 * A stable reference from a curated convention to the fact it interprets.
 *
 * The fingerprint is over the semantic slice named by `subject` — a lowered
 * member's shape, scope, arity and literal set; an observation's counts — and
 * never over generated formatting, member ordering, or file location. That is
 * the whole difference between a dependency that fires when the contract
 * changes and a hash that fires when Prettier does.
 *
 * A contract dependency that stops matching *fails* the documentation gate:
 * the advice was written about a surface that no longer exists. An evidence
 * dependency that stops matching *reviews*: shipped data changed, which may or
 * may not make the advice wrong, and only a person can say which.
 */
export interface GuidanceDependency {
  readonly subject: string;
  readonly kind: "contract" | "evidence";
  readonly fingerprint: string;
}

export interface ReferenceClaim {
  readonly id: string;
  /** What the claim is about: a member path, a layout, a whole capability. */
  readonly subject: string;
  readonly status: ClaimStatus;
  /** The claim itself, in one or two sentences of ordinary prose. */
  readonly statement: string;
  readonly provenance: readonly Provenance[];
  /** Present on curated conventions; empty everywhere else. */
  readonly guidance: readonly GuidanceDependency[];
  /**
   * The claim this one is evidence for, when it is not a claim in its own
   * right.
   *
   * An observation like "4 of 90 shipped types use the conditional form" is
   * not something a reader can act on. It is support for the claim that the
   * form is unauthorable, and it belongs underneath that claim rather than
   * beside it competing for attention. Set here, the page renders it inside
   * the parent's evidence rather than as its own callout.
   */
  readonly supports?: string;
}

/**
 * Whether a claim gets a callout, or reads as ordinary prose.
 *
 * Only three statuses are marked, and the test is whether the claim costs the
 * reader something: it will not work, nobody knows, or this is a person's
 * opinion. A Supported contract costs nothing — it is the page working
 * normally — and marking it would put a warning label on every true sentence,
 * which teaches a reader to stop seeing the labels that matter.
 */
export function isMarked(status: ClaimStatus): boolean {
  return (
    status === "curated-convention" ||
    status === "known-omission" ||
    status === "unresolved-behavior"
  );
}
