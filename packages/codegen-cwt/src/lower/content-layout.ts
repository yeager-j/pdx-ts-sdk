/**
 * The file layout a registry's CWT type declares: which extension its files
 * carry and how deep inside them its definitions sit.
 *
 * Both come off the type as the rules wrote them, so the answer is derived
 * rather than tabulated. It lives apart from the emitter that writes the
 * descriptor row because it is the one part of that row a test can measure
 * against a synthetic type.
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
 * Reads one registry's file layout off its type.
 *
 * `skip_root_key`'s block form is a descent *path*, not a set of alternative
 * keys: `swapped_job` declares `{ any swappable_data }`, meaning any job id at
 * the first level and that job's `swappable_data` block at the second, with the
 * swap definitions inside it. Only a path of exactly one concrete segment names
 * a file-level envelope, because only then is the wrapper something the fold can
 * write.
 *
 * Everything else throws rather than resolving to something. A lone `any` says
 * the wrapper is whatever key happens to be there, and a deeper path says the
 * definitions sit inside another definition — neither is a block the fold could
 * put around a whole emitted file. A manifest row in either shape needs an
 * overlay decision.
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
