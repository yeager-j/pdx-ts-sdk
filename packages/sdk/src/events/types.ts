/**
 * Typed event definitions with an ambient scope contract.
 *
 * An event declares its ambient scopes (`scopes: { from: "country" }`) as a
 * phantom type. Every fire site then supplies a witness for every declared
 * FROM slot. Natural event FROM is the firing execution's ROOT, so `ctx.root`
 * is the usual witness; a known split-root block cannot use `ctx.self` for
 * that claim. A witness that names another ref emits the game's `scopes`
 * override block. PREV scopes are game-supplied and cannot be overridden by
 * typed explicit fires.
 *
 * Event closures run eagerly, inside define: errors carry the author's
 * stack, and cross-references require definition order the same way
 * technology `prerequisites` already do.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";

import type {
  KeyedLocalization,
  LocalizationRef,
  LocalizationTranslations,
  LocalizedText,
} from "../authoring/localization.ts";
import type { TriggeredDescription } from "../content/types.ts";
import type { ModWarning } from "../diagnostics.ts";
import type {
  GeneratedEventFields,
  GeneratedEventOptionFields,
} from "../generated/event-fields.ts";
import type { SoundEffectRef, SpriteRef } from "../generated/refs.ts";
import type { ScopeName } from "../generated/scopes.ts";
import type { RecordedRefUse } from "../references.ts";
import {
  type AmbientScopeContext,
  type AmbientScopeKey,
  type FireFromWitness,
  type Modifier,
  type ScopeRef,
  type ScopeValue,
  type ScriptCtx,
} from "../script/effects/types.ts";
import type { TypedRef } from "../script/scalar.ts";
import type { Trigger } from "../script/trigger-core.ts";
// The typed fire signatures for every event kind are generated into the
// scope interfaces — this side-effect import is what loads the augmentation.
import "../generated/event-fires.ts";

declare const eventFromBrand: unique symbol;
declare const eventScopeBrand: unique symbol;

/**
 * A defined event as finished compiler input. Its definition-side
 * localization, references, and warnings travel with the event value.
 */
export interface EventItemBase {
  readonly itemKind: "event";
  readonly kind: "event-ref";
  readonly namespace: string;
  readonly scope: ScopeName;
  readonly scopes: AmbientScopeContext;
  /** The full id, e.g. `pp_mod_ascension.2`. */
  readonly id: string;
  readonly entry: PdxEntry;
  readonly refs: readonly RecordedRefUse[];
  /**
   * The localization keys this event minted, as references — the same value
   * {@link DefinedEvent.loc} carries, surviving into `PureMod.events` so a
   * compiled mod can be read for them as well as an authored event.
   */
  readonly loc: EventLoc;
  readonly locEntries: readonly KeyedLocalization[];
  readonly warnings: readonly ModWarning[];
}

/** Whether an authored value is a complete event item rather than a bare event reference. */
export function isAuthoredEvent(value: unknown): value is EventItemBase {
  return (
    typeof value === "object" && value !== null && "itemKind" in value && value.itemKind === "event"
  );
}

/**
 * What an event definer returns, preserving its scope, FROM, and event-kind
 * contracts for fire sites and on-action bindings.
 */
export type EventItem<
  S extends ScopeName = ScopeName,
  Context extends AmbientScopeContext = AmbientScopeContext,
  Kind extends string = S,
> = DefinedEvent<S, Context, Kind> & {
  readonly itemKind: "event";
  readonly namespace: string;
  readonly locEntries: readonly KeyedLocalization[];
};

/**
 * A defined event, usable as the `id` of a fire effect. Its ambient context is
 * the contract the event declares for every named scope slot.
 *
 * It is a `TypedRef` for its own scope's event subtype, which is what makes an
 * event flow into the reference fields that take one — an archaeology stage's
 * `event` is `<event.fleet>`, and a country event is not that. Without the
 * brand an event was structurally a `TypedRef` for *every* registry, since the
 * brand is optional and `id: string` was the whole of the rest: a country event
 * satisfied `<event.fleet>`, and a `<technology>` field too.
 *
 * `Kind` is the CWT subtype the event's own definer declares, which is what
 * the rules name a reference after. It is not always the scope the body runs
 * in: `observer_event` is subtype `observer` in country scope, and
 * `cosmic_storm_event` is subtype `cosmic_storm` in storm scope. Branding by
 * scope would make an observer event an `<event.country>` and leave it unable
 * to satisfy the reference the rules actually write for it, so the definers
 * pass their subtype and it defaults to the scope only for the kinds where the
 * two coincide.
 */
export interface EventRef<
  S extends ScopeName = ScopeName,
  Context extends AmbientScopeContext = AmbientScopeContext,
  Kind extends string = S,
> extends TypedRef<`event.${Kind}`> {
  readonly kind: "event-ref";
  /** The full id, e.g. `hello_galaxy.2`. */
  readonly id: string;
  /** Scope and ambient chains are compile-time contracts; bare references carry no runtime metadata. */
  readonly [eventScopeBrand]?: S;
  /** Keeps the full ambient contract invariant at typed fire and hook boundaries. */
  readonly [eventFromBrand]?: (context: Context) => Context;
}

/**
 * An `option.icon` block (`events.cwt:338`): a display icon overriding the
 * option row's default, with its own optional caption.
 */
export interface EventOptionIcon {
  readonly icon: SpriteRef | string;
  readonly iconBackground?: SpriteRef | string;
  /** Caption text, keyed off the option's own key the same way `name` is. */
  readonly text?: LocalizedText;
}

/**
 * An `option.ai_chance` block (`events.cwt:358`): the same `modifier_rule`
 * shape `Modifier`/`modifierEntry` (`script/effects/modifiers.ts`) already lower, with the
 * base weight spelled `factor` — the arm the corpus actually uses at this
 * position (vanilla `ai_chance` blocks open `factor = <n>`, not `base = <n>`,
 * unlike `situation_type.monthly_progress`'s `WeightBlock`).
 */
export interface AiChance<S extends ScopeName> {
  readonly factor?: number;
  readonly modifiers?: readonly Modifier<S>[];
}

/**
 * One repeated `desc = { ... }` block on an event. The common trigger/text
 * shape is shared with other manually authored fields; events additionally
 * admit an exclusive trigger and a sound selected with this description.
 */
export interface EventTriggeredDescription<S extends ScopeName> extends TriggeredDescription<S> {
  /** Replaces other description text when this condition passes. */
  readonly exclusiveTrigger?: Trigger<S>;
  /** Sound played when this description is selected. */
  readonly showSound?: SoundEffectRef | string;
}

/**
 * One `option = { ... }` row.
 *
 * The option has no id of its own, so its localization keys — the name, the
 * icon caption, the response, and every AI-chance modifier desc — hang off a
 * suffix taken from the name's own `key` pin, or from a hash of the English
 * name when none is given, which also raises an `unstable-option-key` warning.
 */
export type EventOption<
  S extends ScopeName,
  Context extends AmbientScopeContext,
> = GeneratedEventOptionFields<S, Context>;

/**
 * A `location` value (`events.cwt:308`, `scope_field`): either a fixed
 * {@link ScopeValue} or a closure handed the event's FROM/self context that
 * returns one, the same `WithFrom`-style dual `content/schema.ts` uses for
 * declarative fields that can want FROM — `location: (ctx) => ctx.from` is
 * the dig-stage idiom (every vanilla archaeology-site event opens
 * `location = from`). A plain value covers the rest: a saved
 * `eventTarget`, `ctx.self`, or — the situation-event idiom, and the
 * commonest `location` in vanilla by a wide margin — `location: target()`,
 * the value form of the `target` link (`script/triggers.ts`).
 */
export type EventLocation<S extends ScopeName, Context extends AmbientScopeContext> =
  | ScopeValue<ScopeName>
  | ((ctx: ScriptCtx<S, EventBodyContext<S, Context>>) => ScopeValue<ScopeName>);

/**
 * A `situation` value (`events.cwt:399`, `scope[situation]`): the same fixed
 * {@link ScopeValue}-or-FROM-closure dual as {@link EventLocation}. A saved
 * `eventTarget<"situation">` covers the common case, but the CWT-legal
 * `situation = from` form — a non-situation event fired from a situation —
 * needs `ctx.from`, which only exists inside the closure form; without it,
 * authoring `situation = from` meant forging the internal `ScopeValue` shape
 * by hand.
 */
export type EventSituation<S extends ScopeName, Context extends AmbientScopeContext> =
  | ScopeValue<"situation">
  | ((ctx: ScriptCtx<S, EventBodyContext<S, Context>>) => ScopeValue<"situation">);

/**
 * A `mean_time_to_happen` block (`events.cwt:456`, `subtype[!triggered]`):
 * days/months/years plus the same `modifier_rule` modifier rows
 * `Modifier`/`modifierEntry` (`script/effects/modifiers.ts`) already lower elsewhere.
 * Declared under `subtype[!triggered]` in the rules, but accepted
 * unconditionally here — like `hideWindow`/`isTriggeredOnly`/`picture`
 * before it, an attribute-driven subtype (gated by another field's *value*,
 * not by the event's kind) is not worth a second generic parameter to
 * enforce; setting it alongside `isTriggeredOnly: true` is simply inert in
 * game, the same way the CWT-declared exclusivity already is for those
 * fields.
 */
export interface MeanTimeToHappen<S extends ScopeName> {
  readonly years?: number;
  readonly months?: number;
  readonly days?: number;
  readonly modifiers?: readonly Modifier<S>[];
}

/**
 * A `weight_multiplier` block (`events.cwt:448-452`, `subtype[triggered]`):
 * the same `modifier_rule` shape as {@link MeanTimeToHappen}'s modifier rows,
 * with a leading `factor` in place of days/months/years. Declared under
 * `subtype[triggered]`, but — like `meanTimeToHappen`'s `subtype[!triggered]`
 * — that is an attribute subtype driven by `isTriggeredOnly`'s own value, not
 * by the event's kind, so it stays an unconditional field rather than a
 * second `S`-conditioned generic parameter.
 *
 * `factor` is required, not optional: `events.cwt:448` declares `factor =
 * float` with no `## cardinality` annotation immediately above it, unlike
 * the `alias_name[modifier_rule]` line right below it which is explicitly
 * `0..100` — the rules' convention for an unannotated field is cardinality
 * `1..1`. An optional `factor` would let the SDK silently emit a
 * `weight_multiplier` the game rejects for missing its required member.
 */
export interface WeightMultiplier<S extends ScopeName> {
  readonly factor: number;
  readonly modifiers?: readonly Modifier<S>[];
}

/**
 * `event_window_type` (`events.cwt:287-288`, `enum[event_window_type]`): the
 * four leader-conversation window styles the enum block at the bottom of
 * `events.cwt` declares. A closed, small vocabulary with no existing
 * generated home, so it is inlined here rather than routed through the
 * content-registry enum machinery.
 */
export type EventWindowType =
  "leader_recruit" | "leader_story" | "leader_conversation" | "crisis_leader_conversation";

export interface EventDef<
  S extends ScopeName,
  Context extends AmbientScopeContext,
> extends GeneratedEventFields<S, NoInfer<Context>> {
  /**
   * The ambient scopes this event expects when it runs. Emits nothing — it is
   * the compile-time contract checked at fire sites and on-action bindings.
   */
  readonly scopes?: Context;
}

/** The execution context every event body receives. ROOT defaults to the event scope. */
export type EventBodyContext<
  S extends ScopeName,
  Context extends AmbientScopeContext,
> = Context extends { readonly root: ScopeName } ? Context : Context & { readonly root: S };

export type DefinedEvent<
  S extends ScopeName,
  Context extends AmbientScopeContext,
  Kind extends string = S,
> = EventRef<S, Context, Kind> & {
  /** Runtime metadata carried by an authored definition, not a bare reference. */
  readonly scope: S;
  readonly scopes: Context;
  readonly entry: PdxEntry;
  /** The localization keys this event minted, as references. */
  readonly loc: EventLoc;
  /**
   * Content references the event's closures and option conditions wrote. The
   * closures ran here, at the definition site, so the recorder's report is
   * captured here too — `buildMod` resolves it against the ids the build
   * defined, exactly as it does for declarative content fields.
   */
  readonly refs: readonly RecordedRefUse[];
  /**
   * Diagnostics collected at define time. They can contain `unstable-desc-key`
   * entries for unpinned modifier descriptions and `unstable-option-key`
   * entries for options without an explicit key.
   * Events have no `ContentAuthoring` instance to hang `onUnstableDescKey`
   * off — they are built at the definer call site, before `buildMod` ever
   * runs — so this rides along the same way `refs` and `locEntries` do:
   * `event-definers.ts`'s generated `definerOf` spreads `built` into the
   * returned item, `EventItemBase.warnings` carries it from there, and
   * `buildMod` drains it into `mod.warnings` alongside `registerLocEntries`.
   */
  readonly warnings: readonly ModWarning[];
};

/** One authored event option's minted localization key, as a reference. */
export interface EventOptionLoc {
  /** The key the option's own `name` text is emitted under. */
  readonly name: LocalizationRef;
}

/**
 * The localization keys an event mints, for embedding its text elsewhere —
 * with the `loc` template tag, or in any field that names a key.
 *
 * `title` and `desc` are absent unless the event supplied that text. An event
 * lowers inside its definer, unlike a content definition, so what it set is
 * already known here and a key with no entry behind it need never be offered.
 *
 * @example
 * ```ts
 * const contact = mod.namespace("story").country(1, {
 *   title: "First Contact",
 *   isTriggeredOnly: true,
 *   options: [{ name: { english: "Answer.", key: "answer" } }],
 * });
 *
 * contact.loc.title?.key; // "hello_galaxy_story.1.name"
 * contact.loc.options[0]!.name.key; // "hello_galaxy_story.1.answer"
 * ```
 */
export interface EventLoc {
  /** Absent unless the event set `title`. */
  readonly title?: LocalizationRef;
  /** Absent unless the event set `desc`. */
  readonly desc?: LocalizationRef;
  /** One entry per authored option, in the order the options were written. */
  readonly options: readonly EventOptionLoc[];
}

/** Where definition-side localization lands; the caller supplies its registry. */
export interface LocSink {
  register(key: string, translations: LocalizationTranslations): void;
}

// ---------------------------------------------------------------------------
// Fire effects: typed signatures over the runtime encoders
// ---------------------------------------------------------------------------

export interface FireEventArgs<
  S extends ScopeName,
  Context extends AmbientScopeContext,
  Kind extends string = S,
> {
  /**
   * The event to fire. `Kind` pins it to the subtype this fire effect writes:
   * `observer_event = { id = ... }` dispatches an observer event, and an
   * ordinary country event is not one however alike their scopes are.
   */
  readonly id: EventRef<S, Context, Kind> | string;
  readonly days?: number;
  readonly months?: number;
  readonly years?: number;
  /** Random extra delay from 0 to this many days, added to `days`. */
  readonly random?: number;
}

export interface WitnessedFireEventArgs<
  S extends ScopeName,
  Context extends AmbientScopeContext,
  Kind extends string = S,
> extends FireEventArgs<S, Context, Kind> {
  /**
   * Proof the fired event's declared FROM chain is satisfied: usually
   * `ctx.self` for immediate FROM. Every deeper FROM slot requires an absolute
   * {@link ScopeRef}, because relative `this` can change before the fire runs.
   * `NoInfer` keeps the event ref the single inference source, so a
   * wrong-scope witness fails instead of unifying.
   */
  readonly scopes: FireScopeWitnesses<NoInfer<ExplicitFireContext<Context>>>;
}

type FireScopeKey = Exclude<AmbientScopeKey, "root" | `prev${string}`>;

/** Explicit scope overrides for fire effects; PREV chains are game-supplied only. */
export type FireScopeWitnesses<Context extends AmbientScopeContext> = {
  readonly [Key in FireScopeKey as Key extends keyof Context ? Key : never]: Key extends "from"
    ? FireFromWitness<Extract<Context[Key], ScopeName>>
    : ScopeRef<Extract<Context[Key], ScopeName>>;
};

type ExplicitFireContext<Context extends AmbientScopeContext> =
  Extract<keyof Context, "root" | `prev${string}`> extends never ? Context : never;
