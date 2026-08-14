/**
 * Whether every path this materialization will need can exist at all.
 *
 * The check runs before the lock is created, so a target the platform cannot
 * represent refuses without leaving a lock file, a staging tree, or anything
 * else behind. It belongs here rather than in the inspection because an absent
 * target is inspected as "absent" and never measured, and a name that is too
 * long is exactly as unwritable when nothing is there yet.
 *
 * `normalizeLogicalPath` already rejects a rendered component that is invalid
 * on its own. What is left is what only the final absolute form can show: the
 * sibling names materialization derives from the target's basename, and the
 * whole path once the target root is joined to the longest rendered path.
 */

import path from "node:path";

import { MaterializationError } from "../errors.ts";
import type { RenderedMod } from "./rendered.ts";
import { LOCK_BASENAME_PREFIX } from "./transaction.ts";

/** The longest sibling basename materialization derives, `<prefix><uuid>`. */
const LONGEST_SIBLING_PREFIX = ".pdx-descriptor-previous-";
const UUID_LENGTH = 36;

/** POSIX `NAME_MAX` on every filesystem the SDK targets. */
const NAME_MAX_BYTES = 255;

const encoder = new TextEncoder();

/**
 * The longest absolute path each platform accepts. Node opens win32 paths
 * through the `\\?\` prefix, so the ceiling is the NT one rather than
 * `MAX_PATH` — a path over 260 units is writable, and may still be invisible
 * to tools that are not long-path aware, which is the author's call to make
 * and not a refusal the SDK invents.
 */
function pathCeiling(): { readonly limit: number; readonly unit: "utf16" | "utf8" } {
  if (process.platform === "win32") {
    return { limit: 32767, unit: "utf16" };
  }
  return { limit: process.platform === "darwin" ? 1024 : 4096, unit: "utf8" };
}

function measure(value: string, unit: "utf16" | "utf8"): number {
  return unit === "utf16" ? value.length : encoder.encode(value).length;
}

/**
 * Refuse a materialization whose paths cannot exist, before anything is
 * created. `descriptorPath` is the install half; a build has none.
 */
export function assertRepresentableMaterialization(
  target: string,
  rendered: RenderedMod,
  descriptorPath?: string
): void {
  const parent = path.dirname(target);
  const basenames = [
    path.basename(target),
    ...(descriptorPath === undefined ? [] : [path.basename(descriptorPath)]),
  ];
  const overlongLocks = basenames
    .map((basename) => LOCK_BASENAME_PREFIX + basename)
    .filter((name) => measure(name, "utf8") > NAME_MAX_BYTES);
  if (overlongLocks.length > 0) {
    throw unrepresentable(
      target,
      `the transaction lock beside it would need a ${measure(overlongLocks[0]!, "utf8")}-byte ` +
        `name, over the ${NAME_MAX_BYTES}-byte filesystem limit.`,
      overlongLocks.map((name) => path.join(parent, name))
    );
  }

  const { limit, unit } = pathCeiling();
  // Longest in the unit the ceiling is expressed in, which is not the same
  // ordering: 90 CJK characters are shorter than 100 ASCII ones in UTF-16 and
  // 170 bytes longer in UTF-8, so picking by `.length` on a POSIX host would
  // measure the wrong path and pass a materialization that cannot be written.
  const longestRendered = [...rendered.keys()].reduce(
    (longest, relPath) => (measure(relPath, unit) > measure(longest, unit) ? relPath : longest),
    ""
  );
  const staging = path.join(parent, LONGEST_SIBLING_PREFIX + "x".repeat(UUID_LENGTH));
  const candidates = [
    path.join(target, ...longestRendered.split("/")),
    path.join(staging, ...longestRendered.split("/")),
    ...(descriptorPath === undefined ? [] : [descriptorPath, staging]),
  ];
  const tooLong = candidates.filter((candidate) => measure(candidate, unit) > limit);
  if (tooLong.length > 0) {
    throw unrepresentable(
      target,
      `${tooLong.length} path${tooLong.length === 1 ? "" : "s"} it would have to create ` +
        `exceed${tooLong.length === 1 ? "s" : ""} this platform's ${limit}-` +
        `${unit === "utf16" ? "unit" : "byte"} path limit.`,
      tooLong
    );
  }
}

function unrepresentable(
  target: string,
  detail: string,
  paths: readonly string[]
): MaterializationError {
  return new MaterializationError(target, { reason: "unrepresentable", detail, paths });
}
