/**
 * Pure rendering: emission grouping (collections' file hints, the patch plan)
 * happened in `buildMod`; this module serializes the value. Localization stays
 * a single file regardless of hints — splitting it is a separate decision for
 * the standalone-localization work.
 */

import { block, list, scalar, serialize } from "@pdx-ts/pdxscript";

import type { PureMod } from "../build.ts";
import { VanillaPathCollisionError } from "../errors.ts";
import { normalizeLogicalPath } from "../ordering.ts";

export function render(mod: PureMod): Map<string, string> {
  const { prefix } = mod.config;
  const files = new Map<string, string>();
  files.set("descriptor.mod", renderDescriptor(mod));
  for (const file of mod.contentFiles) {
    files.set(file.relPath, serialize(file.entries));
  }
  for (const file of mod.eventFiles) {
    files.set(file.relPath, serialize(file.entries));
  }
  if (mod.shipOfSizeLimits.size > 0) {
    files.set(
      `common/country_limits/ownership_limits/${prefix}_ownership_limits.txt`,
      serialize([
        block("default", [
          list(
            "ship_of_size_limits",
            [...mod.shipOfSizeLimits].map((id) => scalar(id))
          ),
        ]),
      ])
    );
  }
  if (mod.onActions.length > 0) {
    files.set(`common/on_actions/${prefix}_on_actions.txt`, serialize(mod.onActions));
  }
  files.set(`localisation/english/${prefix}_l_english.yml`, renderLocalization(mod));

  if (mod.patchPlan !== undefined) {
    files.set(mod.patchPlan.relPath, mod.patchPlan.content);
  }
  // Runs whenever the build knew about a vanilla load, not only when it
  // patched one: emitting over a vanilla file replaces that file wholesale
  // regardless of whether this mod happens to patch anything. `descriptor.mod`
  // is exempt because every mod has one and it never lands in the game's own
  // tree; the patch plan's own file is checked like any other, and is named to
  // beat vanilla's rather than to occupy it.
  if (mod.vanillaPaths !== undefined) {
    for (const relPath of files.keys()) {
      if (relPath !== "descriptor.mod" && mod.vanillaPaths.has(normalizeLogicalPath(relPath))) {
        throw new VanillaPathCollisionError(
          `this mod would emit ${relPath}, a path vanilla already occupies — a same-path ` +
            `collision silently replaces the entire vanilla file`
        );
      }
    }
  }
  return files;
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
export function renderLauncherDescriptor(mod: PureMod, contentDir: string): string {
  return [...descriptorLines(mod), `path="${contentDir}"`].join("\n") + "\n";
}

function renderLocalization(mod: PureMod): string {
  // The BOM is mandatory: Stellaris silently ignores localization files without it.
  const lines = [...mod.loc].map(([key, text]) => ` ${key}:0 "${text}"`);
  return "\uFEFF" + ["l_english:", ...lines].join("\n") + "\n";
}
