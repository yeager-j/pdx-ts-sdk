/**
 * Pure rendering: emission grouping (collections' file hints, the patch plan)
 * happened in `buildMod`; this module serializes the value. Localization files
 * already carry their feature stem, language, layer, and canonical key order.
 */

import { block, list, scalar, serialize } from "@pdx-ts/pdxscript";

import type { PureMod } from "../compiler/model.ts";
import { VanillaPathCollisionError } from "../errors.ts";
import { normalizeLogicalPath } from "../ordering.ts";
import {
  createRenderedMod,
  launcherDescriptor,
  type RenderedClaim,
  type RenderedMod,
} from "./rendered.ts";

export function render(mod: PureMod): RenderedMod {
  const { prefix } = mod.config;
  const files: RenderedClaim[] = [];
  files.push({ path: "descriptor.mod", owner: "mod descriptor", text: renderDescriptor(mod) });
  for (const file of mod.contentFiles) {
    files.push({
      path: file.relPath,
      owner: `content ${file.ids.join(", ")}`,
      text: serialize(file.entries),
    });
  }
  for (const file of mod.eventFiles) {
    files.push({
      path: file.relPath,
      owner: `events ${file.relPath}`,
      text: serialize(file.entries),
    });
  }
  if (mod.shipOfSizeLimits.size > 0) {
    files.push({
      path: `common/country_limits/ownership_limits/${prefix}_ownership_limits.txt`,
      owner: "ship-of-size limits",
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
  if (mod.onActions.length > 0) {
    files.push({
      path: `common/on_actions/${prefix}_on_actions.txt`,
      owner: "on-action hooks",
      text: serialize(mod.onActions),
    });
  }
  for (const file of mod.localizationFiles) {
    files.push({
      path: file.relPath,
      owner: `localization ${file.language}`,
      text: renderLocalization(file.language, file.entries),
    });
  }

  for (const plan of mod.patchPlans) {
    files.push({ path: plan.relPath, owner: `patch ${plan.relPath}`, text: plan.content });
  }
  // Runs whenever the build knew about a vanilla load, not only when it
  // patched one: emitting over a vanilla file replaces that file wholesale
  // regardless of whether this mod happens to patch anything. `descriptor.mod`
  // is exempt because every mod has one and it never lands in the game's own
  // tree; the patch plan's own file is checked like any other, and is named to
  // beat vanilla's rather than to occupy it.
  if (mod.vanillaPaths !== undefined) {
    for (const { path: relPath } of files) {
      if (relPath !== "descriptor.mod" && mod.vanillaPaths.has(normalizeLogicalPath(relPath))) {
        throw new VanillaPathCollisionError(
          `this mod would emit ${relPath}, a path vanilla already occupies — a same-path ` +
            `collision silently replaces the entire vanilla file`
        );
      }
    }
  }
  return createRenderedMod(prefix, renderDescriptor(mod), files);
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
