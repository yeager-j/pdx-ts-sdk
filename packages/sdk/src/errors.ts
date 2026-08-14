/**
 * Named errors for everything the SDK refuses to do silently. Each refusal
 * the patch slice makes — a missing install, an unverified registry rule, a
 * filename that cannot win — is a distinct class, so callers and tests can
 * tell them apart without matching message strings.
 *
 * The receipt import is type-only on purpose: `output/receipt.ts` reaches
 * `ordering.ts`, which reaches this module for `LogicalPathError`, so a value
 * import here would close a runtime cycle.
 */

import type { MaterializationReceipt } from "./output/receipt.ts";

export class PdxSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A raw path that cannot become a logical path (see ordering.ts). */
export class LogicalPathError extends PdxSdkError {}

export interface PathOwnershipConflict {
  readonly path: string;
  readonly owners: readonly string[];
  readonly reason: "duplicate" | "portable-alias" | "file-directory" | "reserved";
}

/** Two output producers cannot own one portable logical path tree. */
export class PathOwnershipError extends PdxSdkError {
  readonly conflicts: readonly PathOwnershipConflict[];

  constructor(conflicts: readonly PathOwnershipConflict[]) {
    super(
      `Output path ownership has ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}: ` +
        conflicts.map((conflict) => conflict.path).join(", ")
    );
    this.conflicts = Object.freeze(
      conflicts.map((conflict) =>
        Object.freeze({ ...conflict, owners: Object.freeze([...conflict.owners]) })
      )
    );
  }
}

/**
 * How an owned path diverged. Drift is a statement about the manifest-owned
 * set only: an entry the manifest does not own is foreign, never drift.
 */
export type MaterializationDriftKind = "missing" | "modified" | "type-changed" | "symlink";

export interface MaterializationDrift {
  readonly path: string;
  readonly kind: MaterializationDriftKind;
}

/** A rendered path collides with a foreign entry already in the target. */
export interface ForeignClaimConflict {
  /** The logical path the `RenderedMod` claims. */
  readonly claimPath: string;
  /** The target-relative on-disk entry it collides with. */
  readonly foreignPath: string;
  readonly kind: "occupied" | "file-directory";
}

/** A foreign entry of a kind materialization cannot carry across activation. */
export interface ForeignRefusedEntry {
  /** Target-relative. */
  readonly path: string;
  readonly kind: "symlink" | "fifo" | "socket" | "device" | "unknown";
}

/**
 * Every way a materialization can refuse, as data. `"recovery-required"` is
 * declared but not yet thrown: the transaction journal that makes an
 * interrupted materialization recognizable lands with SDK-172, and the union
 * is exhaustive from the start so callers do not have to widen later.
 */
export type MaterializationFailure =
  | { readonly reason: "unowned"; readonly detail: string }
  | {
      readonly reason: "drift";
      readonly drift: readonly MaterializationDrift[];
      readonly receipt: MaterializationReceipt;
    }
  | { readonly reason: "foreign-conflict"; readonly conflicts: readonly ForeignClaimConflict[] }
  | { readonly reason: "foreign-unpreservable"; readonly entries: readonly ForeignRefusedEntry[] }
  | { readonly reason: "busy"; readonly detail: string }
  | { readonly reason: "activation"; readonly rolledBack: boolean }
  | { readonly reason: "recovery-required"; readonly detail: string };

/** Materialization refused, or failed at the commit point. */
export class MaterializationError extends PdxSdkError {
  /** The canonical absolute target path. */
  readonly target: string;
  readonly failure: MaterializationFailure;

  constructor(target: string, failure: MaterializationFailure, options?: { cause?: unknown }) {
    super(describeFailure(target, failure));
    this.target = target;
    this.failure = freezeFailure(failure);
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  get reason(): MaterializationFailure["reason"] {
    return this.failure.reason;
  }
}

function describeFailure(target: string, failure: MaterializationFailure): string {
  switch (failure.reason) {
    case "unowned":
      return failure.detail;
    case "drift":
      return (
        `Refusing to materialize ${target}: ${failure.drift.length} owned ` +
        `path${failure.drift.length === 1 ? "" : "s"} drifted from the ownership manifest.`
      );
    case "foreign-conflict":
      return (
        `Refusing to materialize ${target}: ${failure.conflicts.length} rendered ` +
        `path${failure.conflicts.length === 1 ? "" : "s"} collide with entries already there.`
      );
    case "foreign-unpreservable":
      return (
        `Refusing to materialize ${target}: ${failure.entries.length} foreign ` +
        `entr${failure.entries.length === 1 ? "y" : "ies"} cannot be preserved across activation.`
      );
    case "busy":
      return `Refusing to activate ${target}: ${failure.detail}`;
    case "activation":
      return (
        `Failed to activate ${target}: the previous output ` +
        `${failure.rolledBack ? "was restored" : "could not be restored and was left in place"}.`
      );
    case "recovery-required":
      return `Refusing to materialize ${target}: ${failure.detail}`;
  }
}

function freezeFailure(failure: MaterializationFailure): MaterializationFailure {
  switch (failure.reason) {
    case "drift":
      return Object.freeze({
        ...failure,
        drift: Object.freeze(failure.drift.map((entry) => Object.freeze({ ...entry }))),
      });
    case "foreign-conflict":
      return Object.freeze({
        ...failure,
        conflicts: Object.freeze(failure.conflicts.map((entry) => Object.freeze({ ...entry }))),
      });
    case "foreign-unpreservable":
      return Object.freeze({
        ...failure,
        entries: Object.freeze(failure.entries.map((entry) => Object.freeze({ ...entry }))),
      });
    default:
      return Object.freeze({ ...failure });
  }
}

/** No Stellaris install at any searched location. */
export class InstallNotFoundError extends PdxSdkError {}

/** The install states no usable game version, or one that cannot be mapped. */
export class GameVersionError extends PdxSdkError {}

/** The install's game build differs from the rule table's verified pin. */
export class StaleRuleTableError extends PdxSdkError {}

/** A win-assertion was requested for a registry whose rule is refused. */
export class UnverifiedRegistryError extends PdxSdkError {}

/** No emitted filename can provably win against the parsed enumeration. */
export class NoWinningFilenameError extends PdxSdkError {}

/** A patch targeted a technology_swap name; swap semantics are unverified. */
export class SwapPatchError extends PdxSdkError {}

/** The mod would emit a file at a path vanilla already occupies. */
export class VanillaPathCollisionError extends PdxSdkError {}

/**
 * The installed `@pdx-ts/stellaris-ids` package is pinned to a game
 * version that differs from the install a `VanillaView` was built from.
 */
export class VanillaPackageMismatchError extends PdxSdkError {}
