import { serialize } from "@pdx-ts/pdxscript";

import type { PlacedItem } from "../authoring/feature.ts";
import { StaleRuleTableError } from "../errors.ts";
import type { ContentTypeName } from "../generated/content-registry.ts";
import {
  collectVarRefs,
  planPatchEmission,
  type PatchPlan,
} from "../installation/vanilla/override-plan.ts";
import { registryRule, SUPPORTED_STELLARIS_BUILD } from "../installation/vanilla/override-rules.ts";
import { sha256Hex } from "../installation/vanilla/parse.ts";
import type { VanillaFile } from "../installation/vanilla/parsed-definitions.ts";
import type { PatchedContent } from "../installation/vanilla/patch.ts";
import {
  compareLogicalPaths,
  compareUtf8,
  normalizeLogicalPath,
  type LogicalPath,
} from "../ordering.ts";
import type { BuildOptions, ResolvedModConfig } from "./config.ts";
import type { ContentFile } from "./model.ts";
import type { ReferenceUse } from "./references.ts";

/**
 * The placed patches, grouped by the registry each one names, and sorted by id
 * within a group.
 *
 * Grouping here rather than at planning time is what keeps the rest of the
 * fold registry-blind: a patch carries its own registry tag, so nothing has to
 * ask which registries exist. Duplicate keys are refused per registry, since
 * two registries may legitimately ship a definition of the same id, and the
 * one-view check spans every registry — a build patches one vanilla load.
 */
export function collectPatches(
  flat: readonly PlacedItem[],
  options: BuildOptions,
  refUses: ReferenceUse[]
): ReadonlyMap<string, readonly PatchedContent[]> {
  const byRegistry = new Map<string, PatchedContent[]>();
  let expected = options.vanilla?.manifestKey;
  for (const { item } of flat) {
    if (item.itemKind !== "patch") {
      continue;
    }
    const patched = item.patched;
    const { registry } = patched;
    const patches = byRegistry.get(registry) ?? [];
    if (patches.some((existing) => existing.id === patched.id)) {
      throw new Error(`Duplicate patch for ${registry} "${patched.id}"`);
    }
    expected ??= patched.source.origin.manifestKey;
    if (patched.source.origin.manifestKey !== expected) {
      throw new Error(
        `Patch for "${patched.id}" comes from a different vanilla load than ` +
          `${options.vanilla !== undefined ? "the view passed to buildMod" : "earlier patches"} ` +
          `(manifest ${patched.source.origin.manifestKey.slice(0, 12)} vs ${expected.slice(0, 12)}); ` +
          `patch one mod from one view`
      );
    }
    patches.push(patched);
    byRegistry.set(registry, patches);
    for (const use of patched.refs) {
      refUses.push({ owner: `the patch of ${patched.id}`, use });
    }
  }
  return new Map(
    [...byRegistry].map(([registry, patches]) => [
      registry,
      [...patches].sort((a, b) => compareUtf8(a.id, b.id)),
    ])
  );
}

/**
 * One emission plan per patched registry, in path order.
 *
 * Each registry is planned independently — its own enumeration, its own
 * winning filename — because the game resolves each directory on its own. Both
 * halves of that enumeration are derived from the registry name: the vanilla
 * side from the rule table's directory, this mod's side from the content files
 * that registry wrote. Ordering the plans by emitted path keeps emission a
 * function of content rather than of the order patches were authored in
 * (ADR-0005).
 */
export function planPatches(
  config: ResolvedModConfig,
  contentFiles: readonly ContentFile[],
  patchesByRegistry: ReadonlyMap<string, readonly PatchedContent[]>,
  occupiedPaths: readonly LogicalPath[]
): PatchPlan[] {
  const plans = [...patchesByRegistry]
    .filter(([, patches]) => patches.length > 0)
    .map(([registry, patches]) =>
      planRegistry(config, contentFiles, registry, patches, occupiedPaths)
    );
  return plans.sort((a, b) => compareLogicalPaths(a.relPath, b.relPath));
}

function planRegistry(
  config: ResolvedModConfig,
  contentFiles: readonly ContentFile[],
  registry: string,
  patches: readonly PatchedContent[],
  occupiedPaths: readonly LogicalPath[]
): PatchPlan {
  const { prefix } = config;
  const origin = patches[0]!.source.origin;
  if (
    origin.gameVersion !== undefined &&
    origin.gameVersion !== SUPPORTED_STELLARIS_BUILD &&
    config.acceptGameVersion !== origin.gameVersion
  ) {
    throw new StaleRuleTableError(
      `the install is Stellaris ${origin.gameVersion} but the rule table is verified against ` +
        `${SUPPORTED_STELLARIS_BUILD} — re-verify the oracle runs, or set ` +
        `acceptGameVersion: "${origin.gameVersion}" to proceed on the stale table`
    );
  }

  const { dir } = registryRule(registry);
  const ownFiles = contentFiles.filter((file) => file.types.includes(registry as ContentTypeName));
  const enumeration: VanillaFile[] = [
    ...origin.files.filter((file) => file.path.startsWith(`${dir}/`)),
    ...ownFiles.map((file) => ({
      path: file.relPath,
      sha256: sha256Hex(serialize(file.entries)),
      keys: file.ids,
    })),
  ];

  return planPatchEmission({
    registry,
    patches: patches.map((patched) => {
      const entry = patched.toEntries();
      const fileLocals = origin.localVariables(patched.source.sourceFile);
      const locals = new Map<string, number>();
      for (const name of collectVarRefs(entry)) {
        const value = fileLocals.get(name);
        if (value !== undefined) {
          locals.set(name, value);
        }
      }
      return {
        key: patched.id,
        sourceFile: patched.source.sourceFile,
        sourceSha256: patched.source.sourceSha256,
        entry,
        locals,
      };
    }),
    enumeration,
    reservedPaths: occupiedPaths,
    prefix,
  });
}
