/**
 * The file layout a registry's CWT type declares: which extension its files
 * carry and which block, if any, its definitions sit inside.
 *
 * Both come off the type as the rules wrote them, so the answer is derived
 * rather than tabulated. It lives apart from the emitter that writes the
 * descriptor row because it is the one part of that row a test can measure
 * against a synthetic type.
 */

import type { ContentType } from "./cwt/rules.ts";

/** The layout half of one generated `ContentRegistryDescriptor` row. */
export interface ContentFileLayout {
  /** `path_extension`, dotted, resolved — `.txt` is the game's default. */
  readonly fileExtension: string;
  /** The single concrete `skip_root_key`, when the type declares exactly one. */
  readonly rootEnvelope?: string;
}

/**
 * Reads one registry's file layout off its type.
 *
 * A `skip_root_key` that is not exactly one concrete key throws rather than
 * resolving to something: `any` says every top-level block is an envelope and
 * several keys say the file has more than one, and neither shape tells the fold
 * which block to write. A manifest row in that shape needs an overlay decision.
 */
export function contentFileLayout(registry: string, type: ContentType): ContentFileLayout {
  const fileExtension = type.pathExtension ?? ".txt";
  const skipRootKeys = type.skipRootKeys ?? [];
  if (skipRootKeys.length === 0) {
    return { fileExtension };
  }
  const concrete = skipRootKeys.filter((key) => key !== "any");
  if (concrete.length !== 1) {
    throw new Error(
      `type[${registry}] declares skip_root_key ${skipRootKeys.join(", ")}, which names no single ` +
        "concrete root block, so the emitted file has no one envelope to sit inside. Decide the " +
        "envelope in the overlay before manifesting this registry."
    );
  }
  return { fileExtension, rootEnvelope: concrete[0]! };
}
