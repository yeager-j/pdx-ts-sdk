import path from "node:path";

import { featuresOfInput, isModuleNamespace } from "./authoring/bag.ts";
import { discoverFeatures, type DiscoverOptions } from "./authoring/discover.ts";
import {
  createMod,
  type CapabilityFeature,
  type FeaturesInput,
  type ModCapability,
} from "./authoring/mod.ts";
import type { BuildOptions, ModConfig, ResolvedModConfig } from "./compiler/config.ts";
import type { PureMod } from "./compiler/model.ts";
import { ProjectManifestError } from "./errors.ts";
import { DEFAULT_ID_PROFILE } from "./generated/content-capability.ts";
import { parseProjectLayout, type ProjectLayoutInput } from "./project-layout.ts";
import { parseProjectManifest } from "./project-manifest.ts";
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

/**
 * The two ways to build a project: from its declared features module, or by
 * discovering Feature modules under the manifest's `contentDirectory`.
 *
 * The discovery form is listed first only for overload resolution: an empty
 * `{}` is both an options object and, to the type checker, an empty features
 * module, and at runtime it is options. A features module has exports, so it
 * never matches the all-optional options type and falls through to its own
 * signature.
 */
export interface ModProjectBuild<P extends string> {
  /** Discovers Feature modules, captures Assets, appends Features, and compiles. */
  (options?: ModProjectBuildOptions<P>): Promise<PureMod>;
  /** Compiles the declared Features, plus the Asset tree, in one Fold. */
  (features: FeaturesInput<P>, options?: BuildOptions): PureMod;
}

/** A standard mod project with an immutable capability and repeatable build function. */
export interface ModProject<P extends string> {
  /** Validated launcher configuration with the manifest key installed as its prefix. */
  readonly config: ResolvedModConfig<P>;
  /** Immutable authoring capability used by this project's Feature modules. */
  readonly mod: ModCapability<P, typeof DEFAULT_ID_PROFILE>;
  /** Builds this project from declared Features, or from discovered ones. */
  readonly build: ModProjectBuild<P>;
}

type ProjectPrefix<Manifest extends ModProjectManifest> = Extract<keyof Manifest["mod"], string>;

/**
 * Creates the mod project described by a Project Manifest.
 *
 * Project construction validates configuration and source layout without reading the filesystem.
 * The project's `features.ts` re-exports each feature module's `feature`, and `build(features)`
 * compiles exactly those, plus the optional Asset tree, in one capability-owned Fold. The
 * older `build(options)` form instead discovers Feature modules under the manifest's
 * `contentDirectory` and appends `additionalFeatures`.
 *
 * @example
 * // src/mod.ts
 * const project = createModProject(manifest, {
 *   projectRoot: new URL("../", import.meta.url),
 * });
 * export const { config, mod } = project;
 *
 * // src/features.ts
 * export { feature as apotheosis } from "./features/apotheosis.ts";
 *
 * // build.ts
 * import * as features from "./src/features.ts";
 * await runBuild(project.build(features), { outDir });
 */
export function createModProject<const Manifest extends ModProjectManifest>(
  manifest: Manifest,
  options: CreateModProjectOptions
): ModProject<ProjectPrefix<Manifest>> {
  type Prefix = ProjectPrefix<Manifest>;

  // The manifest arrives from a JSON import, so its annotation is an
  // assertion rather than a check: everything below this line reads fields
  // whose types have actually been established.
  const parsed = parseProjectManifest(manifest);
  const prefix = parsed.prefix as Prefix;
  const manifestConfig = parsed.config as ProjectModConfig;
  const config: ModConfig<Prefix> = {
    ...manifestConfig,
    tags: manifestConfig.tags === undefined ? undefined : [...manifestConfig.tags],
    prefix,
  };
  const mod = createMod(config);
  const layout = parseProjectLayout(parsed.layout as ProjectLayoutInput);
  const projectRoot = resolveProjectRootPath(options.projectRoot);
  const contentDirectory =
    layout.contentSegments === undefined
      ? undefined
      : path.join(projectRoot, ...layout.contentSegments);
  const assetsDirectory =
    layout.assetsSegments === undefined
      ? undefined
      : path.join(projectRoot, ...layout.assetsSegments);

  const assetFeatures = (): readonly CapabilityFeature<Prefix>[] => {
    if (assetsDirectory === undefined) {
      return [];
    }
    const assets = mod.assetTree({ source: assetsDirectory, allowMissing: true, allowEmpty: true });
    return assets.length === 0 ? [] : [mod.feature("assets", assets)];
  };

  const buildDeclared = (features: FeaturesInput<Prefix>, buildOptions: BuildOptions): PureMod => {
    const declared = featuresOfInput<CapabilityFeature<Prefix>>(features);
    return mod.compile([...declared, ...assetFeatures()], { vanilla: buildOptions.vanilla });
  };

  const buildDiscovered = async (
    buildOptions: ModProjectBuildOptions<Prefix>
  ): Promise<PureMod> => {
    if (contentDirectory === undefined) {
      throw new ProjectManifestError(
        'Project Manifest has no "contentDirectory", so build(options) cannot discover ' +
          "Features; pass the features module: project.build(features)."
      );
    }
    const discovered = await discoverFeatures<Prefix>(contentDirectory, buildOptions.discover);
    const features = Object.freeze([
      ...discovered,
      ...assetFeatures(),
      ...(buildOptions.additionalFeatures ?? []),
    ]);
    return mod.compile(features, { vanilla: buildOptions.vanilla });
  };

  const build = ((
    first?: FeaturesInput<Prefix> | ModProjectBuildOptions<Prefix>,
    second?: BuildOptions
  ) => {
    if (Array.isArray(first) || isModuleNamespace(first)) {
      return buildDeclared(first as FeaturesInput<Prefix>, second ?? {});
    }
    return buildDiscovered((first ?? {}) as ModProjectBuildOptions<Prefix>);
  }) as ModProjectBuild<Prefix>;

  return Object.freeze({ config: mod.config, mod, build });
}
