/** An internal package range that must move with the release coordinate. */
export interface ReleaseDependency {
  /** Dependency section containing the package range. */
  readonly section: "dependencies" | "peerDependencies";
  /** Internal package name. */
  readonly name: string;
}

/** One public package participating in the shared SDK release. */
export interface ReleasePackage {
  /** npm package name. */
  readonly name: string;
  /** Repository-relative package directory. */
  readonly directory: string;
  /** Internal ranges updated when this package's version changes. */
  readonly dependencies?: readonly ReleaseDependency[];
  /** Scaffolder manifest entry that tracks this package. */
  readonly scaffolderManifestKey?: "sdk" | "sdkTesting";
}

/** The coordinates changed by release preparation. */
export interface PreparedRelease {
  /** Release coordinate before preparation. */
  readonly previousVersion: string;
  /** Requested release coordinate. */
  readonly version: string;
  /** Public packages prepared for this release. */
  readonly packages: readonly ReleasePackage[];
}

/** The identifier package revision action inferred from generated output. */
export interface StellarisIdsRevisionDecision {
  /** Whether identifier output differs from the published revision baseline. */
  readonly changed: boolean;
  /** Maintainer action for the next identifier package release. */
  readonly message: string;
}

/** The sole inventory of public packages that share the SDK release coordinate. */
export const RELEASE_PACKAGES: readonly ReleasePackage[];

/** Repository-relative files that spell the release coordinate out rather than deriving it. */
export const RELEASE_LITERAL_FILES: readonly string[];

/** Validates and returns an exact semantic release version. */
export function validateReleaseVersion(version: string): string;
/** Returns the version all release packages currently share. */
export function currentReleaseVersion(root: string): string;
/** Updates release-owned coordinates without refreshing the npm lockfile. */
export function prepareReleaseCoordinates(root: string, version: string): PreparedRelease;
/** Updates release-owned coordinates and refreshes the npm lockfile. */
export function prepareRelease(root: string, version: string): PreparedRelease;
/** Reports the identifier revision required after comparison with its release baseline. */
export function stellarisIdsRevisionDecision(
  publishedVersion: string,
  generatedVersion: string,
  changed: boolean
): StellarisIdsRevisionDecision;
/** Runs release verification and returns the status of every gate. */
export function checkRelease(
  root: string,
  execute?: (root: string, command: string, args: readonly string[]) => void,
  installPath?: string | null
): readonly unknown[];
