/**
 * `render(mod)` and `write(dir, files)` — the last two steps of the pure
 * pipeline (SDK-22). Emission grouping (collections' file hints, the patch
 * plan) happened in `buildMod`; render serializes the value. Localization
 * stays a single file regardless of hints — splitting it is a separate
 * decision for the standalone-localization work. `write` is the only impure
 * step, and it is nine lines.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { block, list, scalar, serialize } from "@pdx-ts/pdxscript";

import type { PureMod } from "./build.ts";
import { VanillaPathCollisionError } from "./errors.ts";
import { normalizeLogicalPath } from "./ordering.ts";
import { modDir } from "./stellaris/launcher/mod-directory.ts";

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

export async function write(
  outDir: string | URL,
  files: ReadonlyMap<string, string>
): Promise<void> {
  const root = path.resolve(outDir instanceof URL ? fileURLToPath(outDir) : outDir);
  for (const [relPath, content] of files) {
    // Every key must land *strictly under* the root. `render` only ever
    // produces relative paths, but `write` is exported and takes any map, and
    // `path.join` would happily resolve `../..` or an absolute key to
    // somewhere the caller never named — writing a file outside the directory
    // they asked to fill.
    //
    // Compared by `path.relative` rather than a string prefix: a prefix test
    // has to append a separator to stop `/out` matching `/output`, and that
    // appended separator is wrong precisely when the root already ends in one
    // — `write("/", ...)` compares against `"//"` and rejects every legitimate
    // child. `path.relative` is separator-correct at a filesystem root, and on
    // Windows returns an absolute path for a different drive, which is exactly
    // the "not contained" answer.
    const target = path.resolve(root, relPath);
    const relative = path.relative(root, target);
    // An empty result means the target *is* the root: a directory, not a file
    // in it, so it is refused with the escapes rather than allowed.
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Refusing to write "${relPath}": it resolves to ${target}, which is not a file inside ` +
          `the output directory ${root}. A path that escapes the output directory would ` +
          `overwrite a file the caller never named. Pass paths relative to the output ` +
          `directory, without ".." segments and without a leading "/".`
      );
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

/**
 * Characters a folder name may not carry, because the name reaches the
 * launcher descriptor: `install` writes `path="<modDir>/<dirName>"`, the same
 * unescaped `key="value"` format `buildMod` validates its config fields
 * against. A `"` closes the value and a line break ends the line, so a folder
 * name is a second door into the descriptor-forgery the config gate already
 * closed. Every C0 control is refused with them — none belongs in a folder
 * name, and each does something different and equally unwanted to a
 * line-oriented format.
 */
const DIR_NAME_FORBIDDEN = /["\u0000-\u001f]/;

/**
 * A content folder name, checked before it is joined to the launcher's mod
 * directory.
 *
 * Two separate hazards, one gate. `install` replaces the directory it
 * computes, so this name decides what gets *deleted*: `""` resolves to the mod
 * directory itself, `".."` to its parent, and `"a/b"` to somewhere sideways —
 * each a recursive delete of a directory full of the user's other mods. And
 * the name is then written into the launcher descriptor verbatim, so it
 * decides what that file *says*. A single, plain path segment is the only
 * thing that is safe on both counts, so anything else is refused rather than
 * normalized into something plausible.
 */
function assertInstallDirName(dirName: string, fromPrefix: boolean): void {
  const source = fromPrefix
    ? `The mod prefix "${dirName}" is the default folder name`
    : `install's dirName ${JSON.stringify(dirName)}`;
  if (
    dirName === "" ||
    dirName === "." ||
    dirName === ".." ||
    dirName.includes("/") ||
    dirName.includes("\\") ||
    path.isAbsolute(dirName) ||
    path.basename(dirName) !== dirName
  ) {
    throw new Error(
      `${source}, and it is not a single folder name: it must not be empty, "." or "..", ` +
        `contain "/" or "\\", or be absolute. It is joined to the launcher's mod directory and ` +
        `the result is replaced wholesale, so a name that escapes that directory would delete ` +
        `content the mod does not own. Pass a plain folder name.`
    );
  }
  if (DIR_NAME_FORBIDDEN.test(dirName)) {
    const character = /["]/.test(dirName)
      ? "a double quote"
      : /[\r\n]/.test(dirName)
        ? "a line break"
        : "a control character";
    throw new Error(
      `${source}, and it cannot contain ${character}: install writes it into the launcher ` +
        `descriptor as \`path="<mod directory>/${dirName.replace(/["\u0000-\u001f]/g, "?")}"\`, ` +
        `a format with no escaping, so the value would end early and the rest would be read as ` +
        `further descriptor fields — the launcher answers a malformed descriptor by refusing ` +
        `the mod without saying why. Pass a plain folder name.`
    );
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
 *
 * **The content directory is replaced, not merged into.** `write` only
 * overwrites the paths it is given, so renaming a feature module across two
 * installs would leave the old emitted file in place — and the game would load
 * both, which is a duplicate-id error at best and two live copies of a
 * definition at worst. Since this directory is emitted output that `install`
 * owns entirely, the honest fix is to clear it: what lands is exactly what the
 * current build renders. Anything hand-edited in there is by definition not
 * part of the mod and does not survive, which is why the SDK writes it and the
 * author does not.
 *
 * **Replacing it is never a window where the mod is gone.** Rendering happens
 * first, into memory, so a build that throws — a vanilla path collision, a
 * malformed value — leaves the previous install exactly as it was. What did
 * render is staged into a sibling directory and swapped in by rename, so the
 * old copy is only removed once a complete new one is in place, and a failed
 * swap puts the old one back. The descriptor is written last, for the same
 * reason: it points at content, and pointing at content that is not there yet
 * is what makes a launcher list a broken mod.
 */
export async function install(mod: PureMod, options: InstallOptions = {}): Promise<InstallResult> {
  const root = options.modDir ?? modDir();
  const dirName = options.dirName ?? mod.config.prefix;
  assertInstallDirName(dirName, options.dirName === undefined);
  const contentDir = path.join(root, dirName);
  const descriptorPath = path.join(root, `${dirName}.mod`);

  // Before anything on disk changes: a throw here (VanillaPathCollisionError,
  // a malformed definition) must leave the existing install untouched, which
  // it cannot if the delete already happened.
  const files = render(mod);

  await mkdir(root, { recursive: true });
  // Staged as a sibling, inside the same directory and so on the same
  // filesystem, which is what makes the rename below atomic rather than a
  // copy. The leading dot keeps a crash-orphaned staging directory out of the
  // launcher's way: it has no `.mod` descriptor beside it, so nothing loads it.
  //
  // Fixed-size names that do not embed `dirName`: a filesystem bounds each
  // *component* (255 bytes on APFS and ext4), and a name built by decorating
  // `dirName` overflows that bound while `dirName` itself is still perfectly
  // legal — so a long folder name would fail with ENAMETOOLONG before the
  // install had done anything. The uuid is what keeps two installs running in
  // one mod directory from staging over each other; `dirName` never had to be
  // in the name for that.
  const staging = path.join(root, `.pdx-staging-${randomUUID()}`);
  const previous = path.join(root, `.pdx-previous-${randomUUID()}`);
  try {
    await write(staging, files);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  // The swap: move any existing install aside, put the new one in its place,
  // and only then delete the old copy. Every step is a rename within one
  // directory, so at no point is `contentDir` a half-written mod.
  let movedAside = false;
  try {
    await rename(contentDir, previous);
    movedAside = true;
  } catch (error) {
    // No previous install is the ordinary first-install case, not a failure.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  try {
    await rename(staging, contentDir);
  } catch (error) {
    if (movedAside) {
      await rename(previous, contentDir);
    }
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (movedAside) {
    await rm(previous, { recursive: true, force: true });
  }

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
