import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { MaterializationError, type MaterializationDriftKind } from "../errors.ts";
import { modDir } from "../stellaris/launcher/mod-directory.ts";
import { issueReceipt, type DescriptorSnapshot } from "./receipt.ts";
import { renderLauncherDescriptor } from "./render.ts";
import type { RenderedMod } from "./rendered.ts";
import {
  activateMaterialization,
  descriptorRecord,
  discardPrevious,
  discardStaging,
  installedDescriptorRecord,
  observeDescriptor,
  rollbackMaterialization,
  stageMaterialization,
  withMaterializationLock,
  type LauncherDescriptorRecord,
  type StagedMaterialization,
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
  return withMaterializationLock(contentDir, () =>
    installUnlocked(rendered, contentDir, descriptorPath, descriptorContents, nextDescriptor)
  );
}

async function installUnlocked(
  rendered: RenderedMod,
  contentDir: string,
  descriptorPath: string,
  descriptorContents: string,
  nextDescriptor: LauncherDescriptorRecord
): Promise<InstallResult> {
  const root = path.dirname(contentDir);
  // Observed before staging, so a drift refusal from either half of the
  // install carries one receipt covering content and descriptor together.
  const descriptor = await observeDescriptor(descriptorPath);
  const staged = await stageMaterialization(
    contentDir,
    rendered,
    "install",
    nextDescriptor,
    descriptor
  );
  try {
    await validateCurrentDescriptor(contentDir, descriptorPath, staged, descriptor);
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

/**
 * The launcher descriptor is the second half of an installed materialization,
 * so the same ownership rules cover it: it may only exist beside owned
 * content, and it drifts on the content directory's own receipt.
 */
async function validateCurrentDescriptor(
  contentDir: string,
  descriptorPath: string,
  staged: StagedMaterialization,
  descriptor: DescriptorSnapshot
): Promise<void> {
  const basename = path.basename(descriptorPath);
  if (!staged.hadOwnedPrevious) {
    if (descriptor.state !== "absent") {
      throw new MaterializationError(contentDir, {
        reason: "unowned",
        detail: `Refusing to install over ${descriptorPath}: it exists without an owned content materialization.`,
      });
    }
    return;
  }

  if (descriptor.state === "absent") {
    throw descriptorDrift(contentDir, staged, basename, "missing");
  }
  if (descriptor.state === "symlink") {
    throw descriptorDrift(contentDir, staged, basename, "symlink");
  }
  if (descriptor.state === "other") {
    throw descriptorDrift(contentDir, staged, basename, "type-changed");
  }

  const expected = await installedDescriptorRecord(contentDir);
  if (
    expected === undefined ||
    expected.basename !== descriptor.basename ||
    expected.byteLength !== descriptor.byteLength ||
    expected.sha256 !== descriptor.sha256
  ) {
    throw descriptorDrift(contentDir, staged, basename, "modified");
  }
}

function descriptorDrift(
  contentDir: string,
  staged: StagedMaterialization,
  basename: string,
  kind: MaterializationDriftKind
): MaterializationError {
  return new MaterializationError(contentDir, {
    reason: "drift",
    drift: [{ path: basename, kind }],
    receipt: issueReceipt(contentDir, staged.mode, staged.prefix, staged.snapshot),
  });
}
