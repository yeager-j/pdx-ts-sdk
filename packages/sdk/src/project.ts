import path from "node:path";

import { discoverFeatures, type DiscoverOptions } from "./authoring/discover.ts";
import { createMod, type CapabilityFeature, type ModCapability } from "./authoring/mod.ts";
import type { BuildOptions, ModConfig, ResolvedModConfig } from "./compiler/config.ts";
import type { PureMod } from "./compiler/model.ts";
import { DEFAULT_ID_PROFILE } from "./generated/content-capability.ts";
import { parseProjectLayout, type ProjectLayoutInput } from "./project-layout.ts";
import { resolveProjectRootPath } from "./project-root.ts";

/** Launcher configuration stored below the sole prefix key in a Project Manifest. */
export type ProjectModConfig = Readonly<Omit<ModConfig<string>, "prefix" | "tags">> & {
  readonly tags?: readonly string[];
};

/** The Project Manifest fields used by the standard SDK build pipeline. */
export interface ModProjectManifest extends ProjectLayoutInput {
  /** Exactly one entry whose key is the mod prefix and whose value is launcher configuration. */
  readonly mod: Readonly<Record<string, ProjectModConfig>>;
}

/** Options that locate a Project Manifest's relative source directories. */
export interface CreateModProjectOptions {
  /** Absolute project directory as a path or file URL. */
  readonly projectRoot: string | URL;
}

/** Customizes discovery and appends Features before the standard Fold. */
export interface ModProjectBuildOptions<P extends string> extends BuildOptions {
  /** Options for the standard recursive Feature discovery pass. */
  readonly discover?: DiscoverOptions;
  /** Capability-owned Features appended after discovery and Asset capture. */
  readonly additionalFeatures?: readonly CapabilityFeature<P>[];
}

/** A standard mod project with an immutable capability and repeatable build function. */
export interface ModProject<P extends string> {
  /** Validated launcher configuration with the manifest key installed as its prefix. */
  readonly config: ResolvedModConfig<P>;
  /** Immutable authoring capability used by this project's Feature modules. */
  readonly mod: ModCapability<P, typeof DEFAULT_ID_PROFILE>;
  /** Discovers, captures, appends additional Features, and compiles this project. */
  readonly build: (options?: ModProjectBuildOptions<P>) => Promise<PureMod>;
}

type ProjectPrefix<Manifest extends ModProjectManifest> = Extract<keyof Manifest["mod"], string>;

/**
 * Creates the conventional file-per-Feature mod project described by a Project Manifest.
 *
 * Project construction validates configuration and source layout without reading the filesystem.
 * Each `build()` call then discovers Features, captures the optional Asset tree, and performs one
 * capability-owned Fold. Use `additionalFeatures` for additive customization, or compose
 * `discoverFeatures`, `mod.assetTree`, and `mod.compile` directly for a different pipeline.
 *
 * @example
 * const project = createModProject(manifest, {
 *   projectRoot: new URL("../", import.meta.url),
 * });
 * export const { config, mod } = project;
 * export const buildTheMod = project.build;
 */
export function createModProject<const Manifest extends ModProjectManifest>(
  manifest: Manifest,
  options: CreateModProjectOptions
): ModProject<ProjectPrefix<Manifest>> {
  type Prefix = ProjectPrefix<Manifest>;

  const prefixes = Object.keys(manifest.mod);
  if (prefixes.length !== 1) {
    throw new Error(
      `stellaris-mod.json must declare exactly one mod, and declares ${prefixes.length}. ` +
        `The single key under "mod" is this mod's prefix.`
    );
  }

  const prefix = prefixes[0] as Prefix;
  const manifestConfig = manifest.mod[prefix] as ProjectModConfig;
  const config: ModConfig<Prefix> = {
    ...manifestConfig,
    tags: manifestConfig.tags === undefined ? undefined : [...manifestConfig.tags],
    prefix,
  };
  const mod = createMod(config);
  const layout = parseProjectLayout(manifest);
  const projectRoot = resolveProjectRootPath(options.projectRoot);
  const contentDirectory = path.join(projectRoot, ...layout.contentSegments);
  const assetsDirectory =
    layout.assetsSegments === undefined
      ? undefined
      : path.join(projectRoot, ...layout.assetsSegments);

  const build = async (buildOptions: ModProjectBuildOptions<Prefix> = {}): Promise<PureMod> => {
    const discovered = await discoverFeatures<Prefix>(contentDirectory, buildOptions.discover);
    const assets =
      assetsDirectory === undefined
        ? []
        : mod.assetTree({ source: assetsDirectory, allowMissing: true, allowEmpty: true });
    const assetFeatures = assets.length === 0 ? [] : [mod.feature("assets", assets)];
    const features = Object.freeze([
      ...discovered,
      ...assetFeatures,
      ...(buildOptions.additionalFeatures ?? []),
    ]);

    return mod.compile(features, { vanilla: buildOptions.vanilla });
  };

  return Object.freeze({ config: mod.config, mod, build });
}
