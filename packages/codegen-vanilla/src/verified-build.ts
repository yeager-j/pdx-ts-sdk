/**
 * The repository's committed projection of the Stellaris build its authored
 * contracts have been verified against. This is deliberately distinct from
 * `VanillaBuildFacts`: that value is extracted from a live install and carries
 * its own evidence hashes; this one is hermetic release metadata.
 */
export interface VerifiedBuildPolicy {
  readonly gameVersion: string;
  readonly [fact: string]: unknown;
  readonly installProtocol: {
    readonly launcherVersionPrefix: string;
    readonly coreGameVersionPattern: string;
    readonly supportedVersionFromGamePattern: string;
    readonly supportedVersionPattern: string;
    readonly [fact: string]: unknown;
  };
}

function assertRegexSources(policy: VerifiedBuildPolicy): void {
  const patterns = {
    coreGameVersionPattern: policy.installProtocol.coreGameVersionPattern,
    supportedVersionFromGamePattern: policy.installProtocol.supportedVersionFromGamePattern,
    supportedVersionPattern: policy.installProtocol.supportedVersionPattern,
  };
  for (const [name, source] of Object.entries(patterns)) {
    if (source.length === 0) {
      throw new Error(`verified build ${name} must not be empty`);
    }
    try {
      new RegExp(source);
    } catch {
      throw new Error(`verified build ${name} is not a valid regular expression`);
    }
  }
}

/** Derives the no-install descriptor default, rejecting an incoherent policy. */
export function supportedVersionForVerifiedBuild(policy: VerifiedBuildPolicy): string {
  assertRegexSources(policy);
  const { gameVersion, installProtocol } = policy;
  if (!new RegExp(installProtocol.coreGameVersionPattern).test(gameVersion)) {
    throw new Error(`verified game build ${JSON.stringify(gameVersion)} is not major.minor.patch`);
  }
  const match = new RegExp(installProtocol.supportedVersionFromGamePattern).exec(gameVersion);
  if (match === null) {
    throw new Error(
      `verified game build ${JSON.stringify(gameVersion)} cannot derive a supported_version`
    );
  }
  const supportedVersion = `${installProtocol.launcherVersionPrefix}${match[1]}.${match[2]}.*`;
  if (!new RegExp(installProtocol.supportedVersionPattern).test(supportedVersion)) {
    throw new Error(
      `verified supported_version ${JSON.stringify(supportedVersion)} is rejected by the install protocol`
    );
  }
  return supportedVersion;
}

export const VERIFIED_BUILD_PROJECTION = {
  gameVersion: "4.4.6",
  provenance:
    "The override-rule oracle runs and the committed @pdx-ts/stellaris-ids generation were verified against Stellaris Pegasus 4.4.6.",
  installProtocol: {
    sentinelPathSegments: ["common", "technology"],
    launcherSettingsFilename: "launcher-settings.json",
    launcherVersionField: "rawVersion",
    launcherVersionPrefix: "v",
    coreGameVersionPattern: "^\\d+\\.\\d+\\.\\d+$",
    supportedVersionFromGamePattern: "^v?(\\d+)\\.(\\d+)\\.",
    supportedVersionPattern: "^v?(\\d+|\\*)(\\.(\\d+|\\*)){0,2}$",
    platformInstallDefaults: {
      darwin: [
        {
          kind: "home",
          segments: ["Library", "Application Support", "Steam", "steamapps", "common", "Stellaris"],
        },
      ],
      win32: [
        { kind: "absolute", path: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stellaris" },
      ],
      other: [
        {
          kind: "home",
          segments: [".local", "share", "Steam", "steamapps", "common", "Stellaris"],
        },
        { kind: "home", segments: [".steam", "steam", "steamapps", "common", "Stellaris"] },
      ],
    },
  },
} as const satisfies VerifiedBuildPolicy;

/**
 * Anchors the projection to the install-stamped package version, then checks
 * that the package's human-readable provenance agrees with that same build.
 */
export function assertVerifiedBuildIdentifierEvidence(
  packageVersion: string,
  provenance: string
): void {
  const expected = VERIFIED_BUILD_PROJECTION.gameVersion;
  const packageBuild = packageVersion.split("-", 1)[0];
  if (packageBuild !== expected) {
    throw new Error(
      `@pdx-ts/stellaris-ids package version ${JSON.stringify(packageVersion)} does not describe verified build ${expected}`
    );
  }
  const documentedBuild = /Generated from Stellaris \*\*(\d+\.\d+\.\d+)\*\*/.exec(provenance)?.[1];
  if (documentedBuild !== expected) {
    throw new Error(
      `@pdx-ts/stellaris-ids PROVENANCE.md describes ${JSON.stringify(documentedBuild)}, not verified build ${expected}`
    );
  }
}
