/**
 * Identity-mint overlay: registries whose minted name departs from the
 * ordinary `${prefix}_${segment}_${name}` template — a fixed head, a raw
 * engine label, or a name the game assembles itself from another
 * definition's id.
 *
 * See `../overlay.ts` for what this directory is and how a row here earns
 * its place.
 */

export interface MintShape {
  /**
   * The literal every minted name of this registry carries *before* the mod
   * prefix. Omitted where there is none.
   */
  readonly head?: string;
  readonly reason: string;
}

/**
 * Registries whose names are minted rather than assembled from an id segment
 * (SDK-121).
 *
 * The ordinary shape is `${prefix}_${segment}_${name}`, where the segment is an
 * `IdProfile` member an author may override. A row here says that registry has
 * no segment at all: its minted name is `${head}${prefix}_${name}`, the head is
 * a fixed literal the game itself requires, and there is nothing for a profile
 * to override — so the registry leaves `IdProfile` entirely rather than
 * carrying a member no minting reads.
 *
 * Three consequences, all derived from this one table: the registry is dropped
 * from `IdProfile`/`DEFAULT_ID_PROFILE`, its minted-id type is the segmentless
 * template rather than `MintedContentId`, and its descriptor carries the head
 * as `mintHead` so the runtime ownership checks measure against
 * `${head}${prefix}_` rather than `${prefix}_`.
 */
export const MINT_SHAPE_OVERLAYS = new Map<string, MintShape>([
  [
    "spriteType",
    {
      head: "GFX_",
      reason:
        "SDK-121: every sprite name the game reads is `GFX_`-led — the engine finds a sprite by " +
        "the literal name a `<sprite>` field spells, and vanilla writes `GFX_` on all 9,198 of " +
        "them. So the head is the game's, not a convention an author may restyle, and a " +
        "`sprite_type` id segment between prefix and name would only be a second thing to spell " +
        "in every reference.",
    },
  ],
  [
    "pdxmesh",
    {
      reason:
        "SDK-121: mesh names are bare — `${prefix}_${name}`, no registry segment and no suffix " +
        "enforcement. A `.mesh` file's own object names are what an entity refers to, and " +
        "vanilla spends no segment on them.",
    },
  ],
  [
    "pdxparticle",
    {
      reason:
        "SDK-121: the same bare mint as pdxmesh, for the same reason — a particle name is " +
        "referred to verbatim from `.asset` entities, and vanilla writes no segment.",
    },
  ],
]);

export interface ExactNameMint {
  /**
   * The charset a logical name may use under the ordinary prefixed mint, as a
   * regex source. Wider than the global lowercase stem rule, because these
   * names are raw engine labels rather than SDK-owned identifiers.
   */
  readonly namePattern: string;
  /** The charset a complete `prefix: false` name may use, as a regex source. */
  readonly exactNamePattern: string;
  readonly reason: string;
}

/**
 * Registries whose names are raw engine labels, and which therefore carry two
 * identity allowances (SDK-183): the minted logical name accepts interior
 * uppercase, and the capability method takes `prefix: false`, under which the
 * author spells the complete definition name. The opt-out is only an opt-out of
 * the *prepend* — the mod prefix must still appear in the name as a
 * `_`-delimited segment (head, interior, or tail), which is what keeps the name
 * ownable and collision-free by construction.
 *
 * A row here requires a bare `MINT_SHAPE_OVERLAYS` row (no head): an exact name
 * is the whole id, so a fixed head would contradict it. The emitter enforces
 * this. `spriteType` is deliberately absent — every sprite reference is a
 * rule-inferred join the SDK can respell, so nothing forces a sprite name into
 * a foreign shape.
 */
export const EXACT_NAME_MINTS = new Map<string, ExactNameMint>([
  [
    "pdxmesh",
    {
      namePattern: "^[a-z][A-Za-z0-9_]*$",
      exactNamePattern: "^[A-Za-z][A-Za-z0-9_]*$",
      reason:
        "SDK-183: a mesh name is referenced verbatim from byte-preserved `.asset` files, so the " +
        "SDK cannot respell it the way it can a rule-inferred join. Vanilla writes 589 mesh names " +
        "with interior uppercase, and ported entities keep whatever spelling their assets " +
        "already use — a name the mint cannot spell is a definition the SDK cannot author.",
    },
  ],
  [
    "pdxparticle",
    {
      namePattern: "^[a-z][A-Za-z0-9_]*$",
      exactNamePattern: "^[A-Za-z][A-Za-z0-9_]*$",
      reason:
        "SDK-183: the same verbatim `.asset` reference as pdxmesh, plus a naming convention the " +
        "prepend fights — vanilla writes 80 size-headed particle names (`small_..._particle`), " +
        "where the size word must open the name and the owner's mark sits inside it.",
    },
  ],
]);

/**
 * How one shape mint fills its single hole.
 *
 * `name` — the author supplies a logical name and the mint carries the mod
 * prefix, so the result is owned by construction.
 *
 * A target registry — the author supplies a reference to a definition of that
 * registry (or an intentional raw string for one this build does not contain),
 * and the mint carries *its* id. The result may contain no mod prefix at all,
 * which is why a shape-minted item records the capability that minted it
 * instead of being held to a string prefix.
 */
export type ShapeMintHole = "name" | { readonly targetRegistry: string };

export interface SpriteShapeMint {
  /** The capability method this row generates. */
  readonly method: string;
  /** The literal the minted name opens with, before the hole. */
  readonly head: string;
  readonly hole: ShapeMintHole;
  /**
   * Optional boolean options, each appending its own literal to the minted
   * name. The game reads a separate sprite per variant.
   */
  readonly variants?: readonly { readonly option: string; readonly suffix: string }[];
  /** Where in the rules this pattern is written, verbatim enough to re-find. */
  readonly seed: string;
  readonly reason: string;
}

/**
 * The closed set of sprite names the game generates from something other than
 * the sprite's own logical name (SDK-121's *shape mints*).
 *
 * A shape mint is still an ordinary `spriteType` definition — same `Def`, same
 * registry, same emitted file, same duplicate and vanilla-collision checks. All
 * that differs is how the name is assembled, because the engine builds these
 * names itself from some other definition's id and will not read a sprite
 * spelled any other way.
 *
 * Seeded from the `$`-patterns the vendored rules write in a type's `images`
 * block. Only the patterns whose hole the SDK can actually fill are here; the
 * rest are audited in SDK-121 and deliberately absent, because a method whose
 * hole no typed value can supply is a raw-string trap wearing a name.
 *
 * {@link SHAPE_MINT_REGISTRY} is the registry every row below defines — stated
 * rather than assumed, so the emitter matches on data instead of carrying a
 * registry name of its own.
 */
export const SHAPE_MINT_REGISTRY = "spriteType";

export const SPRITE_SHAPE_MINTS: readonly SpriteShapeMint[] = [
  {
    method: "spriteTextIcon",
    head: "GFX_text_",
    hole: "name",
    seed: "`icon = GFX_text_$` in common/leader_classes.cwt's `images` block, and the same family in common/ship_sizes.cwt (`GFX_text_<key>` beside `GFX_<key>`)",
    reason:
      "SDK-121: the text icon is the inline sprite the game draws inside a line of text, and it " +
      "is a wholly separate sprite from the plain icon beside it. Name-derived rather than " +
      "target-derived because its two seeds do not share a target: `leader_class` is not a " +
      "registry this SDK exposes, and `ship_size` fills the hole from its own `icon` scalar " +
      "rather than from its id. What both need is a way to author the `GFX_text_`-led sprite at " +
      "all, which a logical name gives.",
  },
  {
    method: "spriteFleetOrderButtonGroundSupport",
    head: "GFX_fleet_order_button_ground_support_",
    hole: { targetRegistry: "bombardment_stance" },
    variants: [{ option: "selected", suffix: "_selected" }],
    seed: '`fleet_view = "GFX_fleet_order_button_ground_support_$"` and `fleet_view_selected = "GFX_fleet_order_button_ground_support_$_selected"`, both `# inferred`, in common/bombardment_stances.cwt',
    reason:
      "SDK-121: the fleet-view button for a bombardment stance. The hole is the stance's id, so " +
      "the sprite for a vanilla stance carries no mod prefix at all and the mint has to take the " +
      "stance rather than a name. `bombardment_stance` is a registry this SDK exposes, so the " +
      "target is typed.",
  },
];
