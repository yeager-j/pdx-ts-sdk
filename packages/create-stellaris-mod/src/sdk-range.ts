import semver from "semver";

import { SDK_COMPATIBILITY_POLICY, type ReleaseCompatibilityPolicy } from "./release-manifest.ts";

/**
 * The SDK range this release's baked recipes were verified against.
 *
 * Every scaffolder release states one, because the recipes it carries are
 * proved against a particular SDK at package-verification time and against
 * nothing else. A project's own declared dependency must be a *subset* of this
 * range rather than merely overlapping it: an overlapping range is one a later
 * `npm install` can resolve to an SDK nobody proved these recipes against.
 *
 * Its coordinates live in the named release manifest with the template's SDK
 * selection. The runtime SDK and test-only SDK-testing selections stay distinct
 * there because only the former is this compatibility check's subject.
 */
export const VERIFIED_SDK_RANGE = SDK_COMPATIBILITY_POLICY.verifiedRange;

/** The dependency every check here is about. */
export const SDK_PACKAGE = SDK_COMPATIBILITY_POLICY.packageName;

export interface SdkCompatibilityInput {
  /** What the project's package.json asks for, from either dependency block. */
  readonly declaredSpecifier: string | undefined;
  /** What is actually installed, when `node_modules` could be read. */
  readonly installedVersion: string | undefined;
}

export type SdkCompatibility =
  | { readonly supported: true; readonly detail: string }
  | {
      readonly supported: false;
      readonly reason:
        | "missing-dependency"
        | "unprovable-specifier"
        | "range-not-subset"
        | "installed-version-unsupported";
      readonly detail: string;
    };

/**
 * Whether this release's baked recipes are proved against the SDK the project
 * will actually resolve.
 *
 * Pure: the two facts it needs are read by the command, so this is a function
 * of what a project *says* rather than of what any machine happens to have.
 *
 * The subset rule is the interesting one. A declared `>=0.4.0` overlaps the
 * verified range but is not inside it, and a project asking for it can resolve
 * an SDK nobody proved these recipes against on any future install — including
 * the one the author runs five minutes after generating. Overlap is not
 * evidence, so it is refused.
 */
export function checkSdkCompatibility(
  input: SdkCompatibilityInput,
  policy: ReleaseCompatibilityPolicy = SDK_COMPATIBILITY_POLICY
): SdkCompatibility {
  const { declaredSpecifier, installedVersion } = input;
  const { packageName: sdkPackage, verifiedRange } = policy;

  if (declaredSpecifier === undefined || declaredSpecifier.trim() === "") {
    return {
      supported: false,
      reason: "missing-dependency",
      detail:
        `The project does not depend on ${sdkPackage}, so there is nothing to check the ` +
        `generated source against. Add it: the recipes in this release are verified against ` +
        `${verifiedRange}.`,
    };
  }

  if (semver.validRange(declaredSpecifier) === null) {
    return {
      supported: false,
      reason: "unprovable-specifier",
      detail:
        `The project depends on ${sdkPackage} as ${JSON.stringify(declaredSpecifier)}, which ` +
        `is not a semver range, so no version can be proved to be inside ` +
        `${verifiedRange}. A \`file:\`, \`link:\`, \`workspace:\` or git dependency can be ` +
        `anything at all.`,
    };
  }

  if (!semver.subset(declaredSpecifier, verifiedRange)) {
    return {
      supported: false,
      reason: "range-not-subset",
      detail:
        `The project depends on ${sdkPackage} ${declaredSpecifier}, which is not inside the ` +
        `${verifiedRange} this release's recipes were verified against. Overlapping is ` +
        `not enough: a later install could resolve a version nobody proved them against.`,
    };
  }

  if (installedVersion === undefined) {
    return {
      supported: true,
      detail: `${sdkPackage} ${declaredSpecifier} is inside ${verifiedRange}.`,
    };
  }

  if (semver.valid(installedVersion) === null) {
    return {
      supported: false,
      reason: "installed-version-unsupported",
      detail:
        `The installed ${sdkPackage} reports version ${JSON.stringify(installedVersion)}, ` +
        `which is not a semver version, so it cannot be checked against ` +
        `${verifiedRange}.`,
    };
  }
  for (const [range, what] of [
    [declaredSpecifier, "the project asks for"],
    [verifiedRange, "this release verified against"],
  ] as const) {
    if (!semver.satisfies(installedVersion, range)) {
      return {
        supported: false,
        reason: "installed-version-unsupported",
        detail:
          `The installed ${sdkPackage} is ${installedVersion}, outside the ${range} ` +
          `${what}. Install what the project declares before generating against it.`,
      };
    }
  }

  return {
    supported: true,
    detail:
      `${sdkPackage} ${declaredSpecifier} is inside ${verifiedRange}, and ` +
      `${installedVersion} is installed.`,
  };
}
