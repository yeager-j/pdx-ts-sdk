import type { ContentShape } from "./content-shape.ts";
import type { RuleType } from "./cwt/model.ts";

/**
 * The hand-maintained overlay: every place the generated API deliberately
 * departs from a mechanical reading of the rules.
 *
 * Keeping these in one table is the point. The rules cover an enormous surface
 * but they describe what the *game* accepts, not what a TypeScript API should
 * look like, and they carry no information at all about some things the SDK
 * needs. Scattering the differences through the emitters would hide how much
 * hand-maintenance this pipeline actually costs; collected here, it is a short
 * list anyone can audit.
 *
 * Each entry states what it changes and why. Adding one should feel expensive.
 */

/** Scope names the docs use that are not scopes: they mean "every scope". */
export const UNIVERSAL_SCOPES = new Set(["all", "any"]);

/**
 * Dynamic modifier families whose placeholder segment is a typed content ref.
 * The allowlist is deliberately narrow: only the audited `<job>` templates
 * receive a callable recorder path; every other template remains raw/unchecked.
 */
export const MODIFIER_FAMILY_OVERLAYS = [
  {
    family: "job",
    reference: "JobRef",
    target: "job",
  },
] as const;

/**
 * Scripted modifier categories mapped to the modifier_categories.cwt labels.
 * RuleSet does not parse enums.cwt metadata; Pop Group is normalized to Pops,
 * while none/component/pop_job intentionally have no supported mapping.
 */
export const SCRIPTED_MODIFIER_CATEGORY_MAP = {
  all: ["All"],
  economic_unit: ["Economic Units"],
  pop_group: ["Pops"],
  pop_faction: ["Pop Factions"],
  ship: [
    "Orbital Stations",
    "Space Stations",
    "Military Ships",
    "Civilian Ships",
    "Science Ships",
    "Transport Ships",
  ],
  station: ["Orbital Stations", "Space Stations"],
  fleet: ["Fleets"],
  country: ["Countries"],
  planet: ["Planets"],
  army: ["Armies"],
  leader: ["Leaders"],
  deposit: ["Deposits"],
  megastructure: ["Megastructures"],
  habitability: ["Habitability"],
  starbase: ["Starbases"],
  system: ["Star Systems"],
  federation: ["Federations"],
  espionage: ["Espionage"],
  colony: ["Colony"],
} as const;

/**
 * Structural triggers the SDK models by hand rather than generating.
 *
 * These are not conditions, they are the shape of the condition tree, and the
 * SDK gives them signatures the rules cannot express: `and()` flattens its
 * operands into one block, and all three infer the scope intersection of their
 * arguments.
 *
 * `hidden_trigger` is here for a plainer reason — it is declared in
 * `scope_links.cwt`, which this generator does not load *because* that file
 * also declares the combinators above. It shares their shape (a flat splice
 * that changes no scope), so `src/script/triggers.ts` writes it beside them, and
 * `hidden_effect` is structurally owned in `effect-policy.ts` for the same
 * reason. Both appear in the drift baseline as documented-but-unruled, which
 * is exactly what they are.
 *
 * `current_situation_approach`, `current_stage`, and
 * `can_set_situation_approach` are here for a third reason (SDK-52): each is
 * an ordinary leaf condition — the rules describe it correctly, and a
 * mechanical `(value: SituationApproach | SituationStage): Trigger<"situation">`
 * would be a faithful reading — but the SDK's own `SituationTrigger` return
 * type (a `Trigger<"situation">` carrying the literal id as an optional
 * phantom brand, `src/script/triggers.ts`) is checked against `defineSituationType`'s
 * own declared `approach`/`stages` keys, a contract the rules have no way to
 * express. Skip-listing here keeps generation and the hand-written override in
 * `src/script/triggers.ts` from disagreeing about which one is the real export: only
 * the hand-written module ever supplies these three names now.
 */
export interface HandWrittenDefiner {
  readonly reason: string;
  /** Module exporting the definition-side lowering primitive. */
  readonly module: string;
  /** Exported lowering function name. */
  readonly definer: string;
  /**
   * The declared contract the hand-written definer returns beside the def,
   * where it returns one: the property and the type it is parameterised by.
   *
   * Codegen still owns the registry's item type, so it has to be told — an
   * item type that dropped the property would be a supertype an author reaches
   * by annotating, leaving the effect that consumes the definition nothing to
   * check (SDK-181). The generated definers learn the same thing from
   * `ContentScopeParameter.declaredFrom`.
   */
  readonly witness?: { readonly member: string; readonly type: string };
}

/**
 * Registries whose `defineX` is re-exported from `src/content/situations.ts` instead of
 * being the mechanical one the emitter would write.
 *
 * The hand-written trigger-export policy arrangement, one level up: codegen skips the
 * member and the hand-written module supplies it, so there is exactly one
 * definition of the graft and it is the reviewed one. A row here is expensive —
 * it removes a definer from generator ownership — and needs a contract the rules
 * cannot express, not merely a nicer signature.
 */
export const HAND_WRITTEN_CONTENT_DEFINERS = new Map<string, HandWrittenDefiner>([
  [
    "situation_type",
    {
      reason:
        "`targetScope` is authored, emits nothing, and is carried on the returned item as the " +
        "situation target contract every `startSituation` call site is checked against " +
        "(src/script/effects/situations.ts). The rules declare that contract nowhere, so no " +
        "mechanical definer " +
        "can produce it.",
      module: "../content/situations.ts",
      definer: "defineSituationType",
      witness: { member: "targetScope", type: "ScopeName | undefined" },
    },
  ],
  [
    "event_chain",
    {
      reason:
        "Counter keys are declared by one event chain and consumed by three script operations; " +
        "the returned item carries that literal key union so those consumers can reject a typo.",
      module: "../content/event-chains.ts",
      definer: "defineEventChain",
    },
  ],
]);

export interface ContentSubtypeReferenceRefinement {
  /** Authored boolean member that selects the CWT subtype. */
  readonly member: string;
  /** Qualified CWT reference carried by definitions that select the subtype. */
  readonly reference: string;
  /** Why the general registry reference is not sufficient at consuming fields. */
  readonly reason: string;
}

/**
 * Attribute-selected subtypes whose capability return must retain a qualified
 * reference. The rules use these qualified references at consuming fields, so
 * widening the returned item to the registry's general reference would force
 * authors through the field's raw-string escape hatch.
 */
export const CONTENT_SUBTYPE_REFERENCE_REFINEMENTS = new Map<
  string,
  ContentSubtypeReferenceRefinement
>([
  [
    "component_set",
    {
      member: "requiredComponentSet",
      reference: "component_set.required_component",
      reason:
        "ship_size.required_component_set accepts only the required_component subtype, which " +
        "component_set selects with required_component_set = yes.",
    },
  ],
]);

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
 * Emitted file stems that are not the last component of the registry's output
 * directory (SDK-121).
 *
 * The derived stem is `basename(outputDir)`, which reads well under `common/`
 * (`common/technologies` -> `mymod_technologies.txt`) and badly for the three
 * GFX registries, whose directories are named for the *kind of file* rather
 * than for what is in them: `interface/mymod_interface.gfx`,
 * `gfx/models/mymod_models.gfx`. The canonical stems name the definitions.
 *
 * The `pdxparticle` row is redundant — `gfx/particles` already derives
 * `particles` — and is written out anyway: this table is the complete audited
 * statement of the three canonical GFX stems, so reading it should not require
 * knowing which of them the derivation happens to agree with, and a directory
 * rename upstream must not silently move a stem that SDK-121 fixed.
 */
export const FILE_STEM_OVERLAYS = new Map<string, string>([
  ["spriteType", "sprites"],
  ["pdxmesh", "meshes"],
  ["pdxparticle", "particles"],
]);

/**
 * The fields whose value is a path from the mod root, so a captured Asset can
 * stand in for the string (SDK-121).
 *
 * Audited rather than derived, because CWT does not draw the distinction that
 * matters here. `cwt/model.ts` lowers both `filepath` and `filename[dir]` to
 * one `filepath` rule type — correctly, since both are one string in the file —
 * but only the first is a path from the mod root. `filename[gfx/models]` is a
 * bare name the game resolves inside that directory, and vanilla writes it that
 * way (`texture_diffuse = "turret_object_diffuse.dds"`), so an `AssetFileItem`
 * lowering to its declared logical path would write a path the game cannot
 * follow. The four `model_mesh.meshsettings.texture_*` members are the only
 * `filename[dir]` fields in the vendored rules, and they are deliberately
 * absent below.
 *
 * Each row is one field the rules type bare `filepath` and vanilla writes as a
 * mod-root path. Every one is checked at generation time against its actual
 * declaration, so a row that stops being a `filepath` field fails codegen
 * rather than quietly widening a member.
 */
export const ASSET_PATH_FIELDS = new Map<string, string>([
  [
    "spriteType.textureFile",
    "interface/sprites.cwt declares `textureFile = filepath` with no directory; Stellaris 4.4.6 " +
      'writes mod-root paths such as "gfx/event_pictures/celestial_storm.dds". It is the field ' +
      "the whole Asset pipeline exists for — the image a sprite shows.",
  ],
  [
    "spriteType.masking_texture",
    "interface/sprites.cwt declares `masking_texture = filepath` with no directory; vanilla " +
      'writes "gfx/interface/contacts/Contacts_Background_Mask.dds" and kin — the same mod-root ' +
      "form as `textureFile`, for a second image file beside it.",
  ],
  [
    "spriteType.effectFile",
    "interface/sprites.cwt declares `effectFile = filepath` with no directory; vanilla writes " +
      '"gfx/FX/buttonstate.shader". A shader rather than an image, but the same kind of value: a ' +
      "file the mod may ship and address from its root.",
  ],
  [
    "spriteType.animation.animationmaskfile",
    "interface/sprites.cwt declares `animationmaskfile = filepath` with no directory inside the " +
      'sprite `animation` block; vanilla writes "gfx/cursors/crosshair_mask.dds".',
  ],
  [
    "spriteType.animation.animationtextureFile",
    "interface/sprites.cwt declares `animationtextureFile = filepath` with no directory, in the " +
      "same `animation` block and beside `animationmaskfile`. Stellaris 4.4.6 writes it zero " +
      "times, so the declaration is the whole evidence — which is the reason to include it: a " +
      "field with no shipped example is exactly the one an author has nothing to copy from.",
  ],
  [
    "pdxmesh.file",
    "gfx/model_entities.cwt declares `file = filepath` with no directory and the rule's own " +
      'comment gives the mod-root form ("gfx/models/shielded_planet.mesh"); vanilla writes ' +
      '"gfx/models/spacedust.mesh". It is the mesh a pdxmesh is.',
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

/**
 * Registries whose collection factory also offers a vanilla patch.
 *
 * A prefixed definition cannot collide with vanilla, but a patch is a whole-
 * object override whose load order and emission have to be verified per
 * registry — so `patchX` appears only where that evidence exists. The member
 * names are derived (`patchTechnology`, `ParsedTechnology`, `TechnologyPatch`);
 * the row is the permission.
 */
export const CONTENT_PATCH_REGISTRIES = new Map<string, string>([
  [
    "technology",
    "the first registry the vanilla loader parses and the patch resolver plans emission for " +
      "(packages/sdk/src/stellaris/vanilla/, src/compiler/patches.ts) — verified in-game by the patches-that-provably-win calibration",
  ],
  [
    "building",
    "parsed by the vanilla loader beside technology (PARSED_REGISTRIES in " +
      "packages/sdk/src/stellaris/vanilla/view.ts), and its rule-table row is fully verified — " +
      "r8 established last-wins and whole-object replacement from matching diagnostics",
  ],
  [
    "megastructure",
    "parsed by the vanilla loader beside technology and building (PARSED_REGISTRIES in " +
      "packages/sdk/src/stellaris/vanilla/view.ts), and its rule-table row carries two " +
      "non-refused cells — r8 verified last-wins, and whole-object replacement is the named " +
      "2026-07-31 judgment r8 could not discriminate. Assumed rather than verified is still a " +
      'rule the engine may act on: every win it backs reports `confidence: "assumed"` and ' +
      "every emitted patch file states the judgment in its header, so the weaker evidence is " +
      "visible rather than laundered",
  ],
]);

export interface ContributionSink {
  /** The contribution method on the collection factory. */
  readonly method: string;
  /** The `ContributionItem` registry tag the fold merges under. */
  readonly sink: string;
  /** The ref registry whose ids the contribution lists. */
  readonly refRegistry: string;
  readonly reason: string;
}

/**
 * Registries that additionally contribute to a shared, non-id-keyed sink.
 *
 * A contribution has no id this mod owns and no author-named file: it is folded
 * into one additive `default = { ... }` block at a fixed path. Nothing in the
 * rules marks a registry as having one, so each is a reviewed row.
 */
export const CONTENT_CONTRIBUTION_SINKS = new Map<string, ContributionSink>([
  [
    "country_ship_of_size_limit",
    {
      method: "addShipOfSizeLimits",
      sink: "ship_of_size_limits",
      refRegistry: "country_ship_of_size_limit",
      reason:
        "`country_limits` reads one shared additive `default = { ship_of_size_limits = { ... } }`; " +
        "the listed limits are ids, not definitions this file owns.",
    },
  ],
]);

/**
 * Alias families the rule loader reads into a table beyond `trigger` and
 * `effect`.
 *
 * CWT declares roughly two dozen alias categories, and most of them are GUI or
 * graphics grammar with no bearing on the content registries the SDK exposes.
 * Sweeping them all in would cost parse time and, worse, invite the emitters to
 * guess at shapes nobody has read. So the loader reads a category only when a
 * content registry actually consumes it, and each row says which consumer.
 */
export const EXTRA_ALIAS_CATEGORIES = new Map<string, string>([
  [
    "pop_pre_trigger",
    "Seven plain bools consumed by `job.possible_pre_triggers` (and " +
      "pop_faction_type's can_join_pre_triggers). Every member is `bool`, so the " +
      "splice lowers as an ordinary struct.",
  ],
  [
    "colony_pre_trigger",
    "The colony-scoped twin of pop_pre_trigger, seven plain bools, consumed by " +
      "the planet/colony event `pre_triggers` blocks.",
  ],
  [
    "government_trigger",
    "The requirements DSL behind civic/origin `potential` and `possible`. Not a " +
      "`Trigger` — its members are a fixed value/OR/NOT/NOR clause template plus " +
      "self-recursive OR/AND/limit combinators, emitted by emit/alias-struct.ts.",
  ],
  [
    "planet_initializer",
    "The planet grammar `solar_system_initializer` splices unkeyed at its own top " +
      "level. One member, `planet`, whose declaration is a block that splices " +
      "`planet_initializer` and `moon_initializer` back into itself — so a system's " +
      "planets are anonymous, ordered and repeated, and nest without bound. Emitted " +
      "by emit/alias-splice.ts as `PlanetInitializerFields`, whose field table has to " +
      "be resolved through `registerAliasStructFields` at write time because it " +
      "refers to itself.",
  ],
  [
    "moon_initializer",
    "The moon half of the same grammar, spliced from inside `planet` and from inside " +
      "itself. One member, `moon`. Kept separate because CWT declares it separately, " +
      "and because a moon admits a strictly smaller body — no `namelist`, no " +
      "`satellite_naming_policy`, and no nested `planet`.",
  ],
]);

export interface FieldWidening {
  /** Appended to the mechanically derived type. */
  readonly extraType: string;
  readonly reason: string;
}

export interface EffectFieldTypeOverride {
  /** Replaces the mechanically derived type outright. */
  readonly type: string;
  readonly reason: string;
}

export interface EffectFieldAddition {
  readonly name: string;
  readonly type: RuleType;
  readonly optional: boolean;
  readonly source: string;
  readonly reason: string;
}

/**
 * Fields the game documentation declares for an effect but CWT omits.
 *
 * These rows extend only an existing generated args block. The effect emitter
 * rejects a missing effect, a non-block shape, an unsupported field type, or a
 * field that later appears in CWT, so an upstream correction cannot leave this
 * table as a silent second declaration.
 */
export const EFFECT_FIELD_ADDITIONS = new Map<string, readonly EffectFieldAddition[]>([
  [
    "create_ambient_object",
    [
      {
        name: "target",
        type: { kind: "scope", name: "any" },
        optional: true,
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:782-800",
        reason:
          "The game documentation accepts `target = <target>` in the VFX form, but the CWT " +
          "rule omits that field. The minimal documented form does not require it, so the " +
          "authoring member is optional.",
      },
    ],
  ],
]);

/**
 * Type text for one named field of one effect's args object, replacing what
 * the rules lower to.
 *
 * The narrowest and most expensive table here, and deliberately so: unlike
 * {@link FIELD_WIDENINGS}, which adds a form the rules did not name, a row
 * here *removes* one the rules do name. It exists for the case where the
 * mechanical type is right about the game and wrong about TypeScript —
 * specifically, where a hand-written overload merged onto the same method
 * needs the generated one to stop catching calls it was never meant to catch.
 * Nothing else changes: `EFFECT_META`, `refTypes`, and the runtime recording
 * all still come from the rules' own lowering, so a row cannot make the
 * emitted script wrong, only the accepted inputs narrower.
 *
 * Keyed `<effect key>.<field key>`, both as the rules spell them.
 */
export const EFFECT_FIELD_TYPE_OVERRIDES = new Map<string, EffectFieldTypeOverride>([
  [
    "start_situation.type",
    {
      type: "(SituationTypeRef & { targetScope?: never }) | string",
      reason:
        "`SituationTargetContract` (src/script/effects/situations.ts) extends " +
        '`TypedRef<"situation_type">` and is therefore structurally a `SituationTypeRef`, so a ' +
        "contract-bearing ref matched this generated signature whenever the hand-written " +
        "contract overload rejected its target — silently turning a wrong-scoped " +
        "`startSituation` target into a legal call. Requiring `targetScope` to be absent makes a " +
        "declared contract fail here too, so the only overload that can accept one is the " +
        "hand-written one that checks it. Vanilla and third-party ids are unaffected: a plain " +
        "`SituationTypeRef`, an id string, and a situation type defined without `targetScope` " +
        "all carry no `targetScope` to conflict.",
    },
  ],
  [
    "enable_special_project.name",
    {
      type: "(SpecialProjectRef & { locationScope?: never }) | string",
      reason:
        "The same arrangement as `start_situation.type` above, for the same reason: " +
        "`SpecialProjectLocationContract` (src/script/effects/special-projects.ts) is " +
        "structurally a `SpecialProjectRef`, so a project that declares `locationScope` would " +
        "match this generated signature exactly when the hand-written overload rejected its " +
        "`location` — turning a contradicted declaration into a legal call. A project defined " +
        "without `locationScope`, a vanilla id string and a plain ref all carry no " +
        "`locationScope` to conflict.",
    },
  ],
]);

export interface EffectExtensionSeam {
  /** The emitted interface the hand-written overload augments. */
  readonly interfaceName: string;
  /** The hand-written overload's display signature for script references. */
  readonly referenceSignature: string;
  readonly reason: string;
}

/**
 * Effects whose generated signature is emitted into its own interface, which
 * the cluster owning the effect then extends.
 *
 * A hand-written overload has to be merged onto *something* stable. The
 * generated cluster is not: it is named for the scopes its effects share, so
 * adding an effect elsewhere in the rules can rename it and silently detach the
 * augmentation. A seam gives the overload a name that only changes when this
 * table does.
 *
 * A row is only worth it where a hand-written overload exists, which in
 * practice means a contract the definition declares and the rules cannot state
 * — the row and the overload are written together, and codegen fails loudly if
 * the effect leaves the rules.
 */
export const EFFECT_EXTENSION_SEAMS = new Map<string, EffectExtensionSeam>([
  [
    "start_situation",
    {
      interfaceName: "StartSituationEffectsExtension",
      referenceSignature:
        "startSituation<T extends ScopeName>(args: { type: Unambiguous<T, SituationTargetContract<T>>; target: ScopeValue<NoInfer<T>>; effect?: (scope: SituationEffectScope<T>) => void }): void;",
      reason:
        "`startSituation` takes the situation's author-declared `targetScope` as proof of the " +
        "target it is passed (src/script/effects/situations.ts).",
    },
  ],
  [
    "enable_special_project",
    {
      interfaceName: "EnableSpecialProjectEffectsExtension",
      referenceSignature:
        'enableSpecialProject<L extends SpecialProjectLocationScope>(args: Omit<EnableSpecialProjectArgs, "name" | "location"> & { name: Unambiguous<L, SpecialProjectLocationContract<L>>; location: ScopeValue<NoInfer<L>> }): void;',
      reason:
        "`enableSpecialProject` checks its `location` against the project's author-declared " +
        "`locationScope`, which is also the FROM its success callbacks read " +
        "(src/script/effects/special-projects.ts).",
    },
  ],
]);

/**
 * Ergonomic widenings on generated content-type fields.
 *
 * The rules describe the file format; these accept the shape a modder would
 * reach for first and normalise it at emit time.
 */
export const FIELD_WIDENINGS = new Map<string, FieldWidening>([
  [
    "technology.category",
    {
      extraType: "TechnologyCategoryRef | string",
      reason:
        "The rules type this as a list, but a technology almost always has exactly one " +
        "category. Accepting the bare value avoids making every caller write a one-element array.",
    },
  ],
  [
    "technology.tier",
    {
      extraType: "number",
      reason:
        "Tiers are a content type whose vanilla keys are the integers 0-5, so modders write " +
        "`tier: 3`. Refusing a number here would be pedantically correct and useless.",
    },
  ],
  [
    "pdxmesh.meshsettings.shader",
    {
      extraType: "string",
      reason:
        "model_entities.cwt declares `shader = $shader_effect`, which is the config's own " +
        "marker for a name defined in a `.shader` file rather than a value domain — the same " +
        "spelling `section_templates.cwt` uses for `$mesh_locator`. Read as a value it is a " +
        "one-member literal union nothing can satisfy, so without this the field is present " +
        "and unfillable: Stellaris 4.4.6 writes 47 distinct real shader names " +
        "(`PdxMeshShip`, `PdxMeshPlanetEmissive`, `AlphaBlendNoDepth`, …) across 2,980 of " +
        "3,257 meshes, and none of them is `$shader_effect`. There is no id set to check " +
        "against — `.shader` files are opaque to the SDK — so the widening is to `string`.",
    },
  ],
]);

/**
 * Ergonomic widenings on a patch member, over what the definition's own member
 * already admits.
 *
 * Same shape and same review posture as {@link FIELD_WIDENINGS}, one surface
 * over: a row is a claim that the patch transform emits this extra form
 * correctly, which is evidence to produce, not a reading of the rules. The
 * extra form joins the member's admitted inputs — at the *element* level for a
 * list-shaped member, since that is the position the form occurs in.
 */
export const PATCH_WIDENINGS = new Map<string, FieldWidening>([
  [
    "technology.prerequisites",
    {
      extraType: "AnyOf<TechnologyRef>",
      reason:
        "Vanilla writes `OR = { ... }` alternation groups in five technology files, and the " +
        "parsed surface hands them back as `AnyOf` values, so `[...t.prerequisites, mine]` has " +
        "to be a legal patch input. A definition of the mod's own has no such need: nothing " +
        "reads an authored OR group back out.",
    },
  ],
]);

/**
 * Localisation slots the SDK always writes, and therefore requires.
 *
 * Slot *names* come straight from the rules — `name` and `desc` — which also
 * matches how the rest of the script surface reads, since `desc` is the key
 * events use for their description. Only the requiredness is ours: definitions
 * need a display name even where the rules do not mark the slot required.
 *
 * Description/flavor/effects slots stay optional. Missing tooltip text is a
 * lint to grow, not a reason to block generated placeholder content.
 */
export const REQUIRED_LOCALISATION = new Set([
  "technology.name",
  "building.name",
  "tradition.name",
  "tradition_category.name",
  "ascension_perk.name",
  "agenda.name",
  "edict.name",
  "councilor.name",
  "decision.name",
  "job.name",
  "opinion_modifier.name",
  // All 3096 shipped static modifiers carry a localised name: the game shows
  // it wherever the modifier is applied, so an unnamed one is a visible bug.
  "static_modifier.name",
  "casus_belli.name",
  "war_goal.name",
  "agreement_preset.name",
  "bombardment_stance.name",
  "archaeological_site_type.name",
  // All 164 shipped megastructures carry a localised name, and the game shows
  // it in the construction menu and the outliner, so an unnamed one is a
  // visible bug the same way an unnamed static modifier is.
  "megastructure.name",
]);

export interface SyntheticLocalisation {
  /** The `$`-bearing pattern to synthesize, e.g. `"$_desc"`. */
  readonly pattern: string;
  readonly reason: string;
}

/**
 * A localisation slot the rules never declare at all, added because the
 * registry needs the same real, auto-keyed authoring path a sibling registry
 * gets for free from the rules.
 *
 * `archaeological_site_type` is the case this exists for (SDK-50).
 * `type[archaeological_site_type].localisation` (archaeology.cwt:5-8) declares
 * only `name = "$"` and `desc = desc` — a bare pointer with no `$`, meaning
 * `planLocalisation` excludes it outright (same rule SDK-44's `name = name`
 * fix relies on) and the registry ends up with *no* slot where an author can
 * write real flavor text and get a generated key. The body's own `desc` field
 * (`archaeology.cwt:44`, dual with the `triggered_desc_clause` block form,
 * which `emit/content-type.ts` renames to `conditionalDesc` because the slot
 * this row adds takes the `desc` member) is `conversion: "identity"` either
 * way its dual resolves — a raw key, never auto-generated — so writing
 * English into it is accepted and
 * silently wrong: no warning, no error, the game shows the literal string.
 * `situation_type`, by contrast, needs no such row: situations.cwt:17 already
 * declares `desc = "$_desc"` *alongside* the same bare `desc = desc` pointer
 * (:18), so the real slot already exists there and the pointer simply loses
 * the member-name collision — evidence this is a genuine asymmetry in the
 * vendored rules, not a design position the SDK is second-guessing.
 *
 * A row here does not claim the game reads a `<id>_desc` key today — it adds
 * one, matching the convention every other `desc`-bearing registry in
 * {@link REQUIRED_LOCALISATION}'s neighborhood already follows, and gives
 * `conditionalDesc`'s raw-key arms (the top-level scalar and
 * `ArchaeologicalSiteTypeDesc.text`) a genuine optional escape hatch instead
 * of being the only route.
 *
 * A generated key is only half the fix: `type[archaeological_site_type]`
 * reads that text through the body's own `desc` pointer, so a definition that
 * sets only the synthetic `desc` member and never touches `conditionalDesc`
 * would populate the `.yml` with real text and emit no `desc = <id>_desc`
 * anywhere in its own body — reachable nowhere in game, the identical silent
 * failure this table exists to close, one step removed. The emitted
 * `pointerMember` closes that: `ContentAuthoring.define` defaults it to the
 * synthesized key whenever the text member is set and the author has not
 * written the pointer themselves. It is not stated here — the collision this
 * row manufactures is what renames the body field, so `emit/content-type.ts`
 * records the pointer from that rename rather than repeating its spelling.
 */
export const SYNTHETIC_LOCALISATION = new Map<string, SyntheticLocalisation>([
  [
    "archaeological_site_type.desc",
    {
      pattern: "$_desc",
      reason:
        "archaeology.cwt declares no `$`-bearing pattern for desc at all (only the excluded " +
        'bare pointer `desc = desc`), unlike situation_type\'s `desc = "$_desc"` sitting beside ' +
        "its own identical pointer — so archaeological_site_type has no real flavor-text slot " +
        "without this row. See SDK-50.",
    },
  ],
]);

/**
 * Fields the emitter can lower but that review has decided not to emit, with
 * the reason.
 *
 * Everything the emitter can lower is emitted, so this is the only way to keep
 * a field out of the authoring surface deliberately. It should stay nearly
 * empty: a field the emitter cannot lower is detected mechanically and belongs
 * in no list, and a field whose lowered type is wrong is better fixed than
 * hidden. That bar does not cover every row that could ever land here —
 * `change_orbit` (SDK-30) is the one case it was never meant to: not a field
 * whose *lowered shape* is wrong, but a second spelling of a capability the
 * SDK already emits correctly (see the entry below), so declining it
 * withholds nothing an author cannot already do. A future row needs the same
 * property — a genuine second spelling of existing capability, not a
 * shape the emitter merely lowers badly — to clear this bar.
 */
export const CONTENT_DECLINED_FIELDS = new Map<string, string>([
  [
    "solar_system_initializer.change_orbit",
    "At the top level, change_orbit is positional sugar: written between two `planet` blocks, " +
      "it advances the orbit cursor for the planets that follow it, so its position among them " +
      "is the geometry. `changeOrbit?: number[]` collects every value into one array field with " +
      "one fixed emission slot, which cannot represent that position — 288 of 355 shipped " +
      "top-level initializer blocks interleave `change_orbit` between `planet` blocks, and the " +
      "SDK silently emitted every one of them after every planet, where none of them shift " +
      'anything. Nothing is lost by declining it: `class: "none", orbitDistance: n` on the ' +
      "next `planet` block (a real `PlanetInitializerFields`, `none` is in `SolarSysInitPlanetClass`) " +
      "already types and emits the same geometry, in the position that matters, with no runtime " +
      "shape needed for a spelling the game already documents as sugar.",
  ],
  [
    "planet_initializer.change_orbit",
    "The moon-level twin of the row above, inside one planet's own `moon` list: " +
      "`alias[planet_initializer:planet]`'s own change_orbit (cardinality 0..1, singular — at " +
      "most one cursor jump per planet, unlike the top level's repeatable one) advances the " +
      "orbit cursor for the moons that follow it within that planet, so where it is *written* " +
      "among that planet's `moon` blocks is still the geometry, same as the top level. " +
      "`changeOrbit?: number` collapses it to one fixed-position field just the same. The long " +
      'form (`class: "none", orbitDistance: n` on the next `moon` block) already types and ' +
      "emits it correctly positioned.",
  ],
  [
    "moon_initializer.change_orbit",
    "The same field one level further down, inside a moon's own nested `moon` list (moons nest " +
      "without bound per EXTRA_ALIAS_CATEGORIES). `alias[moon_initializer:moon]`'s own " +
      "change_orbit is the identical singular, positional-sugar shape as " +
      "`planet_initializer.change_orbit` above, declined for the same reason.",
  ],
]);

export interface ContentScopeParameter {
  /** Every scope a definition may declare, canonical names. */
  readonly scopes: readonly string[];
  /** The scope a definition that declares none runs in. */
  readonly fallback: string;
  /** A game field that selects the scope instead of a synthetic `scope` member. */
  readonly selector?: {
    readonly member: string;
    /** Members the selected scope is the `this` of. */
    readonly scopedMembers: readonly string[];
    /**
     * Members the selected scope is the FROM of, their `this` being the
     * registry's own fallback. The same selector read the other way round: a
     * callback the game runs one scope out from the object it is about still
     * hands that object over, and FROM is the slot it arrives in.
     *
     * Needs the evidence a {@link ContentFieldOverride.scope} row needs, and
     * from the same distance: the corpus can show a FROM being navigated but
     * never contradicts an over-narrow one, so a row states which shipped
     * definitions read FROM and as what.
     */
    readonly fromMembers?: readonly string[];
    readonly typeName: string;
    readonly fallback: string;
    readonly scopes: Readonly<Record<string, string>>;
  };
  /**
   * A FROM the *call site* chooses, declared once on the definition.
   *
   * The selector above reads a FROM off a field the definition already has.
   * This is the case where nothing on the definition decides it: the scope
   * arrives as an argument of the effect that starts the thing, so the rules
   * can only say which scopes are admissible — the `scopes.cwt` group named
   * here — and never which one a given definition gets.
   *
   * A row emits one synthetic member (naming the scope, emitting nothing, on
   * `scope`'s terms), types FROM in the listed members from it, and carries the
   * declaration on the returned item so the call site can be checked against
   * it. That last part is what keeps this from being a comment the author
   * writes and nothing verifies, and it is why a row needs a hand-written
   * overload on the starting effect (see {@link EFFECT_EXTENSION_SEAMS}) rather
   * than being free.
   *
   * Undeclared stays the default: the member is optional, and a definition that
   * omits it reads no FROM and has its call sites unchecked, exactly as before
   * the row existed. That is also the only shape available to a definition
   * whose starting effect is called *without* the argument — the scope then
   * defaults to the caller's, which no signature on a universally-valid effect
   * can see. Like `<Registry>Scope` above, the emitted union has to be
   * re-exported from `src/index.ts` by hand for a consumer to name it.
   */
  readonly declaredFrom?: {
    /** The synthetic authoring member that names the scope. */
    readonly member: string;
    /**
     * The `scopes.cwt` scope group the declaration may name. Checked against
     * the group `effect`.`argument` is actually declared with, so a rules bump
     * that retypes the argument fails codegen rather than leaving the
     * declaration and the signature it is checked against disagreeing.
     */
    readonly scopeGroup: string;
    /** Members whose FROM the declaration becomes. */
    readonly members: readonly string[];
    /** The effect whose argument the scope actually is, and that argument. */
    readonly effect: string;
    readonly argument: string;
    readonly reason: string;
  };
  readonly reason: string;
}

/**
 * Registries whose unpinned field scopes are a property of the *definition*
 * rather than a constant the rules could state.
 *
 * The `scope` assertion fixes a field CWT failed to annotate. This is the case
 * where CWT annotates `this = any` and is **right**: a decision taken on a
 * nomadic ship colony really is ship-scoped and one taken on a planet really is
 * planet-scoped, and the rules say so in a comment. The trouble is that
 * `Trigger<S>` is contravariant, so "valid in every scope" as a field type
 * admits only rules legal in every scope — leaving the field emitted, required,
 * and unfillable.
 *
 * A row turns every field the registry left unpinned into `Trigger<NoInfer<S>>`
 * and adds one authoring member, `scope`, that names S and emits nothing. It
 * also introduces a public `<Registry>Scope` union, which has to be re-exported
 * from `src/index.ts` by hand — nothing else makes a consumer able to name the
 * type its own helpers need. It needs the same evidence a `scope` assertion does — the scopes listed are the
 * ones real definitions are written against, and shape conformance checks that
 * the set covers what the corpus writes rather than taking the row's word.
 */
export const CONTENT_SCOPE_PARAMETERS = new Map<string, ContentScopeParameter>([
  [
    "decision",
    {
      scopes: ["planet", "ship"],
      fallback: "planet",
      reason:
        "decisions.cwt annotates the body `this = any` and explains why: on a nomadic ship " +
        "colony a decision is ship-scoped, on a planet planet-scoped. Every non-universal " +
        "condition across all 111 shipped decisions is planet-valid — none writes a country-only " +
        "condition directly, they navigate through `owner` — so `planet` is the fallback and " +
        "`ship` the case that has to be declared.",
    },
  ],
  [
    "special_project",
    {
      scopes: ["country", "planet", "ship", "carrier"],
      fallback: "country",
      selector: {
        member: "eventScope",
        scopedMembers: ["onSuccess", "onProgress25", "onProgress50", "onProgress75", "onStart"],
        fromMembers: ["failTrigger", "abortTrigger", "onFail", "onCancel"],
        typeName: "SpEventScope",
        fallback: "country_event",
        scopes: {
          country_event: "country",
          planet_event: "planet",
          ship_event: "ship",
          carrier_event: "carrier",
        },
      },
      declaredFrom: {
        member: "locationScope",
        scopeGroup: "spatial_object",
        members: ["onSuccess", "onProgress25", "onProgress50", "onProgress75", "onStart"],
        effect: "enable_special_project",
        argument: "location",
        reason:
          "The success callbacks run with FROM = the `location` handed to " +
          "enable_special_project, which the game's own documentation.txt calls 'location " +
          "scope, if set (usually a planet)'. Nothing on the definition decides it: " +
          "effects.cwt types the argument `scope_group[spatial_object]`, and of vanilla's 735 " +
          "enable_special_project calls the 660 that set `location` pass `this` (395), " +
          "`capital_scope` (40), `from` (33), `root` (17), `this.star`, `solar_system.star`, " +
          "`capital_scope.solar_system.starbase` and ~90 distinct event targets — planets, " +
          "ships, fleets, stars and ambient objects. The corpus reads FROM as each of those in " +
          "on_success: `is_colony` on VULTAUM_HOMEWORLD_PROJECT (planet), `set_fleet_flag` on " +
          "HIDDEN_CUTHOLOID_ATTACK_PROJECT (fleet), `country_event` on the PROSPECTORIUM " +
          "projects (country). No constant covers that, so the definition declares which one " +
          "it is written for and enableSpecialProject is checked against the declaration.",
      },
      reason:
        "special_projects.cwt leaves the event-dependent clauses unpinned: a project may run " +
        "against country, planet, ship, or carrier event scope. The corpus records all four " +
        "across on_success/on_progress/on_start, while its AI and cost weights are country " +
        "conditions. event_scope is the engine's authoritative selector for the callback context, " +
        "so the generated callback scope is derived from it rather than author-declared. " +
        "The four country-scoped callbacks read the same selector as FROM: the game's own " +
        "common/special_projects/documentation.txt states, for on_fail/on_cancel/abort_trigger/" +
        "fail_trigger alike, THIS = country, FROM = project scope (matching event_scope, and " +
        "'might not exist'), FROMFROM = location — and special_projects.cwt says the same for " +
        "fail_trigger and abort_trigger. The corpus writes that two-level shape: the ship_event " +
        "projects trojan_asteroid_project and molluscoid_miners_project_1 " +
        "(00_projects_distant_stars.txt) reach the location through FROMFROM " +
        "(`fromfrom.solar_system`) in abort_trigger while FROM stays the project's own scope, and " +
        "OPEN_SEED_PODS_PROJECT (00_projects_plantoids.txt, planet_event) navigates " +
        "`from = { colonizable_planet has_modifier }` in abort_trigger and its location through " +
        "FROMFROM in on_cancel. One shipped block disagrees — SHIELD_PRIMITIVE_PLANET_PROJECT " +
        "(00_projects_first_contact_dlc.txt) is country_event and writes planet conditions under " +
        "FROM in abort_trigger — which is the degenerate case the documentation flags: with the " +
        "project scope a country it is already THIS, and that block is malformed anyway (an OR " +
        "of a single NOT of two members). FROMFROM has no slot in the emitted contract, so the " +
        "location stays unreachable in these four; on_success's own FROM is the location and is " +
        "not assertable at all, since enable_special_project takes it as any of fourteen " +
        "scope_group[spatial_object] scopes and vanilla's 660 call sites that set it range over " +
        "planets, ships, fleets, systems, starbases and ambient objects.",
    },
  ],
]);

export type ContentFieldShape = Extract<
  ContentShape,
  | "value"
  | "valueList"
  | "trigger"
  | "effect"
  | "economicResources"
  /**
   * A repeated resource-name operation with one condition sibling and the
   * complex maths operations alongside it: `ai_resource_production = {
   * <resource> = float trigger = { ... } mult = value }`.
   *
   * This is deliberately distinct from `economicResources`: the latter owns
   * a named collection of cost/production/upkeep/logistics operations, while
   * this shape is itself one such operation. Both use the shared
   * `EconomicResourceOperation<S>` contract at runtime.
   */
  | "economicResourceOperation"
  /**
   * The same `economicResources` shape, minus the `produces` arm — for a
   * field CWT splices from `economic_template_no_produce` rather than plain
   * `economic_template`. Lowers to `EconomicResourceBlockNoProduce<S>`
   * (`Omit<EconomicResourceBlock<S>, "produces">`) and the writer iterates a
   * `produces`-free operation list, so the illegal arm is unwritable and
   * unemittable rather than merely undocumented.
   *
   * `economic_template_no_produce` is spliced at three sites in the vendored
   * rules: `weapon_component_template` and `strike_craft_component_template`
   * (`components.cwt:189`, `:338`), and `espionage_operation.resources`
   * (`espionage.cwt:113`, not yet an exposed registry) — genuinely reusable,
   * not a two-registry special case.
   */
  | "economicResourcesNoProduce"
  | "triggeredModifierBlock"
  | "modifierBlock"
  | "weightBlock"
  /**
   * Same runtime shape as `weightBlock` — `WeightBlockWithLoc<S>`, a
   * `WeightBlock` whose `Modifier` rows require `desc` — for
   * `modifier_rule_with_loc` splices, which the CWT source comment calls
   * "deliberately more restrictive because of what we can make good
   * tooltips with" than plain `modifier_rule`.
   */
  | "weightBlockWithLoc"
  /**
   * An anonymous block with no identity: `text = { trigger = { ... } }`
   * written N times, or a single fixed-shape block like
   * `forbidden_peace_offers = { demand_surrender = ... }`. Inferred from CWT
   * block structure like `economicResources`; requestable explicitly only
   * when the heuristic needs an assist.
   */
  | "struct"
  /**
   * A named, ordered collection whose name is both identity and localisation
   * key — the same distinction `name_field` draws for top-level registries,
   * one level down.
   */
  | "repeatedStruct"
  /**
   * A block of `<weight> = <event>` rows under computed integer keys
   * (`random_events = { 100 = my_event.1  20 = 0 }`), with `0` as the
   * nothing-happens arm. The computed key is invisible to the ordinary field
   * model, so the shape must be requested.
   */
  | "weightedEvents"
  /**
   * A map keyed by engine names rather than by ids the mod invents:
   * `section_slots = { mid = { locator = ... } }`, from CWT's
   * `{ scalar = { ... } }`.
   *
   * CWT spells this identically to `repeatedStruct`'s "container" keying, and
   * the rules carry nothing that separates them — which is exactly why the
   * shape must be requested. The distinction is semantic and decided here,
   * once: a `stages` key is an id the mod owns, prefixed and localised, while
   * a `section_slots` key is `mid`, `bow`, or the integer `1`, a name the
   * engine and the ship models already agree on and that section templates
   * reference by `slot = "mid"`. Requesting `repeatedStruct` for one of these
   * would prefix `mid` out of existence and let JS reorder the numeric keys.
   */
  | "structMap"
  /**
   * The scalar-valued form of `structMap`: `min_upgrade_cost = { alloys = 20 }`
   * from CWT's `{ <resource> = float }`. Also the shape behind
   * `civic_or_origin.leader_background_job_weight` (`{ <job> = int }`).
   *
   * Computed keys are invisible to the ordinary field model, the same reason
   * `weightedEvents` must be requested.
   */
  | "scalarMap"
  /**
   * A field spliced from a non-trigger/effect CWT alias category emitted by
   * `emit/alias-struct.ts` — `government_trigger` is the only consumer so
   * far. Unlike the pure-splice categories `spliceCategory` finds on its own
   * (`trigger`, `effect`, `modifier_rule`), the category here sits alongside
   * ordinary named siblings (`potential = { text? always? alias_name[...] }`),
   * the same "combinator" shape the category's own self-recursive members
   * use — so the field lowers to that category's shared `<Name>Block`
   * interface rather than being auto-detected.
   */
  | "aliasStruct"
>;

export interface ContentFieldOverride {
  /** Omitted when the row only renames the authoring member. */
  readonly shape?: ContentFieldShape;
  readonly quoted?: boolean;
  /** The alias category to splice in, when `shape` is `"aliasStruct"`. */
  readonly category?: string;
  /**
   * The scope this field's closures run in, when CWT declares none and the
   * mechanical fallback is wrong.
   *
   * A trigger or weight-block field CWT annotates with no scope lowers to
   * `Trigger<never>` / `WeightBlock<never>` — unchecked, since `Trigger<in S>`
   * is contravariant and `never` is the top of that lattice — which is right
   * when the scope genuinely varies (a decision's own scope depends on its
   * category, see `CONTENT_SCOPE_PARAMETERS`) and leaves real checking on the
   * table when the scope is fixed but simply unannotated. A `scope` row here
   * buys that checking back for one field. `ModifierClosure` fields keep the
   * separate `ScopeName` sentinel `emit/fields.ts`'s `contravariantScopeType`
   * does not touch, since an unpinned modifier closure already resolves to a
   * real, writable recorder.
   *
   * This asserts game semantics the rules do not state, so a row needs the
   * evidence in its reason, not a guess: shape conformance's `scope` mismatch
   * kind (`corpus.ts`) walks every real definition's keys under this field and
   * reports any the asserted scope rejects. An unknown scope name fails
   * codegen rather than silently widening.
   */
  readonly scope?: string;
  /**
   * Asserts how often the key may be written, where CWT's cardinality says
   * otherwise and the corpus proves it wrong. Like {@link scope}, this states
   * game semantics the rules get wrong, so a row needs evidence and a row
   * without one is a guess.
   *
   * `"single"` narrows: `## cardinality = 0..inf` on a bare `bool` lowers to
   * `boolean[]`, a field whose only sensible authoring is one flag.
   *
   * `"repeated"` widens, and is the harder direction to catch. A field CWT
   * declares `0..1` lowers to a singular member, so a second block the game
   * writes is not merely awkward to author — it is unwritable, and the
   * definition cannot be reproduced at all. Shape conformance does not find
   * these on its own: `corpus.ts` reports an `arity` mismatch only when the
   * SDK lowered a list the corpus never repeats, never the reverse, so the
   * evidence for a `"repeated"` row is the fixture's own `repeated` count
   * (`packages/sdk/tests/fixtures/corpus/<registry>.json`) read directly.
   */
  readonly arity?: "single" | "repeated";
  /**
   * Makes the authored member optional when the CWT cardinality is known to
   * overstate its presence. This is evidence-backed like `scope` and `arity`:
   * the override corrects one generated optionality decision at its source,
   * rather than each registry growing its own exception.
   */
  readonly optional?: true;
  /** Public name for a nested struct the mechanical path-derived name misstates. */
  readonly nestedTypeName?: string;
  /**
   * Lowers a `<type>` reference to a bare, unchecked `string`.
   *
   * The rules reference types the SDK has no registry for and never will:
   * `pdxparticle.type` points at a `<particle_type>`, whose definitions live in
   * `gfx/particles/*.asset` files the SDK models as opaque Assets. Left alone
   * that field lowers to `ParticleTypeRef | string` — a union whose checked arm
   * nothing can ever produce, so it is `string` wearing a type nobody can
   * satisfy, plus a `refTypes` entry sending the fold looking for a registry
   * that does not exist. This says so outright: the member is `string`, the
   * metadata carries no `refTypes`, and the generated doc says where the real
   * ids live and that they are not checked.
   *
   * Deliberately narrow. Codegen fails unless the field's every declaration is
   * a plain `<type>` reference, because the lever must weaken exactly that one
   * check and never quietly erase a shape, an enum, or a closed union along
   * with it.
   */
  readonly uncheckedString?: true;
  readonly reason: string;
}

/**
 * Lowerings that cannot be inferred solely from the CWT value type.
 *
 * Weight blocks contain alias splices rather than ordinary fields. The quoted
 * technology prerequisite list preserves the SDK's existing byte contract.
 * Tradition swaps are nested definitions with their own localization identity.
 *
 * Modifier blocks used to be here too, 85 rows of them. They are not any more:
 * a field that splices `modifier_clause`, a `triggered_modifier*_clause` or an
 * `economic_template` carries the clause's name into the expanded block, and
 * `emit/fields.ts`'s `CLAUSE_SHAPES` reads the shape off it (SDK-142). A row
 * here still wins over that, so this table remains the place to say the
 * derivation is wrong for one field — but restating what the clause already
 * says is no longer one of its jobs.
 */
export const CONTENT_FIELD_OVERRIDES = new Map<string, ContentFieldOverride>([
  [
    "decision.custom_tooltip",
    {
      optional: true,
      reason:
        "decisions.cwt omits a cardinality annotation, but Stellaris 4.4.6 writes this block " +
        "in only 4 of 111 shipped decisions. It is an optional tooltip override, not a required " +
        "part of every decision (SDK-84 corpus evidence).",
    },
  ],
  [
    "event_chain.counter",
    {
      shape: "structMap",
      nestedTypeName: "EventChainCounterDefinition",
      reason:
        "Each counter name is an engine-visible key inside one event chain, with an optional " +
        "localisation.max block beneath it. CWT expresses that as an enum-keyed block, which is " +
        "the same engine-keyed map shape structMap already lowers for section_slots: counter " +
        "names are not content ids, take no mod prefix, and have no meaningful order.",
    },
  ],
  [
    "technology.prerequisites",
    {
      shape: "valueList",
      quoted: true,
      reason: "Technology prerequisites are conventionally quoted and existing goldens require it.",
    },
  ],
  [
    "technology.mod_weight_if_group_picked",
    {
      shape: "scalarMap",
      arity: "single",
      reason:
        "The rules declare the outer key 0..inf, but Stellaris 4.4.6 writes exactly one " +
        "block in each of 34 definitions (no repeated outer blocks), with one empty block and " +
        "33 inner rows. A single map is the sensible authoring contract and keeps the member " +
        "type, metadata, and scalarMap writer aligned. Inner keys are open " +
        "value[tech_weight_group] names (repeatable and deposit_blockers in this corpus), so " +
        "the map stays keyed by string rather than a closed union.",
    },
  ],
  [
    "technology.prereqfor_desc",
    {
      arity: "repeated",
      reason:
        "CWT declares `## cardinality = 0..1` (technologies_consolidated.cwt:241) and the " +
        "corpus contradicts it: tech_gene_expressions writes two prereqfor_desc blocks, one " +
        "per unlock tooltip, which the fixture records as `repeated: 1` of 125. The block " +
        "itself lowers with no shape row — the enum-keyed entry declaration expands to one " +
        "member per `enum[prereq_for_category]` value on its own (SDK-64) — so this row " +
        "asserts only the arity the rules get wrong.",
    },
  ],
  [
    "technology.technology_swap.prereqfor_desc",
    {
      arity: "repeated",
      reason:
        "The same declaration one level down (technologies_consolidated.cwt:164-172), with the " +
        "same `## cardinality = 0..1` and the same contradiction: the fixture records " +
        "`repeated: 2` of 28 technology_swap blocks writing theirs twice (SDK-64).",
    },
  ],
  [
    "building.ai_resource_production",
    {
      shape: "economicResourceOperation",
      reason:
        "buildings.cwt:269-276 declares one repeated operation directly: an open <resource> " +
        "numeric map, optional trigger_clause, and complex_maths_enum value fields. The 4.4.6 " +
        "install writes 60 blocks across 39 buildings; 12 definitions repeat it (1x27, 2x6, " +
        "3x3, 4x3), with no direct inner-key repeats. This is the reusable operation contract " +
        "already used by economic_template, not a building-specific map.",
    },
  ],
  [
    "tradition.tradition_swap",
    {
      shape: "repeatedStruct",
      reason:
        "A tradition swap is a repeated-struct field: a named, ordered collection whose name " +
        "(name_field, one level down) is both identity and localization key.",
    },
  ],
  [
    "ascension_perk.tradition_swap",
    {
      shape: "repeatedStruct",
      reason:
        "An ascension perk swap is a repeated-struct field: a named, ordered collection whose " +
        "name (name_field, one level down) is both identity and localization key.",
    },
  ],
  [
    "ship_size.graphical_culture",
    {
      arity: "single",
      reason:
        "Both declarations — the `<graphical_culture>` list and the bare bool — carry " +
        "`cardinality = 0..2`, which reads as `at most one of each form` rather than `write it " +
        "twice`: no shipped ship size writes the key more than once in 263 definitions. Taken " +
        "literally it makes both arms arrays, which is indistinguishable at the authoring member " +
        "and blocks the dual lowering the two declarations exist to produce.",
    },
  ],
  [
    "situation_type.on_monthly.random_events",
    {
      shape: "weightedEvents",
      reason:
        "`int = <event.scopeless>` / `int = <event.situation>` computed keys: each row is a " +
        "weight keyed to the event it fires, `0` the nothing-happens arm — the shape situations " +
        "drive their monthly narrative with.",
    },
  ],
  [
    "situation_type.stages",
    {
      shape: "repeatedStruct",
      reason:
        "A keyed container (`stages = { stage_1 = { ... } } `): a named, ordered collection whose " +
        "key is both identity and localization key, per 99_README_SITUATIONS.txt.",
    },
  ],
  [
    "situation_type.approach",
    {
      shape: "repeatedStruct",
      reason:
        "Repeated siblings carrying a name field (`approach = { name = approach_a ... }`), the " +
        "same shape tradition_swap already exercises.",
    },
  ],
  [
    "civic_or_origin.potential",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "`potential = { text? always? alias_name[government_trigger] }` is the same " +
        "text/always-plus-splice shape government_trigger's own OR/AND/limit combinators use, " +
        "so it lowers onto the shared GovernmentTriggerBlock rather than a Trigger — the game " +
        "reads this as the requirements DSL, not a script condition tree.",
    },
  ],
  [
    "civic_or_origin.possible",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "Same shape and justification as civic_or_origin.potential — `possible` is the other " +
        "government_trigger consumer governments.cwt declares alongside it.",
    },
  ],
  [
    "civic_or_origin.leader_background_job_weight",
    {
      shape: "scalarMap",
      reason:
        "`{ <job> = int }` — a job-keyed weight map. Left on the machinery backlog when the " +
        "registry landed; ship_size.min_upgrade_cost is the same shape, so the second consumer " +
        "is what made a generic scalarMap worth building.",
    },
  ],
  [
    "ship_size.section_slots",
    {
      shape: "structMap",
      reason:
        "The keys are engine names, not ids this mod owns: vanilla writes `mid`, `bow`, " +
        "`core`, `stern` and the integers 1-6, ship models expose them as locators, and " +
        'section templates reference them by `slot = "mid"`. Identical in CWT to a ' +
        "repeatedStruct container, which is why the distinction has to be declared here — " +
        "prefixing `mid` would break every reference to it. Slot order also carries no " +
        "meaning, unlike a situation's stages, so a Record is safe despite JS ordering " +
        "integer-like keys ahead of the rest.",
    },
  ],
  [
    "country_ship_of_size_limit.show",
    {
      scope: "country",
      reason:
        "CWT annotates no scope, so the mechanical reading is `Trigger<ScopeName>` — valid in " +
        "every scope — and the field is required, so every definition must carry one. All 7 " +
        "shipped entries write a country condition there (`has_technology`, `has_origin`), none " +
        "of which satisfies that type, and the field controls the country's naval-capacity " +
        "tooltip on a registry named country_ship_of_size_limit. Without this the field is " +
        "emitted but can hold nothing any real definition writes. Left here rather than pushed " +
        "upstream with SDK-85's other scope annotations: the evidence is the corpus alone — " +
        "neither the rules nor the game's documentation says which scope this trigger runs in — " +
        "which is a weaker footing than a sibling field already carrying the annotation.",
    },
  ],
  [
    "ship_size.min_upgrade_cost",
    {
      shape: "scalarMap",
      reason:
        "`{ <resource> = float }` — a resource-keyed cost map, the same shape as " +
        "civic_or_origin.leader_background_job_weight.",
    },
  ],
  [
    "species_class.possible",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "`possible = { text? always? alias_name[government_trigger] }` is the same shape SDK-3 " +
        "landed for civic_or_origin.potential/.possible, so it lowers onto the shared " +
        "GovernmentTriggerBlock rather than a Trigger — the game reads this as the requirements " +
        "DSL against empire setup (species_class.possible gates country-scoped citizenship), not " +
        "a script condition tree.",
    },
  ],
  [
    "species_class.possible_secondary",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "Same shape and justification as species_class.possible — possible_secondary is the " +
        "other government_trigger consumer species_consolidated.cwt declares alongside it.",
    },
  ],
  // The last surviving component_template row. SDK-31 gave the three registries
  // a cluster of fourteen — `resources`, `modifier` and their siblings, absent
  // here and therefore silently dropped by the writer, which is why a ported
  // SMALL_SHIELD_1 occupied a slot, cost nothing and granted nothing. Every one
  // of those fourteen was naming the clause its declaration already splices, so
  // SDK-142 derives them and they are gone, the per-registry
  // economic_template vs economic_template_no_produce split included: the
  // splice's own category picks `economicResources` or
  // `economicResourcesNoProduce`, over the arm SDK-85's subtype partition
  // leaves in this registry's body rather than over a group led by whichever
  // subtype declared the name first.
  [
    "weapon_component_template.target_weights",
    {
      shape: "scalarMap",
      reason:
        "An open scalar-keyed map of floats (`scalar = float`) from components.cwt:274-277. " +
        "Stellaris 4.4.6 writes 25 definitions / 25 blocks, 149 numeric inner rows, 0 outer " +
        "repeats, 0 duplicate inner keys, and 18 open scalar keys. The rules name a scalar " +
        "key rather than a closed enum, so keys remain string. A read-only whole-vendor scan " +
        "found 36 structurally similar computed-key scalar declarations with mixed boolean, " +
        "reference, string, and weighted-event semantics; this explicit row is intentionally " +
        "limited to weapon target_weights and does not infer utility or strike-craft paths.",
    },
  ],
  [
    "megastructure.triggered_country_modifier",
    {
      arity: "repeated",
      reason:
        "megastructures.cwt:221-223 declares the key `## cardinality = 0..1`, and the shipped " +
        "data says otherwise: the corpus fixture records `repeated: 1` of the 1 definition that " +
        "writes it (packages/sdk/tests/fixtures/corpus/megastructure.json), which is " +
        "22_shroud_seal.txt's `shroud_seal` writing two blocks — one gating " +
        "country_naval_cap_add on a relic, the second gating shroud_storm_repelling on a " +
        "technology. Two potentials cannot merge into one block, so the singular member the " +
        "rules imply leaves the second one unwritable rather than merely awkward.",
    },
  ],
  [
    "pdxparticle.type",
    {
      uncheckedString: true,
      reason:
        "particles.cwt declares `type = <particle_type>`, and `type[particle_type]` is the " +
        "`.asset` half of gfx/particles — 1,089 files holding 1,108 `particle = { name " +
        "subsystem ... }` definitions of emitter geometry, textures and shaders. The SDK " +
        "carries `.asset` files as opaque Assets and will not manifest a registry for them, " +
        "so `ParticleTypeRef` is a brand nothing can ever mint: the field is `string` either " +
        "way, and saying so drops a refTypes entry that would send the fold looking for a " +
        "registry that does not exist. All 1,740 shipped pdxparticles write it.",
    },
  ],
  [
    "pdxmesh.animation.type",
    {
      uncheckedString: true,
      reason:
        "The same shape one level down: model_entities.cwt declares `type = <model_animation>` " +
        "and `type[model_animation]` is the `.asset` half of gfx/models, opaque to the SDK for " +
        "the same reason. 3,087 of 3,257 shipped meshes write an animation block.",
    },
  ],
]);

export interface RepeatedStructDefinition {
  readonly typeName: string;
  /**
   * The body field carrying the record key, for a struct whose entries are
   * repeated sibling blocks (shape 2 — `approach = { name = approach_a ... }`).
   *
   * Only for a struct CWT gives no `type[...]` of its own. A struct that names
   * a {@link localisationType} inherits that type's `name_field`, which is the
   * same statement, and a container-keyed struct (shape 1 —
   * `stages = { stage_1 = { ... } }`) has no such field at all: the emitter
   * reads the keying off the declaration's own shape.
   */
  readonly identityKey?: string;
  /**
   * The vendored `type[...]` carrying the identity's localisation patterns
   * (`swapped_tradition` for `tradition.tradition_swap`). Omit when CWT
   * declares no such type — situations' `stages` and `approach` only type the
   * identity value itself as `localisation` inline — and the emitter falls
   * back to the same `$` required / `$_desc` optional convention those
   * vendored types themselves use.
   */
  readonly localisationType?: string;
}

export const REPEATED_STRUCT_DEFINITIONS = new Map<string, RepeatedStructDefinition>([
  [
    "tradition.tradition_swap",
    { typeName: "TraditionSwap", localisationType: "swapped_tradition" },
  ],
  [
    "ascension_perk.tradition_swap",
    { typeName: "AscensionPerkSwap", localisationType: "swapped_ascension_perk" },
  ],
  ["situation_type.stages", { typeName: "SituationStage" }],
  // `approach` is the one row whose identity key stays hand-written.
  // situations.cwt declares no `type[...]` for it, so there is no `name_field`
  // to read it off the way tradition_swap reads its own off
  // `type[swapped_tradition]`. The only upstream statement is
  // `complex_enum[situation_approach]` (situations.cwt:284-291), whose `name`
  // body — `approach = { name = enum_name }` — says where the enum harvests its
  // values from, and `readEnums` keeps only an enum's scalar values and drops a
  // complex_enum's body outright, so the parsed model does not carry it.
  ["situation_type.approach", { typeName: "SituationApproach", identityKey: "name" }],
]);

/**
 * The same overrides, for a field one level down inside a repeated struct —
 * `situation_type.approach.modifier` rather than `situation_type.modifier`.
 *
 * Empty, and kept rather than deleted. All twelve rows it held were clause
 * shapes, and every one of them said the same thing its top-level sibling said:
 * this nested field splices `modifier_clause`, or a `triggered_modifier*_clause`,
 * or `economic_template`. `emit/fields.ts` derives that from the clause name now
 * (SDK-142), and nesting changes nothing about it — `lowerOrdinary` is the same
 * function at both depths.
 *
 * A future row here would have to be something the *nesting* makes true: a
 * scope, arity or optionality that differs from the same field's top-level
 * declaration, with the corpus evidence any `scope`/`arity` row needs. Naming a
 * shape a nested field's own declaration already names is not that.
 */
export const REPEATED_STRUCT_FIELD_OVERRIDES = new Map<string, ContentFieldOverride>([]);

/**
 * Bool triggers take `(value = true)` rather than a required argument.
 *
 * Script is written `is_ai = yes` far more often than `is_ai = no`, so the
 * common case should be `isAi()`.
 */
export const BOOL_TRIGGERS_DEFAULT_TRUE = true;
