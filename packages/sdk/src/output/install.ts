import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { MATERIALIZATION_MANIFEST_PATH } from "../compiler/paths.ts";
import { MaterializationError, type MaterializationDriftKind } from "../errors.ts";
import { modDir } from "../installation/launcher/mod-directory.ts";
import {
  canonicalTarget,
  installPaths,
  journaledSiblings,
  nearestPhysicalForm,
  type InstallPaths,
} from "./layout.ts";
import type { LauncherDescriptorRecord } from "./manifest.ts";
import { assertRepresentableMaterialization } from "./preflight.ts";
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
  _materializationTestPoint,
  RENAME_DESCRIPTOR_ACTIVATE,
  RENAME_DESCRIPTOR_DEACTIVATE,
} from "./test-hooks.ts";
import { acquireTransaction, type MaterializationTransaction } from "./transaction.ts";
import {
  activateMaterialization,
  descriptorRecord,
  discardLeftover,
  discardPrevious,
  discardStaging,
  disposeAfterFailure,
  freezeReport,
  observeDescriptor,
  ownedSetMatches,
  reportForeign,
  rollbackMaterialization,
  stageMaterialization,
  validateExistingMaterialization,
  withMaterializationLocks,
  type CleanupWarning,
  type InstallReport,
  type MaterializationInspection,
} from "./write.ts";

const DIR_NAME_FORBIDDEN = /["\u0000-\u001f]/;

export function assertInstallDirName(dirName: string): void {
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
  const requested = path.resolve(options.modDir ?? modDir());
  const dirName = options.dirName ?? rendered.prefix;
  assertInstallDirName(dirName);
  // Checked against the path the caller named, before anything is created:
  // a mod directory the descriptor format cannot encode must refuse without
  // making the directory it refused to install into.
  renderLauncherDescriptor(rendered, path.join(requested, dirName));
  // And representability before the mod directory is created, for the same
  // reason: a refusal must not leave the directory chain it refused to fill.
  const lexical = await nearestPhysicalForm(path.join(requested, dirName));
  assertRepresentableMaterialization(
    lexical,
    rendered,
    path.join(path.dirname(lexical), `${dirName}.mod`)
  );

  const contentDir = await canonicalTarget(path.join(requested, dirName));
  const root = path.dirname(contentDir);
  const descriptorPath = path.join(root, `${dirName}.mod`);
  const descriptorContents = renderLauncherDescriptor(rendered, contentDir);
  const nextDescriptor = descriptorRecord(path.basename(descriptorPath), descriptorContents);
  assertRepresentableMaterialization(contentDir, rendered, descriptorPath);

  return withMaterializationLocks([contentDir, descriptorPath], async () => {
    const transaction = await acquireTransaction({
      target: contentDir,
      mode: "install",
      prefix: rendered.prefix,
      renderedSha256: rendered.sha256,
      descriptor: {
        path: descriptorPath,
        sha256: nextDescriptor.sha256,
        byteLength: nextDescriptor.byteLength,
      },
    });
    return installUnlocked(
      rendered,
      contentDir,
      descriptorPath,
      descriptorContents,
      nextDescriptor,
      receipt,
      transaction
    );
  });
}

async function installUnlocked(
  rendered: RenderedMod,
  contentDir: string,
  descriptorPath: string,
  descriptorContents: string,
  nextDescriptor: LauncherDescriptorRecord,
  receipt: OpenedReceipt | undefined,
  transaction: MaterializationTransaction
): Promise<InstallReport> {
  const paths = installPaths(contentDir);
  try {
    return await installJournaled(
      rendered,
      contentDir,
      descriptorPath,
      descriptorContents,
      nextDescriptor,
      receipt,
      transaction,
      paths
    );
  } catch (error) {
    await disposeAfterFailure(transaction, journaledSiblings(paths), error);
    throw error;
  }
}

async function installJournaled(
  rendered: RenderedMod,
  contentDir: string,
  descriptorPath: string,
  descriptorContents: string,
  nextDescriptor: LauncherDescriptorRecord,
  receipt: OpenedReceipt | undefined,
  transaction: MaterializationTransaction,
  paths: InstallPaths
): Promise<InstallReport> {
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
    manifestPath: path.join(contentDir, MATERIALIZATION_MANIFEST_PATH),
    foreignEntries: reportForeign(inspection.foreign),
  };
  if (
    ownedSetMatches(inspection, rendered) &&
    sameDescriptor(inspection.manifest?.launcherDescriptor, nextDescriptor) &&
    descriptor.state === "file" &&
    sameDescriptor(descriptor, nextDescriptor)
  ) {
    await transaction.releaseClean();
    return freezeReport({ status: "unchanged", ...common, warnings: [] });
  }

  const { descriptorStaging, descriptorPrevious } = paths;
  await transaction.journalStaging({
    ...paths,
    hadPrevious: inspection.kind !== "absent",
    ...(inspection.manifest === undefined
      ? {}
      : { previousManifestSha256: inspection.manifest.sha256 }),
    descriptorObserved: descriptor,
  });
  const staged = await stageMaterialization(contentDir, rendered, "install", inspection, {
    launcherDescriptor: nextDescriptor,
    paths,
  });
  try {
    await writeFile(descriptorStaging, descriptorContents, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await discardStaging(staged);
    throw error;
  }
  await transaction.record("staged");

  try {
    await activateMaterialization(staged, transaction);
  } catch (error) {
    await rm(descriptorStaging, { force: true });
    throw error;
  }
  let descriptorMovedAside = false;
  try {
    // What is on disk, not what ownership implies: a replayed receipt can waive
    // a descriptor that drifted to absent, and there is then nothing to move.
    if (descriptor.state !== "absent") {
      await transaction.record("descriptor-deactivating");
      await rename(descriptorPath, descriptorPrevious);
      descriptorMovedAside = true;
      await _materializationTestPoint(RENAME_DESCRIPTOR_DEACTIVATE);
    }
    await transaction.record("descriptor-activating");
    await rename(descriptorStaging, descriptorPath);
    await _materializationTestPoint(RENAME_DESCRIPTOR_ACTIVATE);
  } catch (error) {
    await transaction.record("rolling-back");
    if (descriptorMovedAside) {
      await rename(descriptorPrevious, descriptorPath);
    }
    await rm(descriptorStaging, { force: true });
    await rollbackMaterialization(staged);
    await transaction.record("rolled-back");
    throw error;
  }
  // Both renames landed: the install is published, and everything after this
  // is cleanup that a warning reports rather than a failure that undoes it.
  await transaction.record("committed");

  const warnings: CleanupWarning[] = [...(await discardPrevious(staged))];
  if (descriptorMovedAside) {
    warnings.push(...(await discardLeftover(descriptorPrevious)));
  }
  await transaction.record("done");
  await transaction.releaseClean();
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
