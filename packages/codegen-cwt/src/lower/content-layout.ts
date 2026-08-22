/**
 * Derives a registry's file extension and root envelope from its CWT type.
 * This keeps file layout policy independent from descriptor rendering.
 */

import type { ContentType } from "../cwt/rules.ts";

/** The layout half of one generated `ContentRegistryDescriptor` row. */
export interface ContentFileLayout {
  /** `path_extension`, dotted, resolved — `.txt` is the game's default. */
  readonly fileExtension: string;
  /** The one concrete `skip_root_key` segment, when the type declares exactly one. */
  readonly rootEnvelope?: string;
}

/**
 * Resolves the file extension and optional root envelope declared by a registry's CWT type.
 * It defaults to `.txt` and throws when `skip_root_key` does not name one concrete,
 * file-level envelope.
 */
export function contentFileLayout(registry: string, type: ContentType): ContentFileLayout {
  const fileExtension = type.pathExtension ?? ".txt";
  const skipRootKeys = type.skipRootKeys ?? [];
  if (skipRootKeys.length === 0) {
    return { fileExtension };
  }
  const envelope = skipRootKeys.length === 1 ? skipRootKeys[0]! : undefined;
  if (envelope === undefined || envelope === "any") {
    throw new Error(
      `type[${registry}] declares skip_root_key ${skipRootKeys.join("/")}, a descent path that ` +
        "names no single concrete root block, so the emitted file has no one envelope to sit " +
        "inside. Decide the envelope in the overlay before manifesting this registry."
    );
  }
  return { fileExtension, rootEnvelope: envelope };
}
