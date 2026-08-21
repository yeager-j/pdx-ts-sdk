/**
 * The filesystem shell: check the target is safe to write into, then write.
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { ProjectPlan } from "./plan.ts";

/**
 * Refuse a target that already exists.
 *
 * The tempting version of this tolerates "harmless" leftovers — a `.git`, a
 * README, a `.gitignore` — so you can scaffold into a freshly initialized
 * repository. That is exactly where it goes wrong: the scaffold *writes* a
 * README and a `.gitignore`, so the files it waves through are the ones it
 * then destroys, and silently.
 *
 * Refusing outright is the standard behavior and needs no list to keep correct.
 * A new directory is the only thing that cannot be somebody's work.
 */
export async function preflight(targetDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return; // Does not exist, which is the only safe case.
  }
  const summary =
    entries.length === 0
      ? "it already exists"
      : `it already exists and holds ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
  throw new Error(
    `Cannot scaffold into ${targetDir}: ${summary}.\n` +
      `Pick a path that does not exist yet — the scaffold writes a README, a .gitignore ` +
      `and a src/ tree, and will not overwrite anything to do it.`
  );
}

export async function writeTree(targetDir: string, entries: ProjectPlan): Promise<void> {
  const target = path.resolve(targetDir);
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.create-stellaris-mod-${randomUUID()}`);
  try {
    await mkdir(staging);
    for (const [relPath, entry] of entries) {
      const stagedEntry = path.join(staging, relPath);
      await mkdir(path.dirname(stagedEntry), { recursive: true });
      if (entry.kind === "file") {
        await writeFile(stagedEntry, entry.contents, "utf8");
      } else {
        await materializeLink(staging, stagedEntry, entry.target);
      }
    }
    try {
      await lstat(target);
      throw new Error(`Cannot scaffold into ${target}: it appeared while the project was staged.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function materializeLink(staging: string, stagedLink: string, target: string): Promise<void> {
  if (path.isAbsolute(target)) {
    throw new Error(`Refusing absolute symlink target ${JSON.stringify(target)}.`);
  }
  const destination = path.resolve(path.dirname(stagedLink), target);
  const relative = path.relative(staging, destination);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing project-escaping symlink target ${JSON.stringify(target)}.`);
  }
  const targetStat = await lstat(destination);
  const linkType = targetStat.isDirectory() ? "dir" : "file";
  try {
    await symlink(target, stagedLink, linkType);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") {
      throw error;
    }
    if (targetStat.isDirectory()) {
      await cp(destination, stagedLink, { recursive: true, errorOnExist: true, force: false });
    } else if (targetStat.isFile()) {
      await copyFile(destination, stagedLink, constants.COPYFILE_EXCL);
    } else {
      throw error;
    }
  }
}
