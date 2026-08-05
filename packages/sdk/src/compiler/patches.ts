import { serialize } from "@pdx-ts/pdxscript";

import type { PlacedItem } from "../authoring/feature.ts";
import { StaleRuleTableError } from "../errors.ts";
import { normalizeLogicalPath } from "../ordering.ts";
import {
  collectVarRefs,
  planPatchEmission,
  type PatchPlan,
} from "../stellaris/vanilla/override-plan.ts";
import { SUPPORTED_STELLARIS_BUILD } from "../stellaris/vanilla/override-rules.ts";
import type { PatchedTechnology } from "../stellaris/vanilla/patch.ts";
import { sha256Hex, type VanillaFile } from "../stellaris/vanilla/view.ts";
import type { BuildOptions, ResolvedModConfig } from "./config.ts";
import type { ContentFile } from "./model.ts";
import type { ReferenceUse } from "./references.ts";

export function collectPatches(
  flat: readonly PlacedItem[],
  options: BuildOptions,
  refUses: ReferenceUse[]
): PatchedTechnology[] {
  const patches: PatchedTechnology[] = [];
  for (const { item } of flat) {
    if (item.itemKind !== "patch") {
      continue;
    }
    const patched = item.patched;
    if (patches.some((existing) => existing.id === patched.id)) {
      throw new Error(`Duplicate patch for technology "${patched.id}"`);
    }
    const expected = options.vanilla?.manifestKey ?? patches[0]?.source.origin.manifestKey;
    if (expected !== undefined && patched.source.origin.manifestKey !== expected) {
      throw new Error(
        `Patch for "${patched.id}" comes from a different vanilla load than ` +
          `${options.vanilla !== undefined ? "the view passed to buildMod" : "earlier patches"} ` +
          `(manifest ${patched.source.origin.manifestKey.slice(0, 12)} vs ${expected.slice(0, 12)}); ` +
          `patch one mod from one view`
      );
    }
    patches.push(patched);
    for (const use of patched.refs) {
      refUses.push({ owner: `the patch of ${patched.id}`, use });
    }
  }
  return patches;
}

export function planPatches(
  config: ResolvedModConfig,
  techFiles: readonly ContentFile[],
  patches: readonly PatchedTechnology[]
): PatchPlan | undefined {
  if (patches.length === 0) {
    return undefined;
  }
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

  const enumeration: VanillaFile[] = [
    ...origin.files.filter((file) => file.path.startsWith("common/technology/")),
    ...techFiles.map((file) => ({
      path: normalizeLogicalPath(file.relPath),
      sha256: sha256Hex(serialize(file.entries)),
      keys: file.ids,
    })),
  ];

  return planPatchEmission({
    registry: "technologies",
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
    reservedPaths: techFiles.map((file) => file.relPath),
    prefix,
  });
}
