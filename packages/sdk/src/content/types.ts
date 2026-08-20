/**
 * Consumer-facing contracts shared by generated content registries and the generic lowerer.
 */
import type { ContentReferenceName, ContentTypeName } from "../generated/content-registry.ts";
import type { ScopeObjOf } from "../generated/effects.ts";
import type {
  EconomicModifierCategory,
  EconomicModifierType,
  ScriptedModifierCategory,
} from "../generated/enums.ts";
import type { ScopedModifierBlock, ScopedModifierRecorder } from "../generated/modifiers.ts";
import type { EconomicCategoryRef } from "../generated/refs.ts";
import type { ScopeName } from "../generated/scopes.ts";
import type {
  ComplexTriggerModifier,
  ComplexTriggerModifierWithLoc,
  Modifier,
  ModifierWithLoc,
  ScriptCtx,
} from "../script/effects/types.ts";
import type { TypedRef } from "../script/scalar.ts";
import type { ScriptValue, Trigger } from "../script/trigger-core.ts";

/**
 * A content definition as a value, branded for its registry's CWT reference
 * name so it flows into matching reference fields and nowhere else.
 */
export interface ContentItem<
  K extends ContentTypeName = ContentTypeName,
  D extends { readonly id: string } = { readonly id: string },
> extends TypedRef<ContentReferenceName<K>> {
  readonly itemKind: "content";
  readonly type: K;
  readonly id: D["id"];
  readonly def: D;
  /**
   * Present only on a shape-minted definition (SDK-121): which capability
   * minted it, and under which shape.
   *
   * Informational, and deliberately not the SDK's evidence of ownership. It is
   * an ordinary public object, so a caller can attach one to any item, and a
   * check that trusted it would let a foreign definition place itself under
   * this capability. The real record lives in a module-private table written
   * only by the mint itself (`content/mint-provenance.ts`), and that is what
   * every ownership check reads. This exists so an author can *see* how a name
   * was built — in a log, a test, or a debugger — without reaching into the
   * SDK.
   */
  readonly minted?: MintProvenance;
}

/**
 * Which capability minted a shape-minted definition, and under which shape.
 *
 * See {@link ContentItem.minted}: this describes a mint, it does not certify
 * one.
 */
export interface MintProvenance {
  readonly prefix: string;
  readonly shape: string;
}

/** A contribution to a shared, non-id-keyed sink (`default = { ... }`). */
export interface ContributionItem {
  readonly itemKind: "contribution";
  readonly registry: "ship_of_size_limits";
  /** The registry the listed ids name, so own-prefixed ones can be resolved. */
  readonly refRegistry: ContentTypeName;
  readonly ids: readonly string[];
}

/**
 * The declared escape hatch for modifier names the generated tables cannot
 * know: scripted modifiers this or another mod defines. Declaration-merge the
 * names in and `raw()` accepts them — including template patterns, which admit
 * a whole generated family at once:
 *
 *     declare module "@pdx-ts/sdk" {
 *       interface CustomModifiers {
 *         readonly my_scripted_modifier?: number;
 *         readonly [k: `mymod_${string}`]: number | undefined;
 *       }
 *     }
 */
export interface CustomModifiers {}

export interface EconomicCategoryWitness {
  readonly modifierCategory?: ScriptedModifierCategory;
  readonly generateAddModifiers?: readonly EconomicModifierCategory[];
  readonly generateMultModifiers?: readonly EconomicModifierCategory[];
  readonly triggeredCostModifier?: readonly EconomicCategoryTriggeredModifierWitness[];
  readonly triggeredProducesModifier?: readonly EconomicCategoryTriggeredModifierWitness[];
  readonly triggeredUpkeepModifier?: readonly EconomicCategoryTriggeredModifierWitness[];
  readonly triggeredLogisticsModifier?: readonly EconomicCategoryTriggeredModifierWitness[];
}

/**
 * The literal part of one economic category triggered-modifier row.
 *
 * The generated row also carries `useParentIcon` and `trigger`; they remain
 * optional here so a generated row can flow through the witness without
 * widening its key or modifier-type literals.
 */
export interface EconomicCategoryTriggeredModifierWitness {
  readonly key: EconomicCategoryRef | string;
  readonly modifierTypes: readonly EconomicModifierType[];
  readonly useParentIcon?: true;
  readonly trigger?: Trigger<never>;
}

type EconomicCategoryTriggeredWitnessField =
  | "triggeredCostModifier"
  | "triggeredProducesModifier"
  | "triggeredUpkeepModifier"
  | "triggeredLogisticsModifier";

type ExactEconomicCategoryTriggeredRow<R> = R extends EconomicCategoryTriggeredModifierWitness
  ? Exclude<keyof R, keyof EconomicCategoryTriggeredModifierWitness> extends never
    ? R
    : never
  : R;

type ExactEconomicCategoryTriggeredRows<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: ExactEconomicCategoryTriggeredRow<T[K]> }
  : T;

/**
 * Keeps const-inferred economic witnesses while closing the nested triggered
 * row shape against misspelled fields. The generated row interfaces carry the
 * same four members, so this constraint stays in sync with their authoring
 * surface without reopening arbitrary nested keys.
 */
export type ExactEconomicCategoryWitness<W extends EconomicCategoryWitness> = {
  [K in keyof W]: K extends EconomicCategoryTriggeredWitnessField
    ? ExactEconomicCategoryTriggeredRows<W[K]>
    : W[K];
};

/**
 * The known modifier names for scope `S`, as one flat interface.
 *
 * This types `raw()`'s name parameter, never an authoring position: a flat
 * 45k-property type makes the editor build one enormous completion menu, which
 * is exactly what {@link ModifierClosure}'s path recorder exists to avoid.
 */
export type ModifierBlock<S extends ScopeName = ScopeName> = ScopedModifierBlock<S>;

/**
 * Records the modifiers a definition applies, scope-checked segment by segment.
 *
 * The traversed path spells the game's flat modifier name — the closure below
 * emits `country_unity_produces_mult = 0.01`:
 *
 *     modifier: (m) => m.country.unity.produces.mult(0.01)
 *
 * Each `.` completes from a small menu instead of one 45k-entry list, and a
 * typo in any segment is a compile error. Escape hatches: `m.raw(name, value)`
 * checks a flat name against every known name plus {@link CustomModifiers};
 * `m.unchecked(name, value)` accepts any string.
 */
export type ModifierClosure<S extends ScopeName = ScopeName> = (
  m: ScopedModifierRecorder<S>
) => void;

/** One cost/production/upkeep/logistics arm inside an economic `resources` block. */
export interface EconomicResourceOperation<S extends ScopeName> {
  /** Open resource ids and their numeric amounts. */
  readonly amounts: Readonly<Record<string, number>>;
  /** Optional in-game condition for applying this arm. */
  readonly when?: Trigger<S>;
  /** Repeated scripted multipliers, emitted under `multiplier`. */
  readonly multiplier?: ScriptValue | readonly ScriptValue[];
  /** Repeated scripted multipliers, emitted under the game's shorter `mult` spelling. */
  readonly mult?: ScriptValue | readonly ScriptValue[];
}

/** A reusable economic-template block used by edicts and dozens of other registries. */
export interface EconomicResourceBlock<S extends ScopeName> {
  /** Economic category used to generate modifier names and tooltips. */
  readonly category?: EconomicCategoryRef | string;
  /** Resources paid when the owning definition activates. */
  readonly cost?: EconomicResourceOperation<S>;
  /** Resources produced by the owning definition. */
  readonly produces?: EconomicResourceOperation<S>;
  /** Recurring resource upkeep. */
  readonly upkeep?: EconomicResourceOperation<S>;
  /** Logistics contribution used by the game's economic system. */
  readonly logistics?: EconomicResourceOperation<S>;
}

/**
 * {@link EconomicResourceBlock} without `produces`, for CWT's
 * `economic_template_no_produce` splice — the same open resource-name map,
 * minus the one arm that splice does not admit.
 *
 * Derived with `Omit` rather than duplicating the other three members so a
 * future change to {@link EconomicResourceBlock} (a new arm, a widened
 * `category`) flows through here automatically instead of risking drift
 * between two hand-kept copies.
 *
 * `economic_template_no_produce` is spliced at three sites in the vendored
 * rules today: `weapon_component_template` and
 * `strike_craft_component_template`'s own `resources`
 * (`components.cwt:189`, `:338`), and `espionage_operation.resources`
 * (`espionage.cwt:113`), not yet an exposed registry. This type exists so the
 * next registry that splices it gets correct typing for free rather than
 * needing its own overlay investigation.
 */
export type EconomicResourceBlockNoProduce<S extends ScopeName> = Omit<
  EconomicResourceBlock<S>,
  "produces"
>;

/**
 * The `complex_maths_enum` operations `modifier_rule.cwt:1-3` allows directly
 * alongside `base`, sibling to the `modifier`/`complex_trigger_modifier` rows
 * rather than inside one of them — the same measured member set {@link
 * Modifier} carries at row level, minus `desc`/`descKey`/`when` which only
 * make sense on a gated row. `Omit` rather than a hand-kept duplicate, so a
 * future change to `Modifier`'s numeric arms flows through here automatically,
 * the same reasoning as {@link EconomicResourceBlockNoProduce}.
 *
 * Vanilla favors this top-level spelling for a block's own always-applied
 * weight: in `common/traditions/`, 292 of 293 `weight`/`ai_weight` blocks set
 * a top-level `factor` rather than `base`, and across all `ai_weight` blocks
 * under `common/`, top-level `weight` (2,255) outnumbers `base` (848).
 */
export type WeightBlockOperations<S extends ScopeName> = Omit<
  Modifier<S>,
  "desc" | "descKey" | "when"
> & {
  readonly desc?: never;
  readonly descKey?: never;
  readonly when?: never;
};

/** The calculation performed by a `scaled_modifier` row. */
export type ScaledModifierCalc =
  "pop_amount" | "pop_happiness" | "planet_distance_empire" | "planets_in_country";

/**
 * A `scaled_modifier` row inside a {@link WeightBlock}. Its `limit` runs in
 * the scope selected by `scope`, which the game's rules leave open-ended.
 */
export interface ScaledModifier {
  readonly limit?: Trigger<never>;
  readonly scope: ScopeName;
  readonly calc: ScaledModifierCalc;
  readonly factor?: number;
  readonly add?: number;
  readonly div?: number;
  readonly mul?: number;
}

/**
 * `M` with {@link ComplexTriggerModifier}'s characteristic members
 * (`trigger`, `mode`) forbidden. Plain structural typing lets a value
 * satisfy `Modifier` (which has `when` and every numeric arm optional) and
 * *also* carry `trigger`/`mode` — TypeScript's excess-property check only
 * fires for a fresh object literal checked against a single type, not a
 * union, and not at all once the value has been assigned to a variable
 * first. Forbidding the sibling arm's members here makes the two row kinds
 * mutually exclusive structurally, not just by convention, so a hybrid value
 * is a compile error under every authoring path rather than only the
 * literal one. Applied only where the two row kinds are unioned below —
 * `Modifier` itself stays unrestricted for its other consumers
 * (`RandomListArm`, `TriggeredModifier`, `StructuralEffects.random`, ...),
 * where this ambiguity cannot arise because there is no sibling row kind to
 * collide with.
 */
type ExclusiveModifierRow<S extends ScopeName, M extends Modifier<S>> = M & {
  readonly trigger?: never;
  readonly mode?: never;
};

/** {@link ExclusiveModifierRow}'s mirror: `C` with `Modifier`'s `when` forbidden. */
type ExclusiveComplexTriggerModifierRow<
  S extends ScopeName,
  C extends ComplexTriggerModifier<S>,
> = C & {
  readonly when?: never;
};

/**
 * Every row shape a {@link WeightBlock}'s `modifiers` array can hold: a
 * gated fixed adjustment ({@link Modifier}, or {@link ModifierWithLoc} via
 * `M`), or a named trigger's result feeding a weight operation directly
 * ({@link ComplexTriggerModifier}, or {@link ComplexTriggerModifierWithLoc}
 * via `C`) — `modifier_rule.cwt`'s two splice-level row kinds (`:5-13`,
 * `:32-53`), made mutually exclusive by {@link ExclusiveModifierRow} and
 * {@link ExclusiveComplexTriggerModifierRow}.
 */
export type WeightBlockRow<
  S extends ScopeName,
  M extends Modifier<S> = Modifier<S>,
  C extends ComplexTriggerModifier<S> = ComplexTriggerModifier<S>,
> = ExclusiveModifierRow<S, M> | ExclusiveComplexTriggerModifierRow<S, C>;

/**
 * A `modifier_rule` block: optional base weight, the same weight operations
 * directly as siblings of `base` (see {@link WeightBlockOperations}), plus
 * gated adjustments.
 *
 * `M` defaults to plain {@link Modifier} (`desc` optional). `WeightBlockWithLoc`
 * below is a *separate* interface for `modifier_rule_with_loc` consumers, not
 * a `WeightBlock<S, ModifierWithLoc<S>>` instantiation — `modifier_rule_with_loc`
 * is a stricter alias than `modifier_rule` at the top level too (`:55-81` vs
 * `:1-53`), so reusing this interface's `WeightBlockOperations<S>` for it
 * would admit members `modifier_rule_with_loc` does not allow. Both are still
 * lowered through the same `weightBlock` function — the restriction is in the
 * authoring types, not the writer.
 */
export interface WeightBlock<
  S extends ScopeName,
  M extends Modifier<S> = Modifier<S>,
> extends WeightBlockOperations<S> {
  /** Starting weight before modifiers. */
  readonly base?: number;
  /** Conditional adjustments emitted as repeated `modifier` or `complex_trigger_modifier` blocks. */
  readonly modifiers?: readonly WeightBlockRow<S, M>[];
  /** Scaled adjustments emitted as repeated `scaled_modifier` blocks. */
  readonly scaledModifiers?: readonly ScaledModifier[];
}

/**
 * The `complex_maths_enum` operations `modifier_rule_with_loc.cwt:56-58`
 * allows directly alongside `base`: only `add`/`factor`, not the rest of
 * {@link WeightBlockOperations} — `modifier_rule_with_loc` is "deliberately
 * more restrictive because of what we can make good tooltips with," per the
 * CWT source comment, and that restriction bites the top-level operations
 * too, not only the row shapes below.
 */
export type WeightBlockWithLocOperations<S extends ScopeName> = Pick<
  WeightBlockOperations<S>,
  "add" | "factor"
> & {
  readonly [Key in keyof Omit<WeightBlockOperations<S>, "add" | "factor">]?: never;
};

/**
 * A {@link WeightBlock} for `modifier_rule_with_loc` consumers (e.g.
 * `situation_type.monthly_progress`): `desc` is required on every row
 * (`Modifier` rows via {@link ModifierWithLoc}, `complex_trigger_modifier`
 * rows via {@link ComplexTriggerModifierWithLoc}), and the top-level
 * operations are the narrower {@link WeightBlockWithLocOperations}. A
 * `Modifier`/`ModifierWithLoc` row's own members are unrestricted either way
 * (`modifier_rule_with_loc.cwt:59-66` still splices the full
 * `complex_maths_enum`, one member at a time) — only the top-level block and
 * the `complex_trigger_modifier` row narrow.
 */
export interface WeightBlockWithLoc<S extends ScopeName> extends WeightBlockWithLocOperations<S> {
  readonly base?: number;
  readonly modifiers?: readonly WeightBlockRow<
    S,
    ModifierWithLoc<S>,
    ComplexTriggerModifierWithLoc<S>
  >[];
}

/**
 * A script effect block recorded against the scope declared by the content
 * rules, with the ambient scopes that block runs in as a second argument.
 *
 * `From` is the scope the game hands the block as FROM, where the rules name
 * one (`## replace_scopes = { this = fleet from = archaeological_site }`):
 *
 *     onRollFailed: (fleet, ctx) => {
 *       ctx.from.effects((site) => { ... });
 *     }
 *
 * It defaults to undeclared, and `ctx.from` is then an inert sentinel rather
 * than a ref — a block whose FROM nothing describes must not be navigated.
 *
 * `Root` is the same arrangement for ROOT, and defaults to undeclared for the
 * same reason rather than to `S`: `## replace_scopes` states the whole context
 * and clears what it omits, and `## push_scope` never states ROOT at all, so
 * an unstated ROOT here is unknown — not "the block's own scope". Where the
 * rules do state it the two commonly differ, which is the point:
 * `init_effect` on a solar system initializer runs in planet scope with a
 * country as ROOT.
 */
export type EffectBlock<
  S extends ScopeName,
  From extends ScopeName | undefined = undefined,
  Root extends ScopeName | undefined = undefined,
> = (scope: ScopeObjOf<S>, ctx: ScriptCtx<S, From, Root>) => void;

/**
 * A declarative field whose rules give the block a FROM: the value itself, or
 * a closure handed the block's scopes that returns it.
 *
 *     allow: (ctx) => ctx.from.trigger(hasSiteFlag("x"))
 *
 * A trigger and a weight block are values, not closures, so there is no
 * argument list to put FROM in — this adds one. The plain form stays: a
 * condition that never names FROM has no reason to grow a closure around it.
 *
 * Emitted only where the rules name a FROM, so the type's presence on a field
 * *is* the statement that FROM means something there. The closure runs once,
 * at definition time (see `ContentAuthoring.define`), so what the definition
 * carries from then on is the ordinary value.
 *
 * `Root` rides along on the same closure where the rules also name a ROOT, on
 * {@link EffectBlock}'s terms. A field that declares ROOT but no FROM still
 * gets no closure form: the wrapper is emitted on FROM alone, so ROOT is
 * unreachable there — a pre-existing gap, not a statement about that field.
 */
export type WithFrom<
  T,
  S extends ScopeName,
  From extends ScopeName | undefined = undefined,
  Root extends ScopeName | undefined = undefined,
> = T | ((ctx: ScriptCtx<S, From, Root>) => T);

/**
 * A conditionally selected description block shared by manually authored
 * surfaces. The owning surface decides how the English text is registered as
 * localisation and may extend the block with fields its grammar admits.
 */
export interface TriggeredDescription<S extends ScopeName> {
  /** Condition under which this description is selected. */
  readonly trigger?: Trigger<S>;
  /** English text emitted as one or more repeated `text` entries. */
  readonly text?: string | readonly string[];
}

/**
 * The common potential-plus-modifiers form behind `triggered_modifier_clause`.
 *
 * The modifier body and its `potential` can run in different scopes where a
 * clause pushes scope for the condition. `PotentialScope` defaults to the
 * modifier scope for clauses whose two halves share one scope.
 */
export interface TriggeredModifier<
  ModifierScope extends ScopeName,
  PotentialScope extends ScopeName = ModifierScope,
> {
  /** In-game condition emitted under the clause's `potential` block. */
  readonly when?: Trigger<PotentialScope>;
  /** Optional localization key identifying the clause. */
  readonly key?: string;
  /** Whether the modifier remains visible when its potential fails. */
  readonly showIfNotPotential?: boolean;
  /** Replacement text shown when the potential fails. */
  readonly notPotentialOverrideTextKey?: string;
  /** Modifiers nested under an explicit `modifier` block. */
  readonly modifier?: ModifierClosure<ModifierScope>;
  /** Modifiers spliced directly into the triggered-modifier block. */
  readonly modifiers?: ModifierClosure<ModifierScope>;
  /** Optional localization key describing the modifier. */
  readonly description?: string;
  /** Values substituted into the description localization. */
  readonly descriptionParameters?: Readonly<Record<string, string>>;
  /** Hides generated modifier text in favor of `customTooltip`. */
  readonly showOnlyCustomTooltip?: boolean;
  /** Custom tooltip localization key. */
  readonly customTooltip?: string;
  /** Repeated scripted multipliers emitted under `mult`. */
  readonly mult?: ScriptValue | readonly ScriptValue[];
  /** Repeated scripted multipliers emitted under `multiplier`. */
  readonly multiplier?: ScriptValue | readonly ScriptValue[];
}

/** Generated description of one localization slot on a content definition. */
