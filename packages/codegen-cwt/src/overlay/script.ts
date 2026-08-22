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
    "name",
    "The shared name field grammar spliced into creation and mutation effects. Its one member " +
      "accepts a localisation/scalar value or a structured key with repeated variable strings.",
  ],
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
      "self-recursive OR/AND/limit combinators, emitted by " +
      "emit/content/alias-struct.ts.",
  ],
  [
    "planet_initializer",
    "The planet grammar `solar_system_initializer` splices unkeyed at its own top " +
      "level. One member, `planet`, whose declaration is a block that splices " +
      "`planet_initializer` and `moon_initializer` back into itself — so a system's " +
      "planets are anonymous, ordered and repeated, and nest without bound. Emitted " +
      "by emit/content/alias-splice.ts as `PlanetInitializerFields`, whose field table " +
      "has to be resolved through the generated alias catalog at write time because it " +
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

/** Replaces the generated TypeScript input type for one effect field. */
export interface EffectFieldTypeOverride {
  /** Replaces the mechanically derived type outright. */
  readonly type: string;
  /** Audited reason the mechanical type admits an unsafe call. */
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
    "spawn_planet",
    [
      {
        name: "modifier",
        repeated: true,
        source: "vendor/cwtools-stellaris-config/config/effects.cwt:3716-3717",
        reason:
          "CWT explicitly allows repeated modifier entries, which the shared field merge " +
          "otherwise collapses to one scalar member.",
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

/** Defines a stable generated interface for a hand-written effect overload to augment. */
export interface EffectExtensionSeam {
  /** The emitted interface the hand-written overload augments. */
  readonly interfaceName: string;
  /** The hand-written overload's display signature for script references. */
  readonly referenceSignature: string;
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
 * Bool triggers take `(value = true)` rather than a required argument.
 *
 * Script is written `is_ai = yes` far more often than `is_ai = no`, so the
 * common case should be `isAi()`.
 */
export const BOOL_TRIGGERS_DEFAULT_TRUE = true;
