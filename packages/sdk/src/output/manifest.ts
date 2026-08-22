/**
 * The ownership manifest: the file that says a tree is the SDK's to replace.
 *
 * It is read at two moments that must agree. A writer reads it to decide
 * whether the target is an SDK output at all, and recovery reads it to decide
 * whether the tree in front of it is the one an interrupted transaction
 * staged. Both are about to delete something, so decoding is closed: a
 * manifest that is not exactly the shape this build writes is reported as the
 * defect it is, never read as "nothing there".
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { MATERIALIZATION_MANIFEST_PATH } from "../compiler/paths.ts";
import type { MaterializationMode } from "./write.ts";

/** The manifest format this build writes, and the only one it reads back. */
export const MANIFEST_VERSION = 1;

/** The launcher descriptor an installed materialization also owns. */
export interface LauncherDescriptorRecord {
  readonly basename: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface MaterializationManifest {
  readonly version: 1;
  readonly prefix: string;
  readonly mode: MaterializationMode;
  readonly sha256: string;
  readonly files: readonly {
    readonly path: string;
    readonly byteLength: number;
    readonly sha256: string;
  }[];
  readonly launcherDescriptor?: LauncherDescriptorRecord;
}

/** Why a text is not a manifest, phrased to sit inside a refusal message. */
export interface ManifestProblem {
  readonly problem: string;
}

/** The manifest file's contents, as the SDK writes them. */
export function encodeManifest(manifest: MaterializationManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Read a manifest file's text back, or say what is wrong with it.
 *
 * @returns The manifest, or the one defect that stopped it being one.
 */
export function decodeManifest(text: string): MaterializationManifest | ManifestProblem {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      problem: `it is not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { problem: `it is ${describe(parsed)} rather than an object` };
  }
  const fields = parsed as Record<string, unknown>;
  if (fields["version"] !== MANIFEST_VERSION) {
    return {
      problem: `its "version" is not ${MANIFEST_VERSION} (${describe(fields["version"])})`,
    };
  }
  if (typeof fields["prefix"] !== "string") {
    return { problem: `it has no string "prefix" (${describe(fields["prefix"])})` };
  }
  if (fields["mode"] !== "build" && fields["mode"] !== "install") {
    return {
      problem: `its "mode" is neither "build" nor "install" (${describe(fields["mode"])})`,
    };
  }
  if (typeof fields["sha256"] !== "string") {
    return { problem: `it has no string "sha256" (${describe(fields["sha256"])})` };
  }
  const files = fields["files"];
  if (!Array.isArray(files)) {
    return { problem: `it has no "files" array (${describe(files)})` };
  }
  const badFile = files.findIndex((file) => !isFileRecord(file));
  if (badFile !== -1) {
    return {
      problem: `its "files[${badFile}]" has no string "path", number "byteLength" and string "sha256"`,
    };
  }
  const descriptor = fields["launcherDescriptor"];
  if (descriptor !== undefined && !isDescriptorRecord(descriptor)) {
    return {
      problem: `its "launcherDescriptor" has no string "basename", number "byteLength" and string "sha256"`,
    };
  }
  return parsed as MaterializationManifest;
}

/** One target's ownership manifest as it is on disk right now. */
export type OwnershipManifestRead =
  | { readonly state: "absent" }
  /** Present, and not a manifest this build can act on. */
  | { readonly state: "unreadable"; readonly problem: string }
  | { readonly state: "manifest"; readonly manifest: MaterializationManifest };

/**
 * Read the ownership manifest of the tree at `dir`.
 *
 * A target with no manifest is `absent`, which is an ordinary answer: an
 * unmaterialized target has none. Everything else that stops the manifest
 * being read — the wrong shape, a directory in its place, a permission the
 * caller does not have — is `unreadable`, because a caller about to delete a
 * tree must be able to tell "nothing claims this" from "the claim could not be
 * read".
 */
export async function readOwnershipManifest(dir: string): Promise<OwnershipManifestRead> {
  let text: string;
  try {
    text = await readFile(path.join(dir, MATERIALIZATION_MANIFEST_PATH), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { state: "absent" };
    }
    return { state: "unreadable", problem: `it could not be read (${code ?? String(error)})` };
  }
  const decoded = decodeManifest(text);
  return "problem" in decoded
    ? { state: "unreadable", problem: decoded.problem }
    : { state: "manifest", manifest: decoded };
}

function isFileRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const file = value as Record<string, unknown>;
  return (
    typeof file["path"] === "string" &&
    typeof file["byteLength"] === "number" &&
    typeof file["sha256"] === "string"
  );
}

function isDescriptorRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["basename"] === "string" &&
    typeof record["byteLength"] === "number" &&
    typeof record["sha256"] === "string"
  );
}

/** A rejected value, short enough to sit inside a one-line message. */
function describe(value: unknown): string {
  const rendered = value === undefined ? "undefined" : JSON.stringify(value);
  return rendered.length > 40 ? `${rendered.slice(0, 39)}…` : rendered;
}
