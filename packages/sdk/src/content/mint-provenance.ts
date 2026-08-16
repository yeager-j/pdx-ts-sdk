/**
 * Who minted a shape-minted definition, recorded where an author cannot write
 * it (SDK-121).
 *
 * An ordinary definition proves its own ownership: the name starts with the
 * capability's mint head and prefix, and that string is the evidence. A shape
 * mint has no such string — `GFX_fleet_order_button_ground_support_` plus a
 * *vanilla* bombardment stance is a name this mod owns and no prefix appears in
 * it — so ownership has to be recorded at the moment it is decided.
 *
 * Recorded here rather than on the item, because a property on a public item is
 * a claim rather than a proof: an author can spread any foreign `ContentItem`,
 * attach `minted: { prefix, shape }`, and place a foreign id under this
 * capability. The `WeakMap` below is module-private, `@pdx-ts/sdk` exports only
 * its root and `./stellaris`, and the only writer is the generated capability
 * method that does the minting — so the record cannot be forged from outside
 * the SDK. `ContentItem.minted` remains as informational metadata and is never
 * consulted for the check.
 *
 * This is `authoring/assets.ts`'s idiom, for the same reason: an Asset item is
 * a path and two hashes, with nothing in it that could name its owner either.
 */

/**
 * The capability a shape mint belongs to. Compared by identity — the `prefix`
 * is carried so a refusal can name the owner, never so the two can be matched
 * on it.
 */
export interface MintCapabilityOwner {
  readonly prefix: string;
}

export interface ShapeMint {
  readonly owner: MintCapabilityOwner;
  /** The `SPRITE_SHAPE_MINTS` method that minted the name. */
  readonly shape: string;
}

const records = new WeakMap<object, ShapeMint>();

/**
 * Records one shape mint and returns the very item that was recorded.
 *
 * Returning the item is what keeps the record and the placed value the same
 * object: a caller that recorded one item and placed a copy of it would have
 * built the forgeable arrangement this module exists to prevent.
 */
export function recordShapeMint<T extends object>(
  item: T,
  owner: MintCapabilityOwner,
  shape: string
): T {
  records.set(item, { owner, shape });
  return item;
}

/** The recorded mint for one item, or `undefined` if it was not shape-minted. */
export function shapeMintOf(item: object): ShapeMint | undefined {
  return records.get(item);
}

const exactNameRecords = new WeakMap<object, MintCapabilityOwner>();

/**
 * Records the capability that minted one exact-name definition (`prefix:
 * false`, SDK-183), with the same return-the-recorded-item contract as
 * {@link recordShapeMint}.
 *
 * A separate table from the shape mints, deliberately: a shape-mint record
 * *waives* the fold's string ownership measure (the name may carry no prefix
 * at all), while an exact name still carries the prefix as a segment and the
 * fold still measures it. What the string cannot decide is *which* capability
 * minted the name — a name can carry two mods' prefixes as segments
 * (`second_mod_first_mod_flash`), and containment would let either claim it —
 * so placement reads this record and compares owner identity.
 */
export function recordExactNameMint<T extends object>(item: T, owner: MintCapabilityOwner): T {
  exactNameRecords.set(item, owner);
  return item;
}

/** The recorded owner for one exact-name item, or `undefined` if it was not exact-minted. */
export function exactNameMintOf(item: object): MintCapabilityOwner | undefined {
  return exactNameRecords.get(item);
}
