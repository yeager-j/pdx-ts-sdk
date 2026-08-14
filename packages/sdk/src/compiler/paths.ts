/**
 * The mod-root paths the SDK reserves for itself.
 *
 * Both are declared here rather than beside the code that writes them because
 * the fold has to know about them to adjudicate claims against them, and the
 * fold must never import `output/write.ts` — that would pull `node:fs/promises`
 * into the pure compile path.
 */

import { normalizeLogicalPath, type LogicalPath } from "../ordering.ts";

/** The descriptor inside the mod folder. The SDK claims it; nothing else may. */
export const DESCRIPTOR_PATH: LogicalPath = normalizeLogicalPath("descriptor.mod");

/**
 * The ownership manifest. Sink metadata rather than Rendered mod content, so it
 * is reserved without being claimed: no producer may occupy it, and the
 * materializer writes it after rendering is over.
 */
export const MATERIALIZATION_MANIFEST_PATH: LogicalPath =
  normalizeLogicalPath(".pdx-sdk-manifest.json");

/**
 * The two shared files no Feature owns a stem for: every on-action hook in the
 * mod lands in one file, and so does every ship-size-limit contribution. They
 * are minted here rather than at the point of serialization because the fold
 * has to know every path the build will occupy.
 */
export function onActionsPath(prefix: string): LogicalPath {
  return normalizeLogicalPath(`common/on_actions/${prefix}_on_actions.txt`);
}

export function shipOfSizeLimitsPath(prefix: string): LogicalPath {
  return normalizeLogicalPath(
    `common/country_limits/ownership_limits/${prefix}_ownership_limits.txt`
  );
}
