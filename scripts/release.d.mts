export interface ReleaseDependency {
  readonly section: "dependencies" | "peerDependencies";
  readonly name: string;
}

export interface ReleasePackage {
  readonly name: string;
  readonly directory: string;
  readonly dependencies?: readonly ReleaseDependency[];
  readonly scaffolderManifestKey?: "sdk" | "sdkTesting";
}

export interface PreparedRelease {
  readonly previousVersion: string;
  readonly version: string;
  readonly packages: readonly ReleasePackage[];
}

export interface StellarisIdsRevisionDecision {
  readonly changed: boolean;
  readonly message: string;
}

export const RELEASE_PACKAGES: readonly ReleasePackage[];

export function validateReleaseVersion(version: string): string;
export function currentReleaseVersion(root: string): string;
export function prepareReleaseCoordinates(root: string, version: string): PreparedRelease;
export function prepareRelease(root: string, version: string): PreparedRelease;
export function stellarisIdsRevisionDecision(
  version: string,
  changed: boolean
): StellarisIdsRevisionDecision;
export function checkRelease(root: string): readonly unknown[];
