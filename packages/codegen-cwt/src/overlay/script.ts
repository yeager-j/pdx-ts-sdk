/**
 * Script-surface overlay: audited departures that concern trigger, effect,
 * and modifier lowering — scope names, effect field corrections, modifier
 * category mappings, and the hand-maintained trigger/effect exceptions the
 * emitters under `emit/` read.
 *
 * See `./index.ts` for what this directory is and how a row here earns
 * its place.
 */

import type { Cardinality, RuleType } from "../cwt/model.ts";

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
    target: "job",
    placeholder: "<job>",
    selector: 'import("./refs.ts").JobRef',
    docs: ["Selects modifiers generated from a typed job reference."],
  },
  {
    family: "componentTag",
    target: "component_tag",
    placeholder: "enum[component_tag]",
    selector:
      'import("../authoring/component-tags.ts").ComponentTagItem | import("@pdx-ts/stellaris-ids").VanillaComponentTagMember',
    docs: [
      "Selects modifiers generated from an owned or packaged vanilla component tag.",
      "Use `unchecked()` with the complete flat key for a deliberate third-party tag.",
    ],
  },
] as const;

/** Complex enums that also admit an owned SDK declaration and record a typed reference. */
export const COMPLEX_ENUM_REFERENCE_OVERLAYS: ReadonlyMap<
  string,
  { readonly itemType: string; readonly target: string }
> = new Map([
  [
    "component_tag",
    {
      itemType: 'import("../authoring/component-tags.ts").ComponentTagItem',
      target: "component_tag",
    },
  ],
] as const);

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
 * Permits one loaded alias category to be authored as an ordered list of its
 * members inside a script argument block.
 */
export interface AliasCategoryScriptList {
  /** The generated union type naming one member of the category. */
  readonly typeName: string;
  /** The authoring member the list is written under. */
  readonly memberName: string;
  /** Audited reason the category is an ordered list rather than a struct. */
  readonly reason: string;
}

/**
 * Permits one loaded alias category to be authored inside a script argument
 * block through the block interface its content-side emission already
 * publishes.
 */
export interface AliasCategoryScriptBlock {
  /** Audited reason the script splice reuses the content-side surface. */
  readonly reason: string;
}

/** One alias family the rule loader reads, and the surfaces it authorises. */
export interface AliasCategoryRow {
  /** Which consumer needs the category loaded, and what its members look like. */
  readonly reason: string;
  /** Set when a script argument block may author the category as a list. */
  readonly scriptList?: AliasCategoryScriptList;
  /** Set when a script argument block may author the category as a block. */
  readonly scriptBlock?: AliasCategoryScriptBlock;
}

/**
 * Alias families the rule loader reads into a table beyond `trigger` and
 * `effect`.
 *
 * CWT declares roughly two dozen alias categories, and most of them are GUI or
 * graphics grammar with no bearing on the content registries the SDK exposes.
 * Sweeping them all in would cost parse time and, worse, invite the emitters to
 * guess at shapes nobody has read. So the loader reads a category only when a
 * content registry actually consumes it, and each row says which consumer.
 *
 * A `scriptList` or `scriptBlock` member is the second permission: a trigger or
 * effect block that splices the category unkeyed lowers to that surface, and a
 * splice of any other category stays an `unsupported-alias-splice` skip.
 */
export const EXTRA_ALIAS_CATEGORIES = new Map<string, AliasCategoryRow>([
  [
    "name",
    {
      reason:
        "The shared name field grammar spliced into creation and mutation effects. Its one " +
        "member accepts a localisation/scalar value or a structured key with repeated variable " +
        "strings.",
    },
  ],
  [
    "pop_pre_trigger",
    {
      reason:
        "Seven plain bools consumed by `job.possible_pre_triggers` (and " +
        "pop_faction_type's can_join_pre_triggers). Every member is `bool`, so the " +
        "splice lowers as an ordinary struct.",
    },
  ],
  [
    "colony_pre_trigger",
    {
      reason:
        "The colony-scoped twin of pop_pre_trigger, seven plain bools, consumed by " +
        "the planet/colony event `pre_triggers` blocks.",
    },
  ],
  [
    "government_trigger",
    {
      reason:
        "The requirements DSL behind civic/origin `potential` and `possible`. Not a " +
        "`Trigger` — its members are a fixed value/OR/NOT/NOR clause template plus " +
        "self-recursive OR/AND/limit combinators, emitted by " +
        "emit/content/alias-struct.ts.",
      scriptBlock: {
        reason:
          "`create_country.government_restrictions` splices the same category the civic and " +
          "origin registries author. One grammar, one authoring surface: the effect argument " +
          "reuses the emitted block interface and the content writer that serialises it, " +
          "rather than a second type saying the same thing.",
      },
    },
  ],
  [
    "fleet_action",
    {
      reason:
        "The fleet action queue `queue_actions` splices unkeyed. Eighteen members, from plain " +
        "scalars (`move_to`, `wait`) to blocks that splice the category back into themselves " +
        "(`repeat`, the six `find_*` searches).",
      scriptList: {
        typeName: "FleetAction",
        memberName: "actions",
        reason:
          "The queue is ordered and a member may repeat, so the members cannot be one struct " +
          "of optional keys: `wait` twice means wait twice. Each action is authored as an " +
          "object carrying exactly the one member it names.",
      },
    },
  ],
  [
    "planet_initializer",
    {
      reason:
        "The planet grammar `solar_system_initializer` splices unkeyed at its own top " +
        "level. One member, `planet`, whose declaration is a block that splices " +
        "`planet_initializer` and `moon_initializer` back into itself — so a system's " +
        "planets are anonymous, ordered and repeated, and nest without bound. Emitted " +
        "by emit/content/alias-splice.ts as `PlanetInitializerFields`, whose field table " +
        "has to be resolved through `registerAliasStructFields` at write time because it " +
        "refers to itself.",
    },
  ],
  [
    "moon_initializer",
    {
      reason:
        "The moon half of the same grammar, spliced from inside `planet` and from inside " +
        "itself. One member, `moon`. Kept separate because CWT declares it separately, " +
        "and because a moon admits a strictly smaller body — no `namelist`, no " +
        "`satellite_naming_policy`, and no nested `planet`.",
    },
  ],
]);

/** Loaded alias categories a script argument block may author, by category name. */
export const SCRIPT_ALIAS_CATEGORIES: ReadonlySet<string> = new Set(
  [...EXTRA_ALIAS_CATEGORIES]
    .filter(([, row]) => row.scriptList !== undefined || row.scriptBlock !== undefined)
    .map(([category]) => category)
);

/** Replaces a trigger's incorrect CWT summary with text from an authoritative source. */
export interface TriggerDocSummaryOverride {
  /** Replacement summary emitted in generated API documentation. */
  readonly summary: string;
  /** Repository-relative source and line range that supports the replacement. */
  readonly source: string;
  /** Audited explanation of the conflict between CWT and the source. */
  readonly reason: string;
}

/** Trigger summaries whose CWT prose disagrees with the game's documentation dump. */
export const TRIGGER_DOC_SUMMARY_OVERRIDES = new Map<string, TriggerDocSummaryOverride>([
  [
    "trait_has_any_tag",
    {
      summary: "Checks if a trait has at least one tag from the list",
      source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/triggers.log:3404-3406",
      reason:
        "The CWT summary was copied from an unrelated specimen-rarity trigger; the game's " +
        "documentation dump describes this trigger's tag-list behavior.",
    },
  ],
]);

/** Permits one trigger wrapper to keep its nested trigger in the enclosing scope. */
export interface EnclosingScopeTriggerWrapper {
  /** Repository-relative sources and line ranges that support the reading. */
  readonly source: string;
  /** Audited reason the omitted `push_scope` states the scope rather than omitting it. */
  readonly reason: string;
}

/**
 * Trigger wrappers whose nested trigger runs in the scope enclosing the wrapper.
 *
 * A pure trigger splice with no `## push_scope` is otherwise a
 * `missing-push-scope` skip, because an omitted annotation cannot be told from
 * a missing one — most such rules turned out to be defective. A row here is the
 * audited claim that the omission is the rule's meaning.
 */
export const ENCLOSING_SCOPE_TRIGGER_WRAPPERS = new Map<string, EnclosingScopeTriggerWrapper>([
  [
    "hidden_progress",
    {
      source:
        "vendor/cwtools-stellaris-config/config/triggers.cwt:1293-1301, " +
        "vendor/cwtools-stellaris-config/script-docs/v4.4.1/triggers.log:1741-1751",
      reason:
        "The body is an inline `{ alias_name[trigger] }` that iterates nothing, and the " +
        "dump describes a progress-display wrapper that nullifies the progress of the " +
        "triggers inside it. Its nested triggers evaluate on the same object.",
    },
  ],
  [
    "simple_progress",
    {
      source:
        "vendor/cwtools-stellaris-config/config/triggers.cwt:1293-1301, " +
        "vendor/cwtools-stellaris-config/script-docs/v4.4.1/triggers.log:1741-1751",
      reason:
        "The body is an inline `{ alias_name[trigger] }` that iterates nothing, and the " +
        "dump describes a progress-display wrapper that hides the progress of the " +
        "triggers inside it. Its nested triggers evaluate on the same object.",
    },
  ],
]);

/** Replaces the public input type of one scalar effect without changing its runtime lowering. */
export interface EffectValueTypeOverride {
  /** TypeScript input type emitted for the effect value. */
  readonly type: string;
  /** Audited reason the mechanical value type does not express the public contract. */
  readonly reason: string;
}

/** Adds one documented field that CWT omits from an existing effect argument block. */
export interface EffectFieldAddition {
  /** Effect argument key as written in PDXScript. */
  readonly name: string;
  /** CWT rule type used by the ordinary effect-field lowering. */
  readonly type: RuleType;
  /** Whether callers may omit the added argument. */
  readonly optional: boolean;
  /** Repository-relative source and line range that declares the field. */
  readonly source: string;
  /** Audited explanation of the omission and chosen authoring contract. */
  readonly reason: string;
}

/** Corrects the optionality, repetition, or bare-value cardinality of one effect field. */
export interface EffectFieldCardinalityOverride {
  /** Effect argument key whose cardinality is corrected. */
  readonly name: string;
  /** Overrides whether callers may omit the argument. */
  readonly optional?: boolean;
  /** Overrides whether the named key may occur more than once. */
  readonly repeated?: boolean;
  /** Overrides cardinality for anonymous values inside the argument block. */
  readonly valueList?: Cardinality;
  /** Repository-relative source and line range that supports the correction. */
  readonly source: string;
  /** Audited explanation of the mechanical cardinality error. */
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
  [
    "create_ship",
    [
      {
        name: "create_colony",
        type: { kind: "bool" },
        optional: true,
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:345-358",
        reason:
          "The game documentation accepts `create_colony = yes/no`, defaulting to yes, but " +
          "the CWT rule omits the field. The default makes the authoring member optional.",
      },
    ],
  ],
]);

/** Fields whose documented or declared cardinality is lost by mechanical lowering. */
export const EFFECT_FIELD_CARDINALITY_OVERRIDES = new Map<
  string,
  readonly EffectFieldCardinalityOverride[]
>([
  [
    "declare_war",
    [
      {
        name: "name",
        optional: true,
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:590-596",
        reason:
          "The game documentation explicitly calls the war name optional, while the CWT " +
          "alias splice has default required cardinality.",
      },
    ],
  ],
  [
    "copy_ascension_perks_from",
    [
      {
        name: "exceptions",
        valueList: { min: 0, max: null },
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:2847-2851",
        reason:
          "The game documentation shows more than one exception, while the anonymous CWT " +
          "member has default singleton cardinality.",
      },
    ],
  ],
  [
    "copy_traditions_from",
    [
      {
        name: "exceptions",
        valueList: { min: 0, max: null },
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:2840-2844",
        reason:
          "The game documentation shows more than one exception, while the anonymous CWT " +
          "member has default singleton cardinality.",
      },
    ],
  ],
  [
    "create_balanced_fleet",
    [
      {
        name: "ship_designs",
        optional: true,
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:3724-3731",
        reason:
          "The game documentation explicitly says the design list is optional, while CWT " +
          "gives the enclosing field default required cardinality.",
      },
    ],
  ],
  [
    "storm_apply_aftermath_modifier",
    [
      {
        name: "severity",
        repeated: true,
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:2662-2664",
        reason:
          "The game documentation allows up to ten severities, while CWT gives the field " +
          "default singleton cardinality.",
      },
    ],
  ],
  [
    "create_country",
    [
      {
        name: "remove_invalid_civics",
        optional: true,
        source: "vendor/cwtools-stellaris-config/script-docs/v4.4.1/effects.log:274-298",
        reason:
          "The game documentation gives the field a default of `no`, so an author who copies " +
          "no civics has nothing to say about it. It is the one field of the CWT block with " +
          "no cardinality annotation, which makes it required.",
      },
    ],
  ],
]);

/**
 * Scalar effects whose public input type intentionally differs from mechanical
 * rule lowering.
 *
 * Not for refusing a declared witness on the fallback beneath a hand-written
 * overload: `emit/script/effects.ts` derives that from
 * {@link EFFECT_EXTENSION_SEAMS} and the registry's own witness, for every
 * argument of every seam effect.
 */
export const EFFECT_VALUE_TYPE_OVERRIDES = new Map<string, EffectValueTypeOverride>([
  [
    "set_situation_approach",
    {
      type: 'SituationApproach | import("../content/situations.ts").SituationApproach<string, string>',
      reason:
        "An approach declared by a situation definition callback is a typed scalar reference. " +
        "The runtime scalar lowering already unwraps its id, so the generated setter accepts " +
        "that reference alongside vanilla and third-party approach ids.",
    },
  ],
]);

/** Defines a stable generated interface for a hand-written effect overload to augment. */
export interface EffectExtensionSeam {
  /** The emitted interface the hand-written overload augments. */
  readonly interfaceName: string;
  /** The hand-written overload's display signature for script references. */
  readonly referenceSignature: string;
  /** Whether the extension overload is parameterized by the scope receiving the effect. */
  readonly receivingScope?: boolean;
  /** Named receiving-scope union used by both generated and hand-written interface declarations. */
  readonly receivingScopeType?: {
    /** Exported receiving-scope union name. */
    readonly type: string;
    /** Module that exports the receiving-scope union. */
    readonly module: string;
  };
  /** Audited contract that requires the hand-written overload. */
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
 *
 * The row is also what makes the generated fallback refuse a declared
 * contract: for every argument of a seam effect, a reference to a registry
 * whose items carry a witness (`hostScope`, `targetScope`, `locationScope`) is
 * emitted as `(XRef & { <witness>?: never }) | string`, so an authored item
 * can only be accepted by the overload that checks it. Nothing else changes —
 * `EFFECT_META`, `refTypes`, and the runtime recording all still come from the
 * rules' own lowering — so the refusal narrows the accepted inputs and never
 * the emitted script.
 */
export const EFFECT_EXTENSION_SEAMS = new Map<string, EffectExtensionSeam>([
  [
    "add_modifier",
    {
      interfaceName: "AddModifierEffectsExtension",
      referenceSignature:
        'addModifier<S extends StaticModifierScope>(args: Omit<AddModifierArgs, "modifier"> & { modifier: Unambiguous<S, StaticModifierHostContract<S>> }): void;',
      receivingScope: true,
      receivingScopeType: { type: "StaticModifierScope", module: "./static-modifier.ts" },
      reason:
        "`addModifier` checks an SDK-authored static modifier's declared hostScope against the " +
        "scope receiving the effect (src/script/effects/static-modifiers.ts).",
    },
  ],
  [
    "add_stage_modifier",
    {
      interfaceName: "AddStageModifierEffectsExtension",
      referenceSignature:
        'addStageModifier<S extends StaticModifierScope>(args: Omit<AddStageModifierArgs, "modifier"> & { modifier: Unambiguous<S, StaticModifierHostContract<S>> }): void;',
      receivingScope: true,
      receivingScopeType: { type: "StaticModifierScope", module: "./static-modifier.ts" },
      reason:
        "`addStageModifier` checks an SDK-authored static modifier's declared hostScope against " +
        "the scope receiving the effect (src/script/effects/static-modifiers.ts).",
    },
  ],
  [
    "export_modifier_duration_to_variable",
    {
      interfaceName: "ExportModifierDurationToVariableEffectsExtension",
      referenceSignature:
        'exportModifierDurationToVariable<S extends StaticModifierScope>(args: Omit<ExportModifierDurationToVariableArgs, "modifier"> & { modifier: Unambiguous<S, StaticModifierHostContract<S>> }): void;',
      receivingScope: true,
      receivingScopeType: { type: "StaticModifierScope", module: "./static-modifier.ts" },
      reason:
        "`exportModifierDurationToVariable` checks an SDK-authored static modifier's declared " +
        "hostScope against the scope receiving the effect (src/script/effects/static-modifiers.ts).",
    },
  ],
  [
    "remove_modifier",
    {
      interfaceName: "RemoveModifierEffectsExtension",
      referenceSignature:
        "removeModifier<S extends StaticModifierScope>(value: Unambiguous<S, StaticModifierHostContract<S>>): void;",
      receivingScope: true,
      receivingScopeType: { type: "StaticModifierScope", module: "./static-modifier.ts" },
      reason:
        "`removeModifier` checks an SDK-authored static modifier's declared hostScope against " +
        "the scope receiving the effect (src/script/effects/static-modifiers.ts).",
    },
  ],
  [
    "remove_stage_modifier",
    {
      interfaceName: "RemoveStageModifierEffectsExtension",
      referenceSignature:
        "removeStageModifier<S extends StaticModifierScope>(value: Unambiguous<S, StaticModifierHostContract<S>>): void;",
      receivingScope: true,
      receivingScopeType: { type: "StaticModifierScope", module: "./static-modifier.ts" },
      reason:
        "`removeStageModifier` checks an SDK-authored static modifier's declared hostScope " +
        "against the scope receiving the effect (src/script/effects/static-modifiers.ts).",
    },
  ],
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
  [
    "enable_mission",
    {
      interfaceName: "EnableMissionEffectsExtension",
      referenceSignature:
        'enableMission<L extends MissionLocationScope>(args: Omit<EnableMissionArgs, "name" | "location"> & { name: Unambiguous<L, MissionLocationContract<L>>; location: ScopeValue<NoInfer<L>> }): void;',
      reason:
        "`enableMission` checks its `location` against the mission's author-declared " +
        "`locationScope`, which also types the contract-location ambient scope in callbacks " +
        "(src/script/effects/missions.ts).",
    },
  ],
  [
    "issue_contract",
    {
      interfaceName: "IssueContractEffectsExtension",
      referenceSignature:
        'issueContract<L extends MissionLocationScope>(args: Omit<IssueContractArgs, "contract" | "location"> & { contract: Unambiguous<L, MissionLocationContract<L>>; location: ScopeValue<NoInfer<L>> }): void;',
      reason:
        "`issueContract` checks its `location` against the contract mission's author-declared " +
        "`locationScope`, which also types the contract-location ambient scope in callbacks " +
        "(src/script/effects/missions.ts).",
    },
  ],
]);

/**
 * Bool triggers take `(value = true)` rather than a required argument.
 *
 * Script is written `is_ai = yes` far more often than `is_ai = no`, so the
 * common case should be `isAi()`.
 */
export const BOOL_TRIGGERS_DEFAULT_TRUE = true;
