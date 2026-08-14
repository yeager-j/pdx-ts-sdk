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

/**
 * Which output channel minted a path. Exhaustive from the start so callers do
 * not have to widen later: `"asset"` has no producer until Asset capture lands,
 * and `"vanilla"` names the game as the other side of a vanilla collision
 * rather than a channel this mod owns.
 */
export type PathProducerKind =
  | "descriptor"
  | "content"
  | "events"
  | "on-actions"
  | "ship-of-size-limits"
  | "localization"
  | "patch-plan"
  | "asset"
  | "reserved"
  | "vanilla";

/** Why one tree node cannot carry every claim made on it. */
export type PathConflictReason =
  "duplicate" | "portable-alias" | "file-directory" | "reserved" | "vanilla";

/** One producer's side of a conflict. */
export interface PathClaimant {
  /** The exact spelling this producer claimed, mod-root-relative. */
  readonly path: string;
  readonly kind: PathProducerKind;
  /** Every Feature stem that placed content into this file, sorted. Empty when
   *  no Feature owns the producer, or its feature was unnamed. */
  readonly stems: readonly string[];
  /** Human detail — ids, language, registry. For reading, never for parsing. */
  readonly detail: string;
  /** Whether this producer's path *is* the node, or passes through it. */
  readonly role: "file" | "directory";
}

/**
 * One reason that holds at one node of the output tree, naming every producer
 * implicated in it. Keyed by node rather than by pair: five claims colliding on
 * one path are one conflict with five claimants, not ten pairwise repetitions
 * of the same fact.
 */
export interface PathOwnershipConflict {
  /** The byte-least spelling claimed at the node. */
  readonly path: string;
  readonly reason: PathConflictReason;
  readonly claimants: readonly PathClaimant[];
}

/**
 * Two output producers cannot own one portable logical path tree.
 *
 * `conflicts` is the complete set with respect to paths — every node, every
 * reason holding at it — rather than whichever collision was noticed first.
 * It is ordered by path in UTF-8 byte order, then by reason in the fixed order
 * `reserved`, `vanilla`, `duplicate`, `portable-alias`, `file-directory`, so a
 * reader meets "you may not have this path at all" before "you have it twice".
 * The order is a function of the claims alone, never of the order Features
 * were registered in.
 *
 * Complete with respect to paths is the honest scope: the fold refuses
 * duplicate ids, split namespaces, and duplicate localization keys before it
 * ever adjudicates, so a build with both kinds of problem reports the other
 * kind first.
 */
export class PathOwnershipError extends PdxSdkError {
  readonly conflicts: readonly PathOwnershipConflict[];

  constructor(conflicts: readonly PathOwnershipConflict[]) {
    super(
      `Output path ownership has ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}: ` +
        conflicts.map((conflict) => `${conflict.path} (${conflict.reason})`).join(", ")
    );
    this.conflicts = Object.freeze(
      conflicts.map((conflict) =>
        Object.freeze({
          ...conflict,
          claimants: Object.freeze(
            conflict.claimants.map((claimant) =>
              Object.freeze({ ...claimant, stems: Object.freeze([...claimant.stems]) })
            )
          ),
        })
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

/**
 * The vanilla path inventory is present but cannot be trusted: a DLC archive
 * that does not parse, an install directory that claimed to exist and would
 * not be read, or a packaged inventory that was regenerated inconsistently.
 *
 * Separate from {@link VanillaPathCollisionError}, which is the ordinary
 * answer that a mod's path is already vanilla's. This one says the inventory
 * itself is unusable, so neither answer can be given.
 */
export class VanillaPathInventoryError extends PdxSdkError {}
