import type { VanillaView } from "../stellaris/vanilla/view.ts";

const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A launcher `supported_version`: one to three dot-separated parts. */
const SUPPORTED_VERSION_PATTERN = /^v?(\d+|\*)(\.(\d+|\*)){0,2}$/;

/** The mod's identity and launcher metadata. */
export interface ModConfig<P extends string = string> {
  /** Display name shown in the launcher. */
  name: string;
  /** Namespace for everything the mod emits: file names and content ids. Lowercase snake_case. */
  prefix: P;
  version?: string;
  /** Game version pattern, e.g. "4.4.*". */
  supportedVersion: string;
  tags?: string[];
  /**
   * Acknowledges a game build the rule table is not verified against. Patch
   * emission refuses a mismatched load unless this names that exact build.
   */
  acceptGameVersion?: string;
  /**
   * Acknowledges authoring without compile-time vanilla id checking. Without
   * this, compilation warns when the optional identifier package is absent or
   * does not match the supplied vanilla view.
   */
  uncheckedVanillaIds?: boolean;
}

/** The validated, copied configuration carried by a compiled mod. */
export type ResolvedModConfig<P extends string = string> = Readonly<Omit<ModConfig<P>, "tags">> & {
  readonly tags?: readonly string[];
};

const DESCRIPTOR_FORBIDDEN = /[\r\n\0"]/;

function descriptorCharName(value: string): string {
  const match = DESCRIPTOR_FORBIDDEN.exec(value);
  switch (match?.[0]) {
    case '"':
      return "a double quote";
    case "\n":
      return "a newline";
    case "\r":
      return "a carriage return";
    default:
      return "a NUL byte";
  }
}

function assertDescriptorSafe(field: string, value: string): void {
  if (!DESCRIPTOR_FORBIDDEN.test(value)) {
    return;
  }
  throw new Error(
    `Mod ${field} ${JSON.stringify(value)} cannot contain ${descriptorCharName(value)}: it is ` +
      `written verbatim into descriptor.mod as \`${field}="..."\`, a format with no escaping, ` +
      `so the value would end early and the rest would be read as further descriptor fields — ` +
      `the launcher answers a malformed descriptor by refusing the mod without saying why. ` +
      `Remove it from ${field}.`
  );
}

/** Validates the caller's config and returns a frozen copy. */
export function resolveConfig<P extends string>(
  config: Omit<ModConfig<P>, "tags"> & { readonly tags?: readonly string[] }
): ResolvedModConfig<P> {
  if (!PREFIX_PATTERN.test(config.prefix)) {
    throw new Error(`Mod prefix "${config.prefix}" must be lowercase snake_case ([a-z][a-z0-9_]*)`);
  }
  assertDescriptorSafe("name", config.name);
  if (config.version !== undefined) {
    assertDescriptorSafe("version", config.version);
  }
  assertDescriptorSafe("supportedVersion", config.supportedVersion);
  config.tags?.forEach((tag, index) => assertDescriptorSafe(`tags[${index}]`, tag));
  if (!SUPPORTED_VERSION_PATTERN.test(config.supportedVersion)) {
    throw new Error(
      `supportedVersion "${config.supportedVersion}" is not a launcher version pattern ` +
        `(e.g. "v4.4.*", "v4.*", "v4.4.6"). It is written verbatim into descriptor.mod, and ` +
        `the launcher answers an unreadable one by silently refusing the mod.`
    );
  }
  return Object.freeze({
    name: config.name,
    prefix: config.prefix,
    version: config.version,
    supportedVersion: config.supportedVersion,
    tags: config.tags === undefined ? undefined : Object.freeze([...config.tags]),
    acceptGameVersion: config.acceptGameVersion,
    uncheckedVanillaIds: config.uncheckedVanillaIds,
  });
}

export interface BuildOptions {
  /**
   * The vanilla view the mod is built against. It enables vanilla collisions,
   * patch provenance, and identifier-package checks.
   */
  readonly vanilla?: VanillaView;
}
