import path from "node:path";

import { featuresOfInput } from "./authoring/bag.ts";
import {
  createMod,
  type CapabilityFeature,
  type FeaturesInput,
  type ModCapability,
} from "./authoring/mod.ts";
import type { BuildOptions, ModConfig, ResolvedModConfig } from "./compiler/config.ts";
import type { PureMod } from "./compiler/model.ts";
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

/** A standard mod project with an immutable capability and repeatable build function. */
export interface ModProject<P extends string> {
  /** Validated launcher configuration with the manifest key installed as its prefix. */
  readonly config: ResolvedModConfig<P>;
  /** Immutable authoring capability used by this project's Feature modules. */
  readonly mod: ModCapability<P, typeof DEFAULT_ID_PROFILE>;
  /**
   * Compiles the declared Features, plus the optional Asset tree, in one Fold.
   *
   * `features` is the project's features module, or an explicit array of this
   * capability's Features. Every export of the module must be a Feature.
   */
  readonly build: (features: FeaturesInput<P>, options?: BuildOptions) => PureMod;
}

type ProjectPrefix<Manifest extends ModProjectManifest> = Extract<keyof Manifest["mod"], string>;

/**
 * Creates the mod project described by a Project Manifest.
 *
 * Project construction validates configuration and source layout without reading the filesystem.
 * The project's `features.ts` re-exports each feature module's `feature`, and `build(features)`
 * compiles exactly those, plus the optional Asset tree, in one capability-owned Fold.
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
 * // src/build.ts
 * import * as features from "./features.ts";
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

  const build = (features: FeaturesInput<Prefix>, buildOptions: BuildOptions = {}): PureMod => {
    const declared = featuresOfInput<CapabilityFeature<Prefix>>(features);
    return mod.compile([...declared, ...assetFeatures()], { vanilla: buildOptions.vanilla });
  };

  return Object.freeze({ config: mod.config, mod, build });
}
