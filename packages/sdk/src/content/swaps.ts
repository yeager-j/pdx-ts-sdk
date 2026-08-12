/**
 * Where a definition declares *alternative* definitions of itself: a
 * technology's `technology_swap`, a tradition's swaps, a job's swap types.
 *
 * Nothing in the vendored rules marks a nested block as standing in for its
 * parent, so the rows below are reviewed data. Two sides of the SDK read them,
 * and they read the same rows through different vocabularies:
 *
 * - the fold reads *authored* objects, so it walks the camelCase member path
 *   ({@link SWAP_IDENTITIES}'s `path`);
 * - the vanilla parse layer reads *shipped* files, so it needs the PDXScript
 *   keys those members write. {@link parsedSwapDeclarations} derives them from
 *   the registry's own generated field descriptors rather than letting a
 *   second, hand-written spelling of the same nesting exist.
 */

import { CONTENT_REGISTRIES } from "../generated/content-registry.ts";
import { SWAP_IDENTITIES, type SwapIdentity } from "../generated/content-swaps.ts";
import type { ContentField } from "./schema.ts";

export { SWAP_IDENTITIES, type SwapIdentity };

/** One swap nesting, in the terms a parsed file is written in. */
export interface ParsedSwapDeclaration {
  /** The nested PDXScript keys from the definition body down to a swap block. */
  readonly keys: readonly string[];
  /**
   * The key inside that block naming the definition it stands in for, or
   * `null` when the block's own key is the name (a container-keyed repeated
   * struct, where the id *is* the nested block's key).
   */
  readonly nameKey: string | null;
}

/**
 * The swap nestings a parsed definition of this registry may carry, or an
 * empty list for a registry that declares none.
 *
 * Every part of a declaration is resolved from the descriptors — the block
 * keys, and the key naming the swap — so a rules change that renames either
 * moves this with it.
 */
export function parsedSwapDeclarations(registry: string): readonly ParsedSwapDeclaration[] {
  const descriptor = CONTENT_REGISTRIES.find((candidate) => candidate.type === registry);
  if (descriptor === undefined) {
    return [];
  }
  return SWAP_IDENTITIES.filter((row) => row.registryType === registry).map((row) =>
    resolveDeclaration(row, descriptor.fields)
  );
}

function resolveDeclaration(
  row: SwapIdentity,
  fields: readonly ContentField[]
): ParsedSwapDeclaration {
  const keys: string[] = [];
  let level = fields;
  let field: ContentField | undefined;
  for (const member of row.path) {
    field = level.find((candidate) => candidate.member === member);
    if (field === undefined || !("key" in field) || !("fields" in field)) {
      throw new Error(
        `SWAP_IDENTITIES row ${row.registryType}.${row.path.join(".")} names "${member}", which ` +
          `is not a nested block member of ${row.registryType} — the row and the generated ` +
          "field descriptors disagree about where the swaps live"
      );
    }
    keys.push(field.key);
    level = field.fields;
  }
  return { keys, nameKey: resolveNameKey(row, field!, level) };
}

function resolveNameKey(
  row: SwapIdentity,
  field: ContentField,
  nested: readonly ContentField[]
): string | null {
  if (row.keying === "array-names") {
    const name = nested.find((candidate) => candidate.member === "name");
    if (name === undefined || !("key" in name)) {
      throw new Error(
        `SWAP_IDENTITIES row ${row.registryType}.${row.path.join(".")} is keyed by swap names, ` +
          "but the nested block has no `name` member to read them from"
      );
    }
    return name.key;
  }
  if (field.shape !== "repeatedStruct") {
    throw new Error(
      `SWAP_IDENTITIES row ${row.registryType}.${row.path.join(".")} is keyed by record keys, ` +
        `but its field is a ${field.shape}, which carries no identities of its own`
    );
  }
  return field.keying === "container" ? null : field.identityKey!;
}
