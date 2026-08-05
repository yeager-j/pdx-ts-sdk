import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PureMod } from "../compiler/model.ts";
import { modDir } from "../stellaris/launcher/mod-directory.ts";
import { render, renderLauncherDescriptor } from "./render.ts";
import { write } from "./write.ts";

/**
 * Characters a folder name may not carry, because the name reaches the
 * launcher descriptor: `install` writes `path="<modDir>/<dirName>"`. A `"`
 * closes the value and a line break ends the line, so a folder name is a second
 * door into descriptor forgery. Every C0 control is refused with them — none
 * belongs in a folder name, and each does something different and equally
 * unwanted to a line-oriented format.
 */
const DIR_NAME_FORBIDDEN = /["\u0000-\u001f]/;

/**
 * A content folder name, checked before it is joined to the launcher's mod
 * directory.
 *
 * Two separate hazards, one gate. `install` replaces the directory it
 * computes, so this name decides what gets deleted: `""` resolves to the mod
 * directory itself, `".."` to its parent, and `"a/b"` to somewhere sideways —
 * each a recursive delete of a directory full of the user's other mods. And
 * the name is then written into the launcher descriptor verbatim, so it
 * decides what that file says. A single, plain path segment is the only thing
 * that is safe on both counts, so anything else is refused rather than
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
 * mod is was decided by `buildMod`; this only decides where it lands.
 *
 * The content directory is replaced, not merged into. Rendering happens first,
 * into memory, and the rendered files are staged into a sibling directory and
 * swapped in by rename. The old copy is only removed once a complete new one
 * is in place, and a failed swap puts the old one back. The descriptor is
 * written last, because it points at content.
 */
export async function install(mod: PureMod, options: InstallOptions = {}): Promise<InstallResult> {
  const root = options.modDir ?? modDir();
  const dirName = options.dirName ?? mod.config.prefix;
  assertInstallDirName(dirName, options.dirName === undefined);
  const contentDir = path.join(root, dirName);
  const descriptorPath = path.join(root, `${dirName}.mod`);

  // Before anything on disk changes: a throw here (a vanilla path collision or
  // malformed definition) must leave the existing install untouched.
  const files = render(mod);

  await mkdir(root, { recursive: true });
  // The leading dot keeps a crash-orphaned staging directory out of the
  // launcher's way. Fixed-size names avoid overflowing the filesystem's
  // component limit when dirName itself is long; the UUID keeps concurrent
  // installs from staging over one another.
  const staging = path.join(root, `.pdx-staging-${randomUUID()}`);
  const previous = path.join(root, `.pdx-previous-${randomUUID()}`);
  try {
    await write(staging, files);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  // Move any existing install aside, put the new one in its place, and only
  // then delete the old copy. Every step is a rename within one directory.
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
