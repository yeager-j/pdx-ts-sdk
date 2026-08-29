/**
 * The coordinates one scaffolder release makes promises about.
 *
 * The SDK dependency a new project receives and the SDK range the recipes were
 * verified against move together, but they are not the same decision as the
 * test-only interpreter dependency. Keeping each coordinate named and its
 * rationale beside it makes that distinction reviewable without duplicating
 * version strings across templates and compatibility checks.
 */
export const SCAFFOLDER_RELEASE_MANIFEST = {
  sdk: {
    packageName: "@pdx-ts/sdk",
    range: "0.6.0",
    rationale: "Runtime authoring dependency selected for every new project.",
  },
  sdkTesting: {
    packageName: "@pdx-ts/sdk-testing",
    range: "0.6.0",
    rationale: "Test-only interpreter dependency; it never ships with the mod.",
  },
} as const;

export interface ReleaseCompatibilityPolicy {
  readonly packageName: string;
  readonly verifiedRange: string;
}

export const SDK_COMPATIBILITY_POLICY: ReleaseCompatibilityPolicy = {
  packageName: SCAFFOLDER_RELEASE_MANIFEST.sdk.packageName,
  verifiedRange: SCAFFOLDER_RELEASE_MANIFEST.sdk.range,
};
