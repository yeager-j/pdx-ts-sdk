/**
 * A diagnostic collected while authoring or compiling a mod.
 *
 * A union rather than one flat record because a warning a consumer is expected
 * to *act* on has to carry what it acted on: an unverified asset path is
 * reported so a build can list the paths it could not account for, and asking a
 * caller to parse them back out of the prose would make the message the data.
 * Every other code stays the flat `{ code, message }` shape it has always had —
 * they are read by people, not by programs.
 */

/** A warning that says all it has to say in its message. */
interface FlatWarning {
  readonly code:
    | "missing-prefix"
    | "loc-quote-replaced"
    | "unstable-desc-key"
    | "unstable-option-key"
    | "unstable-localization-key"
    | "assumed-patch-rule"
    | "mismatched-vanilla-ids";
  readonly message: string;
}

/**
 * A raw path string written into a GFX filepath field that matches neither a
 * file this build captured as an Asset nor the vanilla path inventory.
 *
 * Never an error: a DLC path, another mod's path, and a path the author will
 * ship by hand are all legitimate, and none of them is knowable here.
 */
interface UnverifiedAssetPathWarning {
  readonly code: "unverified-asset-path";
  readonly message: string;
  /** The normalized logical path, or the raw string when it would not normalize. */
  readonly path: string;
  /** Dotted PDXScript key path to the field holding it, e.g. `animation.animationmaskfile`. */
  readonly field: string;
  /** The definition that wrote it, as `spriteType "GFX_x_y"`. */
  readonly owner: string;
}

export type ModWarning = FlatWarning | UnverifiedAssetPathWarning;
