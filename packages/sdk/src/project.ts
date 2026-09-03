import path from "node:path";

import { featuresOfInput } from "./authoring/bag.ts";
import {
  createCapability,
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
   *
   * @throws Error - When this project's `mod` minted a Feature that `features`
   * does not include. Such a Feature was authored and would otherwise be
   * dropped without a word; the message names it and the line to add.
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
  // Every `mod.feature` call runs when its module is evaluated, so by the time
  // `build` runs, this holds every Feature an author minted from this project's
  // mod, whether or not the features module reached it. That is what makes a
  // module that a declared feature imports for a helper, and that mints a
  // Feature of its own, visible here and nowhere else: knip sees it reached,
  // and the features module never names it.
  const minted = new Set<CapabilityFeature<Prefix>>();
  const mod = createCapability(config, DEFAULT_ID_PROFILE, {
    onFeature: (feature) => minted.add(feature),
  });
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
    if (assets.length === 0) {
      return [];
    }
    const feature = mod.feature("assets", assets);
    // The project minted this one itself, so the list is not expected to name it.
    minted.delete(feature);
    return [feature];
  };

  const build = (features: FeaturesInput<Prefix>, buildOptions: BuildOptions = {}): PureMod => {
    const declared = featuresOfInput<CapabilityFeature<Prefix>>(features);
    const undeclared = undeclaredFeatures(minted, declared);
    if (undeclared.length > 0) {
      throw new Error(undeclaredFeaturesMessage(undeclared));
    }
    return mod.compile([...declared, ...assetFeatures()], { vanilla: buildOptions.vanilla });
  };

  return Object.freeze({ config: mod.config, mod, build });
}

/** The minted Features the declared list leaves out, in stem order with stemless ones last. */
function undeclaredFeatures<F extends CapabilityFeature<string>>(
  minted: ReadonlySet<F>,
  declared: readonly F[]
): readonly F[] {
  const listed = new Set(declared);
  return [...minted].filter((feature) => !listed.has(feature)).sort(byStem);
}

function byStem(a: CapabilityFeature<string>, b: CapabilityFeature<string>): number {
  if (a.stem === b.stem) {
    return 0;
  }
  if (a.stem === undefined) {
    return 1;
  }
  if (b.stem === undefined) {
    return -1;
  }
  return a.stem < b.stem ? -1 : 1;
}

function undeclaredFeaturesMessage(features: readonly CapabilityFeature<string>[]): string {
  const named = features.map((feature) =>
    feature.stem === undefined ? "Feature (no stem)" : `Feature ${JSON.stringify(feature.stem)}`
  );
  const [was, it] = named.length === 1 ? ["was", "it"] : ["were", "each"];
  return (
    `${named.join(", ")} ${was} created by this project's mod but ${was} not passed to ` +
    `project.build. Declare ${it} in src/features.ts ` +
    `(export { feature as <name> } from "./features/<file>.ts"), or drop the mod.feature ` +
    `call if that module is a helper.`
  );
}
