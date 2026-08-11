import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { MaterializationDriftError, UnownedMaterializationError } from "../errors.ts";
import { modDir } from "../stellaris/launcher/mod-directory.ts";
import { renderLauncherDescriptor } from "./render.ts";
import type { RenderedMod } from "./rendered.ts";
import {
  activateMaterialization,
  descriptorRecord,
  discardPrevious,
  discardStaging,
  installedDescriptorRecord,
  rollbackMaterialization,
  stageMaterialization,
  type LauncherDescriptorRecord,
} from "./write.ts";

const DIR_NAME_FORBIDDEN = /["\u0000-\u001f]/;

function assertInstallDirName(dirName: string): void {
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
      `Install folder ${JSON.stringify(dirName)} must be one plain path segment, not an absolute, nested, or dot path.`
    );
  }
  if (DIR_NAME_FORBIDDEN.test(dirName)) {
    throw new Error(
      `Install folder ${JSON.stringify(dirName)} cannot contain a quote or control character because the launcher descriptor cannot encode it.`
    );
  }
}

export interface InstallOptions {
  /** The launcher's mod directory. Defaults to `stellaris.modDir()`. */
  readonly modDir?: string;
  /** The content folder's name inside it. Defaults to the rendered mod's prefix. */
  readonly dirName?: string;
}

export interface InstallResult {
  readonly contentDir: string;
  readonly descriptorPath: string;
}

/** Activate one rendered snapshot as launcher content and descriptor together. */
export async function install(
  rendered: RenderedMod,
  options: InstallOptions = {}
): Promise<InstallResult> {
  const root = path.resolve(options.modDir ?? modDir());
  const dirName = options.dirName ?? rendered.prefix;
  assertInstallDirName(dirName);
  const contentDir = path.join(root, dirName);
  const descriptorPath = path.join(root, `${dirName}.mod`);
  const descriptorContents = renderLauncherDescriptor(rendered, contentDir);
  const nextDescriptor = descriptorRecord(path.basename(descriptorPath), descriptorContents);

  await mkdir(root, { recursive: true });
  const staged = await stageMaterialization(contentDir, rendered, "install", nextDescriptor);
  try {
    await validateCurrentDescriptor(contentDir, descriptorPath, staged.hadOwnedPrevious);
  } catch (error) {
    await discardStaging(staged);
    throw error;
  }

  const descriptorStaging = path.join(root, `.pdx-descriptor-staging-${randomUUID()}`);
  const descriptorPrevious = path.join(root, `.pdx-descriptor-previous-${randomUUID()}`);
  try {
    await writeFile(descriptorStaging, descriptorContents, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await discardStaging(staged);
    throw error;
  }

  try {
    await activateMaterialization(staged);
  } catch (error) {
    await rm(descriptorStaging, { force: true });
    throw error;
  }
  let descriptorMovedAside = false;
  try {
    if (staged.hadOwnedPrevious) {
      await rename(descriptorPath, descriptorPrevious);
      descriptorMovedAside = true;
    }
    await rename(descriptorStaging, descriptorPath);
  } catch (error) {
    if (descriptorMovedAside) {
      await rename(descriptorPrevious, descriptorPath);
    }
    await rm(descriptorStaging, { force: true });
    await rollbackMaterialization(staged);
    throw error;
  }

  await discardPrevious(staged);
  if (descriptorMovedAside) {
    await rm(descriptorPrevious, { force: true });
  }
  return { contentDir, descriptorPath };
}

async function validateCurrentDescriptor(
  contentDir: string,
  descriptorPath: string,
  hadPrevious: boolean
): Promise<void> {
  const stats = await lstatOrUndefined(descriptorPath);
  if (!hadPrevious) {
    if (stats !== undefined) {
      throw new UnownedMaterializationError(
        `Refusing to install over ${descriptorPath}: it exists without an owned content materialization.`
      );
    }
    return;
  }

  if (stats === undefined) {
    throw new MaterializationDriftError(contentDir, [
      { path: path.basename(descriptorPath), kind: "missing" },
    ]);
  }
  if (stats.isSymbolicLink()) {
    throw new MaterializationDriftError(contentDir, [
      { path: path.basename(descriptorPath), kind: "symlink" },
    ]);
  }
  if (!stats.isFile()) {
    throw new MaterializationDriftError(contentDir, [
      { path: path.basename(descriptorPath), kind: "type-changed" },
    ]);
  }

  const expected = await installedDescriptorRecord(contentDir);
  if (
    expected === undefined ||
    expected.basename !== path.basename(descriptorPath) ||
    !(await descriptorMatches(descriptorPath, expected))
  ) {
    throw new MaterializationDriftError(contentDir, [
      { path: path.basename(descriptorPath), kind: "modified" },
    ]);
  }
}

async function descriptorMatches(
  descriptorPath: string,
  expected: LauncherDescriptorRecord
): Promise<boolean> {
  const bytes = await readFile(descriptorPath);
  return (
    bytes.byteLength === expected.byteLength &&
    createHash("sha256").update(bytes).digest("hex") === expected.sha256
  );
}

async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
