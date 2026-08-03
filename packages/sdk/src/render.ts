/**
 * `render(mod)` and `write(dir, files)` — the last two steps of the pure
 * pipeline (SDK-22). Emission grouping (collections' file hints, the patch
 * plan) happened in `buildMod`; render serializes the value. Localization
 * stays a single file regardless of hints — splitting it is a separate
 * decision for the standalone-localization work. `write` is the only impure
 * step, and it is nine lines.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { block, list, scalar, serialize } from "@pdx-ts/pdxscript";

import type { PureMod } from "./build.ts";
import { VanillaPathCollisionError } from "./errors.ts";
import { normalizeLogicalPath } from "./resolver/path-order.ts";
import { modDir } from "./stellaris/mod-dir.ts";

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
    const vanillaPaths = mod.vanillaPaths ?? new Set<string>();
    for (const relPath of files.keys()) {
      if (relPath !== "descriptor.mod" && vanillaPaths.has(normalizeLogicalPath(relPath))) {
        throw new VanillaPathCollisionError(
          `this mod would emit ${relPath}, a path vanilla already occupies — a same-path ` +
            `collision silently replaces the entire vanilla file`
        );
      }
    }
  }
  return files;
}

export async function write(
  outDir: string | URL,
  files: ReadonlyMap<string, string>
): Promise<void> {
  const root = outDir instanceof URL ? fileURLToPath(outDir) : outDir;
  for (const [relPath, content] of files) {
    const target = path.join(root, relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

export interface InstallOptions {
  /** The launcher's mod directory. Defaults to `stellaris.modDir()`. */
  readonly modDir?: string;
  /** The content folder's name inside it. Defaults to the mod's prefix. */
  readonly dirName?: string;
}

export interface InstallResult {
  readonly contentDir: string;
  readonly descriptorPath: string;
}

/**
 * Put the mod where the launcher will find it: the content into
 * `<modDir>/<dirName>/`, and the `<dirName>.mod` descriptor beside it.
 *
 * `render` + `write` + `renderLauncherDescriptor`, composed — a sink over a
 * built `PureMod`, never a second way into the fold. Everything about what the
 * mod *is* was decided by `buildMod`; this only decides where it lands.
 */
export async function install(mod: PureMod, options: InstallOptions = {}): Promise<InstallResult> {
  const root = options.modDir ?? modDir();
  const dirName = options.dirName ?? mod.config.prefix;
  const contentDir = path.join(root, dirName);
  const descriptorPath = path.join(root, `${dirName}.mod`);

  await write(contentDir, render(mod));
  await mkdir(root, { recursive: true });
  await writeFile(descriptorPath, renderLauncherDescriptor(mod, contentDir), "utf8");
  return { contentDir, descriptorPath };
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
 * The launcher-side `<prefix>.mod`: the mod's own descriptor plus the `path=`
 * line telling the launcher where the content is.
 *
 * Not a key in `render()`'s map, and that is the point — that map is
 * mod-root-relative, and this file lives *outside* the mod directory, beside
 * it. Its content also depends on where the mod is being installed, which
 * render has no business knowing.
 */
export function renderLauncherDescriptor(mod: PureMod, contentDir: string): string {
  return [...descriptorLines(mod), `path="${contentDir}"`].join("\n") + "\n";
}

function renderLocalization(mod: PureMod): string {
  // The BOM is mandatory: Stellaris silently ignores localization files without it.
  const lines = [...mod.loc].map(([key, text]) => ` ${key}:0 "${text}"`);
  return "\uFEFF" + ["l_english:", ...lines].join("\n") + "\n";
}
