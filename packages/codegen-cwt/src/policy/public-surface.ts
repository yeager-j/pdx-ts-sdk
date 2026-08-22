/**
 * The nested content types the SDK deliberately exposes beyond the names its
 * own tables already derive.
 *
 * Everything a manifest registry, patch row, repeated-struct row, scope
 * parameter, or shape mint produces reaches the public barrel from the
 * emission that produced it. What is left is the interior of a lowered field:
 * one registry emits `PdxmeshAnimation` beside twenty other nested structs,
 * and only some of them are types an author has to name.
 *
 * The curation rule is that one sentence: a type is public because an author
 * must be able to name a value of it — it types a member of a public
 * authoring interface and no definer accepts it in another form. Internal
 * helper types and the generated `X_FIELDS` and `X_LOCALISATION` constants
 * are never public; the constants are runtime lowering tables, not authoring
 * vocabulary.
 *
 * A row naming a type its module does not export fails codegen, so the table
 * cannot outlive the emission it describes.
 */

/** One generated module and the nested types published from it. */
export interface PublicNestedTypeRow {
  /** Generated module file that declares the names, e.g. `pdxmesh.ts`. */
  readonly module: string;
  /** Exported type names re-exported through the generated public barrel. */
  readonly names: readonly string[];
  /** Audited evidence that an author has to name these types. */
  readonly reason: string;
}

/** Nested generated types published beside the table-derived public surface. */
export const PUBLIC_NESTED_TYPES: readonly PublicNestedTypeRow[] = [
  {
    module: "event-chain.ts",
    names: ["EventChainCounterDefinition"],
    reason:
      "`EventChainFields.counter` is a record of these, and the capability's own event-chain " +
      "input reuses the type to infer the declared counter names.",
  },
  {
    module: "government-trigger.ts",
    names: ["GovernmentTriggerBlock", "GovernmentTriggerClause", "GovernmentTriggerClauseGroup"],
    reason:
      "`civicOrOrigin.potential` and `.possible` are authored as a GovernmentTriggerBlock, whose " +
      "own members are the clause and clause-group templates.",
  },
  {
    module: "moon-initializer.ts",
    names: ["MoonInitializerFields"],
    reason:
      "The moon half of the planet/moon grammar a solar system initializer splices into itself. " +
      "It has no definer of its own: it is authored as an array inside " +
      "`defineSolarSystemInitializer`.",
  },
  {
    module: "pdxmesh.ts",
    names: ["PdxmeshAnimation", "PdxmeshMeshsettings"],
    reason: "`PdxmeshFields.animation` and `.meshsettings` are arrays of these.",
  },
  {
    module: "planet-initializer.ts",
    names: ["PlanetInitializerFields"],
    reason:
      "The planet half of the same grammar, mutually recursive with the moon half and authored " +
      "the same way.",
  },
  {
    module: "ship-size.ts",
    names: ["ShipSizeSectionSlots"],
    reason: "`ShipSizeFields.sectionSlots` is a record of these.",
  },
  {
    module: "special-project.ts",
    names: ["SpecialProjectRequirements", "SpecialProjectTriggeredRequirement"],
    reason: "`SpecialProjectFields.requirements` and `.triggeredRequirement` are these.",
  },
  {
    module: "sprite-type.ts",
    names: ["SpriteTypeAnimation"],
    reason: "`SpriteTypeFields.animation` is an array of these.",
  },
];
