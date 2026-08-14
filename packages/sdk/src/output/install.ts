import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { MaterializationError, type MaterializationDriftKind } from "../errors.ts";
import { modDir } from "../stellaris/launcher/mod-directory.ts";
import {
  issueReceipt,
  openReceipt,
  type DescriptorSnapshot,
  type MaterializationReceipt,
  type OpenedReceipt,
} from "./receipt.ts";
import { renderLauncherDescriptor } from "./render.ts";
import type { RenderedMod } from "./rendered.ts";
import {
  activateMaterialization,
  descriptorRecord,
  discardLeftover,
  discardPrevious,
  discardStaging,
  freezeReport,
  MATERIALIZATION_MANIFEST,
  observeDescriptor,
  ownedSetMatches,
  reportForeign,
  rollbackMaterialization,
  stageMaterialization,
  validateExistingMaterialization,
  withMaterializationLock,
  type CleanupWarning,
  type InstallReport,
  type LauncherDescriptorRecord,
  type MaterializationInspection,
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

/** Activate one rendered snapshot as launcher content and descriptor together. */
export async function install(
  rendered: RenderedMod,
  options: InstallOptions = {}
): Promise<InstallReport> {
  return installWith(rendered, options, undefined);
}

/**
 * `install`, plus the authority to replace owned entries that drifted, on
 * either half — content or launcher descriptor.
 *
 * The receipt converts a drift refusal and nothing else, so a receipt that
 * does not describe the state found now, or a target that never drifted,
 * waives nothing and this is `install`. Kept a separate entry point rather
 * than an `install` option all the same: replacing a reviewed drift is a
 * deliberate act, and must never ride inside an ordinary install.
 */
export async function replaceInstallation(
  rendered: RenderedMod,
  receipt: MaterializationReceipt,
  options: InstallOptions = {}
): Promise<InstallReport> {
  return installWith(rendered, options, openReceipt(receipt));
}

async function installWith(
  rendered: RenderedMod,
  options: InstallOptions,
  receipt: OpenedReceipt | undefined
): Promise<InstallReport> {
  const root = path.resolve(options.modDir ?? modDir());
  const dirName = options.dirName ?? rendered.prefix;
  assertInstallDirName(dirName);
  const contentDir = path.join(root, dirName);
  const descriptorPath = path.join(root, `${dirName}.mod`);
  const descriptorContents = renderLauncherDescriptor(rendered, contentDir);
  const nextDescriptor = descriptorRecord(path.basename(descriptorPath), descriptorContents);

  await mkdir(root, { recursive: true });
  return withMaterializationLock(contentDir, () =>
    installUnlocked(
      rendered,
      contentDir,
      descriptorPath,
      descriptorContents,
      nextDescriptor,
      receipt
    )
  );
}

async function installUnlocked(
  rendered: RenderedMod,
  contentDir: string,
  descriptorPath: string,
  descriptorContents: string,
  nextDescriptor: LauncherDescriptorRecord,
  receipt: OpenedReceipt | undefined
): Promise<InstallReport> {
  const root = path.dirname(contentDir);
  // Observed before staging, so a drift refusal from either half of the
  // install carries one receipt covering content and descriptor together.
  const descriptor = await observeDescriptor(descriptorPath);
  const inspection = await validateExistingMaterialization(contentDir, rendered, "install", {
    descriptor,
    receipt,
  });
  validateCurrentDescriptor(contentDir, descriptorPath, rendered, inspection, descriptor);

  const common = {
    contentDir,
    descriptorPath,
    manifestPath: path.join(contentDir, MATERIALIZATION_MANIFEST),
    foreignEntries: reportForeign(inspection.foreign),
  };
  if (
    ownedSetMatches(inspection, rendered) &&
    sameDescriptor(inspection.manifest?.launcherDescriptor, nextDescriptor) &&
    descriptor.state === "file" &&
    sameDescriptor(descriptor, nextDescriptor)
  ) {
    return freezeReport({ status: "unchanged", ...common, warnings: [] });
  }

  const staged = await stageMaterialization(contentDir, rendered, "install", inspection, {
    launcherDescriptor: nextDescriptor,
  });
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
    // What is on disk, not what ownership implies: a replayed receipt can waive
    // a descriptor that drifted to absent, and there is then nothing to move.
    if (descriptor.state !== "absent") {
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

  const warnings: CleanupWarning[] = [...(await discardPrevious(staged))];
  if (descriptorMovedAside) {
    warnings.push(...(await discardLeftover(descriptorPrevious)));
  }
  return freezeReport({ status: "written", ...common, warnings });
}

/**
 * The launcher descriptor is the second half of an installed materialization,
 * so the same ownership rules cover it: it may only exist beside owned
 * content, and it drifts on the content directory's own receipt — which is
 * what a replay receipt covering that state waives.
 *
 * One state is beyond a receipt's authority. `absent`, `symlink` and `file`
 * are each one reviewable thing: the receipt digests the file's bytes, and a
 * moved-aside symlink is removed as a link, never as its referent. `other` is
 * a directory or a device the snapshot reduces to the word "other", so no
 * receipt can be evidence about what is inside it — and replacing it means
 * renaming it aside and deleting it whole. The author removes it by hand; the
 * SDK does not delete a subtree nobody reviewed.
 */
function validateCurrentDescriptor(
  contentDir: string,
  descriptorPath: string,
  rendered: RenderedMod,
  inspection: MaterializationInspection,
  descriptor: DescriptorSnapshot
): void {
  const basename = path.basename(descriptorPath);
  if (inspection.kind !== "owned") {
    if (descriptor.state !== "absent") {
      throw new MaterializationError(contentDir, {
        reason: "unowned",
        detail: `Refusing to install over ${descriptorPath}: it exists without an owned content materialization.`,
      });
    }
    return;
  }
  if (descriptor.state === "other") {
    throw descriptorDrift(contentDir, rendered, inspection, basename, "type-changed");
  }
  if (inspection.receiptAccepted) {
    return;
  }

  if (descriptor.state === "absent") {
    throw descriptorDrift(contentDir, rendered, inspection, basename, "missing");
  }
  if (descriptor.state === "symlink") {
    throw descriptorDrift(contentDir, rendered, inspection, basename, "symlink");
  }
  if (!sameDescriptor(inspection.manifest?.launcherDescriptor, descriptor)) {
    throw descriptorDrift(contentDir, rendered, inspection, basename, "modified");
  }
}

function sameDescriptor(
  left: LauncherDescriptorRecord | undefined,
  right: LauncherDescriptorRecord
): boolean {
  return (
    left !== undefined &&
    left.basename === right.basename &&
    left.byteLength === right.byteLength &&
    left.sha256 === right.sha256
  );
}

function descriptorDrift(
  contentDir: string,
  rendered: RenderedMod,
  inspection: MaterializationInspection,
  basename: string,
  kind: MaterializationDriftKind
): MaterializationError {
  return new MaterializationError(contentDir, {
    reason: "drift",
    drift: [{ path: basename, kind }],
    receipt: issueReceipt(contentDir, "install", rendered.prefix, inspection.snapshot),
  });
}
