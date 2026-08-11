/**
 * Named errors for everything the SDK refuses to do silently. Each refusal
 * the patch slice makes — a missing install, an unverified registry rule, a
 * filename that cannot win — is a distinct class, so callers and tests can
 * tell them apart without matching message strings.
 */

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

export interface MaterializationDrift {
  readonly path: string;
  readonly kind: "added" | "missing" | "modified" | "type-changed" | "symlink";
}

/** A previously materialized tree no longer matches its ownership manifest. */
export class MaterializationDriftError extends PdxSdkError {
  readonly drift: readonly MaterializationDrift[];

  constructor(target: string, drift: readonly MaterializationDrift[]) {
    super(
      `Refusing to replace ${target}: its materialized output has ${drift.length} drifted ` +
        `path${drift.length === 1 ? "" : "s"}. Remove or restore the changes before rebuilding.`
    );
    this.drift = Object.freeze(drift.map((entry) => Object.freeze({ ...entry })));
  }
}

/** A nonempty target has no valid SDK ownership manifest. */
export class UnownedMaterializationError extends PdxSdkError {}

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
