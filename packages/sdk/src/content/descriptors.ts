/**
 * The generated registry descriptors, indexed once.
 *
 * Three callers need a descriptor by registry name — the fold, the capability's
 * placement check, and the content authoring registrar — and the one fact they
 * all read off it is data the generator owns (`mintHead`, the output directory,
 * the file stem). Indexing it here rather than in each of them keeps "what does
 * this registry's descriptor say" a single lookup, and keeps the answer the
 * same in all three: a build that resolved a registry one way and reported
 * ownership another would be exactly the disagreement this avoids.
 */

import { CONTENT_REGISTRIES } from "../generated/content-registry.ts";
import type { ContentRegistryDescriptor } from "./schema.ts";

const BY_TYPE: ReadonlyMap<string, ContentRegistryDescriptor> = new Map(
  CONTENT_REGISTRIES.map((descriptor) => [descriptor.type as string, descriptor])
);

/** The descriptor for one registry, or `undefined` if the SDK has no such registry. */
export function contentDescriptor(type: string): ContentRegistryDescriptor | undefined {
  return BY_TYPE.get(type);
}

/**
 * The literal an own definition's name carries before the mod prefix — `"GFX_"`
 * for sprites, `""` for every registry that mints `${prefix}_...` outright.
 *
 * An unknown registry answers `""` rather than throwing: callers reach here to
 * *build* an ownership message, and the caller that can tell an unknown
 * registry apart already refuses it with a better error than this could.
 */
export function mintHeadOf(type: string): string {
  return BY_TYPE.get(type)?.mintHead ?? "";
}

/**
 * Whether this registry's own names may carry the mod prefix as any
 * `_`-delimited segment (`ContentRegistryDescriptor.exactNames`) rather than
 * only as their head. An unknown registry answers `false` for the same reason
 * `mintHeadOf` answers `""`.
 */
export function acceptsExactNames(type: string): boolean {
  return BY_TYPE.get(type)?.exactNames === true;
}
