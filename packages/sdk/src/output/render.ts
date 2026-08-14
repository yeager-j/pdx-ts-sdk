/**
 * Pure rendering: emission grouping (collections' file hints, the patch plan)
 * happened in `buildMod`; this module serializes the value. Localization files
 * already carry their feature stem, language, layer, and canonical key order.
 */

import { block, list, scalar, serialize } from "@pdx-ts/pdxscript";

import type { PureMod } from "../compiler/model.ts";
import { DESCRIPTOR_PATH } from "../compiler/paths.ts";
import { PdxSdkError } from "../errors.ts";
import { compareUtf8 } from "../ordering.ts";
import {
  createRenderedMod,
  launcherDescriptor,
  type RenderedClaim,
  type RenderedMod,
} from "./rendered.ts";

export function render(mod: PureMod): RenderedMod {
  const { prefix } = mod.config;
  const files: RenderedClaim[] = [];
  files.push({ path: DESCRIPTOR_PATH, text: renderDescriptor(mod) });
  for (const file of mod.contentFiles) {
    files.push({
      path: file.relPath,
      text: serialize(file.entries),
    });
  }
  for (const file of mod.eventFiles) {
    files.push({
      path: file.relPath,
      text: serialize(file.entries),
    });
  }
  if (mod.shipOfSizeLimitsPath !== undefined) {
    files.push({
      path: mod.shipOfSizeLimitsPath,
      text: serialize([
        block("default", [
          list(
            "ship_of_size_limits",
            [...mod.shipOfSizeLimits].map((id) => scalar(id))
          ),
        ]),
      ]),
    });
  }
  if (mod.onActionsPath !== undefined) {
    files.push({
      path: mod.onActionsPath,
      text: serialize(mod.onActions),
    });
  }
  for (const file of mod.localizationFiles) {
    files.push({
      path: file.relPath,
      text: renderLocalization(file.language, file.entries),
    });
  }

  for (const plan of mod.patchPlans) {
    files.push({ path: plan.relPath, text: plan.content });
  }
  assertSerializesTheLedger(mod, files);
  return createRenderedMod(prefix, renderDescriptor(mod), files);
}

/**
 * Every path serialized here was adjudicated, and every adjudicated path is
 * serialized here.
 *
 * Path ownership is settled in the fold, which is only worth anything if
 * rendering cannot then invent a path or drop one. Without this check a channel
 * added later could quietly emit an unadjudicated file — exactly the hole the
 * ledger exists to close — and the mismatch would surface as a stale mod
 * directory rather than as an error.
 */
function assertSerializesTheLedger(mod: PureMod, files: readonly RenderedClaim[]): void {
  const adjudicated = new Set<string>(mod.paths.map((claim) => claim.path));
  const serialized = new Set<string>(files.map((file) => file.path));
  const unadjudicated = [...serialized].filter((path) => !adjudicated.has(path)).sort(compareUtf8);
  const unserialized = [...adjudicated].filter((path) => !serialized.has(path)).sort(compareUtf8);
  if (unadjudicated.length === 0 && unserialized.length === 0) {
    return;
  }
  throw new PdxSdkError(
    `render() and the path ledger disagree` +
      (unadjudicated.length > 0 ? `; not adjudicated: ${unadjudicated.join(", ")}` : "") +
      (unserialized.length > 0 ? `; not serialized: ${unserialized.join(", ")}` : "")
  );
}

/**
 * The fields both descriptors share, in the order Stellaris writes them. There
 * are two descriptors — the one inside the mod folder and the one beside it
 * that the launcher reads — and they differ by exactly one line. Deriving both
 * from this is what stops them drifting, which is what happened to the two
 * hand-rolled copies that used to live in `examples/`.
 */
function descriptorLines(mod: PureMod): string[] {
  const { name, version, tags, supportedVersion } = mod.config;
  const lines = [`name="${name}"`];
  if (version !== undefined) {
    lines.push(`version="${version}"`);
  }
  if (tags !== undefined && tags.length > 0) {
    lines.push("tags={", ...tags.map((tag) => `\t"${tag}"`), "}");
  }
  lines.push(`supported_version="${supportedVersion}"`);
  return lines;
}

function renderDescriptor(mod: PureMod): string {
  return descriptorLines(mod).join("\n") + "\n";
}

/**
 * The launcher-side `<prefix>.mod`: the mod's own descriptor plus a `path=`
 * line telling the launcher where the content is.
 *
 * Not a key in `render()`'s map, and that is the point — that map is
 * mod-root-relative, and this file lives outside the mod directory, beside it.
 * Its content also depends on where the mod is being installed, which render
 * itself has no business knowing.
 */
export function renderLauncherDescriptor(rendered: RenderedMod, contentDir: string): string {
  assertDescriptorPathSafe(contentDir);
  return launcherDescriptor(rendered, contentDir);
}

function assertDescriptorPathSafe(contentDir: string): void {
  if (!/["\u0000-\u001f]/.test(contentDir)) {
    return;
  }
  throw new Error(
    `Launcher content path ${JSON.stringify(contentDir)} contains a quote or control character. ` +
      `The launcher descriptor format has no escaping for path values, so install cannot encode it safely.`
  );
}

function renderLocalization(
  language: string,
  entries: readonly (readonly [key: string, text: string])[]
): string {
  // The BOM is mandatory: Stellaris silently ignores localization files without it.
  const lines = entries.map(([key, text]) => ` ${key}:0 "${text}"`);
  return "\uFEFF" + [`l_${language}:`, ...lines].join("\n") + "\n";
}
