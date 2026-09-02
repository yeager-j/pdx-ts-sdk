/**
 * Registry-identity overlay rows: the witness a registry's item type carries
 * beside its def, subtype-qualified references and vanilla id projections,
 * and the canonical file stems SDK-121 fixed.
 *
 * See `./index.ts` for what this directory is and how a row here earns its
 * place.
 */

/**
 * The `W` witness a registry's item type and definer carry beside its def —
 * SDK-181's "rides beside the def" rule applied to the two registries whose
 * generated `Def` field is mechanically typed too wide for the recorder logic
 * that reads it back.
 *
 * `scripted_modifier`'s `category` is already a real, narrow enum member, so
 * `wraps` only needs to intersect the def with `{ readonly [member]: W }`:
 * `ScriptedModifierSelector` (`emit/script/modifiers.ts`) reads the author's
 * literal category back off `item.def.category` to check it against the scope
 * a `raw()`/typed setter call is made from, which the def's own declared
 * `ScriptedModifierCategory` union cannot supply.
 *
 * `economic_category`'s seven generated-key fields (`modifierCategory`,
 * `generateAddModifiers`, `generateMultModifiers`, and the four
 * `triggered*Modifier` rows, SDK-233) are declared on the ordinary def too,
 * but a mechanical field can only ever carry its CWT shape, never the
 * specific literal array or category an author writes — and
 * `EconomicCategoryRecorder`/`EconomicWitnessOf` need exactly that literal to
 * know which modifier-setter methods a given category may call. `intersects`
 * strips the mechanical members with `Omit` and re-admits them through a
 * `const`-inferred `W`, guarded by `exactType` so the nested triggered rows
 * stay closed against misspelled fields, so the literal rides the item and
 * definer input/result instead of the widened mechanical field.
 *
 * `omit` is the one list both consumers read: `planRegistryDefiner`
 * (`emit/content/definer-plan.ts`) spells it as the `Omit<...>` member union, and
 * `emit/script/modifiers.ts`'s
 * `EconomicWitnessOf` reads each row's own `inferAs` to name the per-member
 * `infer` variable in its structural extraction type. Before SDK-260 the same
 * seven names were hand-spelled in both places and could drift silently.
 */
export type ContentWitness =
  | {
      /** Narrows one existing def member by intersecting its authored literal type. */
      readonly mode: "wraps";
      /** Witness type name, e.g. `ScriptedModifierCategory`. */
      readonly type: string;
      /** Module the witness type imports from; omit for a TypeScript primitive. */
      readonly module?: string;
      /** The def member the witness narrows. */
      readonly member: string;
      /** Audited reason the def must retain this literal witness. */
      readonly reason: string;
    }
  | {
      /** Replaces selected mechanical members with a const-inferred witness intersection. */
      readonly mode: "intersects";
      /** Witness type name, e.g. `EconomicCategoryWitness`. */
      readonly type: string;
      /** The `Exact<W>` guard type applied at every definer/capability input position. */
      readonly exactType: string;
      /**
       * The def members `Omit` strips before intersecting with `W`, in
       * emission order, each with the per-member `infer` variable
       * `EconomicWitnessOf` gives it.
       */
      readonly omit: readonly {
        /** Mechanical def member replaced by the witness. */
        readonly member: string;
        /** Local type variable used when extracting this member from the witness. */
        readonly inferAs: string;
      }[];
      /** Audited reason the def must retain these literal witness members. */
      readonly reason: string;
    };

/**
 * Registries whose item type and definer carry a `W` witness beside the def,
 * rather than the mechanical, unparameterised signature every other registry
 * gets. A row here is expensive: it is read by both definer planning
 * (`emit/content/definer-plan.ts`) and modifier emission
 * (`emit/script/modifiers.ts`), so a new mode needs evidence from a
 * second registry before this schema grows to fit it.
 */
export const CONTENT_WITNESSES = new Map<string, ContentWitness>([
  [
    "scripted_modifier",
    {
      mode: "wraps",
      type: "ScriptedModifierCategory",
      module: "./enums.ts",
      member: "category",
      reason:
        "SDK-230: category selects which scopes this modifier is legal in " +
        "(SCRIPTED_MODIFIER_CATEGORY_MAP), and ScriptedModifierSelector checks that against the " +
        "scope a raw()/typed setter call is made from — a check that needs the author's literal " +
        "category, not ScriptedModifierCategory's full union.",
    },
  ],
  [
    "economic_category",
    {
      mode: "intersects",
      type: "EconomicCategoryWitness",
      exactType: "ExactEconomicCategoryWitness",
      omit: [
        { member: "modifierCategory", inferAs: "M" },
        { member: "generateAddModifiers", inferAs: "A" },
        { member: "generateMultModifiers", inferAs: "U" },
        { member: "triggeredCostModifier", inferAs: "C" },
        { member: "triggeredProducesModifier", inferAs: "P" },
        { member: "triggeredUpkeepModifier", inferAs: "U" },
        { member: "triggeredLogisticsModifier", inferAs: "L" },
      ],
      reason:
        "SDK-230/SDK-233: EconomicCategoryRecorder and the triggered-modifier selectors decide " +
        "which modifier-setter methods a category may call from the literal arrays and category " +
        "the author writes for these seven fields, which a mechanically-typed Def field cannot " +
        "carry. defineEconomicCategory Omits the mechanical members and re-admits them through a " +
        "const-inferred W instead.",
    },
  ],
  [
    "mission_category",
    {
      mode: "wraps",
      type: "boolean",
      member: "isContract",
      reason:
        "The mission definer distinguishes authored contract categories from ordinary ones and " +
        "requires eventChain only for the former, so the literal is_contract value must survive " +
        "instead of widening back to boolean on the returned item.",
    },
  ],
]);

/**
 * Preserves a qualified CWT subtype reference when a definition selects that subtype.
 * The refined capability result remains assignable to fields that require the qualified reference.
 */
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
  [
    "mission_category",
    {
      member: "isContract",
      reference: "mission_category.contract",
      reason:
        "A mission using an SDK-authored contract category must require event_chain and expose " +
        "contract-only fields, so is_contract = yes must survive as a qualified reference.",
    },
  ],
]);

/**
 * An install-derived subtype projection for a shared content registry.
 * The discriminator is read from each installed definition, and the projected id set backs a
 * subtype-specific checked vanilla reference helper.
 */
export interface VanillaSubtypeReferenceProjection {
  /** Shared registry whose installed definitions are partitioned. */
  readonly registry: string;
  /** CWT subtype and public helper name. */
  readonly subtype: string;
  /** Scalar definition member that selects the subtype. */
  readonly member: string;
  /** Scalar value that selects the subtype. */
  readonly value: string;
  /** Whether definitions without the discriminator member select this subtype. */
  readonly includeAbsent: boolean;
  /** Why the broad registry reference is insufficient. */
  readonly reason: string;
}

/**
 * Shared registries whose installed definitions produce subtype-specific vanilla id sets.
 *
 * These rows are the one authority used by both generators: `codegen-vanilla` partitions the
 * installed ids, and `codegen-cwt` emits the checked helpers that consume those partitions.
 */
export const VANILLA_SUBTYPE_REFERENCE_PROJECTIONS: readonly VanillaSubtypeReferenceProjection[] = [
  {
    registry: "civic_or_origin",
    subtype: "civic",
    member: "is_origin",
    value: "no",
    includeAbsent: true,
    reason:
      "has_civic and other civic-only consumers require civic_or_origin.civic, while the shared " +
      "registry helper returns civic_or_origin.",
  },
  {
    registry: "civic_or_origin",
    subtype: "origin",
    member: "is_origin",
    value: "yes",
    includeAbsent: false,
    reason:
      "has_origin and other origin-only consumers require civic_or_origin.origin, while the " +
      "shared registry helper returns civic_or_origin.",
  },
];

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
 * Subtype arms the generator reads flat although their selector is readable,
 * because the installed game contradicts the arm: shipped definitions carry a
 * field the arm reserves for the other side, or omit one it requires. A union
 * there would refuse definitions the game itself ships. Keyed
 * `<registry>.<subtype>`; the reason states the measurement, so a rule fix in
 * the vendored config can retire the row.
 *
 * Every row must name a subtype some top-level declaration sits under, and is
 * audited as applied like every other overlay row.
 */
export const FLAT_SUBTYPE_ARMS = new Map<string, string>([
  [
    "ship_size.bio_ship",
    "Stellaris 4.4.6 ships 2 of 286 non-bio ship sizes carrying " +
      "`bioship_growth_progress_required`, which `subtype[bio_ship]` reserves for bio ships.",
  ],
  [
    "opinion_modifier.triggered_opinion_modifier",
    "Stellaris 4.4.6 ships 3 of 114 triggered opinion modifiers carrying `min`, and one " +
      "carrying `decay` and `accumulative`, which `subtype[!triggered_opinion_modifier]` " +
      "reserves for untriggered ones.",
  ],
]);
