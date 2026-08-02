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

/** A raw path that cannot become a logical path (see resolver/path-order.ts). */
export class LogicalPathError extends PdxSdkError {}

/** No Stellaris install at any searched location. */
export class InstallNotFoundError extends PdxSdkError {}

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
 * The installed `@pdx-ts/stellaris-vanilla` package is pinned to a game
 * version that differs from the install a `VanillaView` was built from.
 */
export class VanillaPackageMismatchError extends PdxSdkError {}
