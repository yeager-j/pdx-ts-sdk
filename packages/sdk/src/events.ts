/**
 * Typed event definitions with the FROM contract.
 *
 * An event declares the scope it expects FROM to be (`from: "country"`) as a
 * phantom type; every fire site is then checked against it by passing a
 * witness value — usually `ctx.self`, proving the firing event's own scope is
 * the FROM the target expects. A witness that is any other ref emits the
 * game's own `scopes = { from = ... }` override block. Validated by the
 * probe: see `docs/verdict-effects-probe.md` (including why the witness needs
 * `NoInfer` and why an undeclared FROM is a sentinel rather than `never`).
 *
 * Event closures run eagerly, inside define: errors carry the author's
 * stack, and cross-references require definition order the same way
 * technology `prerequisites` already do.
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import { underField, type ContentRefUse } from "./content-refs.ts";
import {
  modifierDescKey,
  modifierEntry,
  recordEffects,
  registerModifierDescKey,
  scriptCtx,
  type Modifier,
  type ModifierWithLoc,
  type ScopeValue,
  type ScriptCtx,
} from "./effect-core.ts";
import type { ScopeObjOf } from "./generated/effects.ts";
import type { EventKindKey } from "./generated/events.ts";
import {
  refId,
  type EventChainRef,
  type MessageTypeRef,
  type SoundEffectRef,
  type SpecimenRef,
  type SpriteRef,
  type TypedRef,
} from "./generated/refs.ts";
import type { ScopeName } from "./generated/scopes.ts";
import type { ModWarning } from "./items.ts";
import type { Trigger } from "./trigger-core.ts";
// The typed fire signatures for every event kind are generated into the
// scope interfaces — this side-effect import is what loads the augmentation.
import "./generated/event-fires.ts";

declare const eventFromBrand: unique symbol;

/**
 * A defined event, usable as the `id` of a fire effect. `From` is the scope
 * the event declared it will be fired from — the phantom that makes firing a
 * `from: "country"` event without a country witness a compile error.
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
  From extends ScopeName | undefined = ScopeName | undefined,
  Kind extends string = S,
> extends TypedRef<`event.${Kind}`> {
  readonly kind: "event-ref";
  /** The event's main scope. */
  readonly scope: S;
  /** The full id, e.g. `hello_galaxy.2`. */
  readonly id: string;
  /** Runtime copy of the declared FROM contract for registration and testing. */
  readonly from: ScopeName | undefined;
  readonly [eventFromBrand]?: From;
}

/**
 * An `option.icon` block (`events.cwt:338`): a display icon overriding the
 * option row's default, with its own optional caption.
 */
export interface EventOptionIcon {
  readonly icon: SpriteRef | string;
  readonly iconBackground?: SpriteRef | string;
  /** English caption text; a localization key is generated the same way `name` is. */
  readonly text?: string;
}

/**
 * An `option.ai_chance` block (`events.cwt:358`): the same `modifier_rule`
 * shape `Modifier`/`modifierEntry` (`effect-core.ts`) already lower, with the
 * base weight spelled `factor` — the arm the corpus actually uses at this
 * position (vanilla `ai_chance` blocks open `factor = <n>`, not `base = <n>`,
 * unlike `situation_type.monthly_progress`'s `WeightBlock`).
 */
export interface AiChance<S extends ScopeName> {
  readonly factor?: number;
  readonly modifiers?: readonly Modifier<S>[];
}

export interface EventOption<S extends ScopeName, From extends ScopeName | undefined> {
  /** English text; the localization key rides along on the definition. */
  readonly name: string;
  /** Display icon overriding the option row's default (`events.cwt:338`). */
  readonly icon?: EventOptionIcon;
  /** Raw sound key; declared `scalar` rather than `<sound_effect>` in the rules. */
  readonly sound?: string;
  /** Visibility gate for the option. */
  readonly trigger?: Trigger<S>;
  /** Availability gate — the option shows greyed out when this fails. */
  readonly allow?: Trigger<S>;
  /** A second gate alongside `trigger` (`events.cwt:356`); the rules do not narrow how it differs. */
  readonly exclusiveTrigger?: Trigger<S>;
  /** AI weighting for picking this option (`events.cwt:358`). */
  readonly aiChance?: AiChance<S>;
  /** Localized text shown as the AI's "response" to picking this option. */
  readonly responseText?: string;
  /** Marks the option as dialog-only, excluded from the normal option list. */
  readonly isDialogOnly?: boolean;
  readonly hideIfNotAllowed?: boolean;
  /** Hides the option by default, distinct from `hideIfNotAllowed`'s allow-gated hiding. */
  readonly defaultHideOption?: boolean;
  /** Points at a `gui_type`; declared `scalar` in the rules (`events.cwt:383`). */
  readonly customGui?: string;
  /** A `value_set[event_option_tag]` entry (`events.cwt:386`), typed loosely since the set is corpus-defined. */
  readonly tag?: string;
  readonly effects?: (scope: ScopeObjOf<S>, ctx: ScriptCtx<S, From>) => void;
}

/**
 * A `location` value (`events.cwt:308`, `scope_field`): either a fixed
 * {@link ScopeValue} or a closure handed the event's FROM/self context that
 * returns one, the same `WithFrom`-style dual `content.ts` uses for
 * declarative fields that can want FROM — `location: (ctx) => ctx.from` is
 * the dig-stage idiom (every vanilla archaeology-site event opens
 * `location = from`). A plain value covers the rest: a saved
 * `eventTarget`, or `ctx.self`.
 */
export type EventLocation<S extends ScopeName, From extends ScopeName | undefined> =
  ScopeValue<ScopeName> | ((ctx: ScriptCtx<S, From>) => ScopeValue<ScopeName>);

/**
 * A `situation` value (`events.cwt:399`, `scope[situation]`): the same fixed
 * {@link ScopeValue}-or-FROM-closure dual as {@link EventLocation}. A saved
 * `eventTarget<"situation">` covers the common case, but the CWT-legal
 * `situation = from` form — a non-situation event fired from a situation —
 * needs `ctx.from`, which only exists inside the closure form; without it,
 * authoring `situation = from` meant forging the internal `ScopeValue` shape
 * by hand.
 */
export type EventSituation<S extends ScopeName, From extends ScopeName | undefined> =
  ScopeValue<"situation"> | ((ctx: ScriptCtx<S, From>) => ScopeValue<"situation">);

/**
 * A `mean_time_to_happen` block (`events.cwt:456`, `subtype[!triggered]`):
 * days/months/years plus the same `modifier_rule` modifier rows
 * `Modifier`/`modifierEntry` (`effect-core.ts`) already lower elsewhere.
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

export interface EventDef<S extends ScopeName, From extends ScopeName | undefined> {
  /** Numeric id within the mod's namespace; the full id is `namespace.id`. */
  readonly id: number;
  /** English title text; omit for hidden events. */
  readonly title?: string;
  readonly desc?: string;
  /** Localized title shown at the top of the diplomatic screen (`events.cwt:197`, `:474`). */
  readonly diplomaticTitle?: string;
  /** Localized text for the message-feed entry, distinct from `desc` (`events.cwt:402`). */
  readonly messageDesc?: string;
  readonly picture?: SpriteRef | string;
  readonly showSound?: SoundEffectRef | string;
  /** The event window's background image (`events.cwt:289-290`). */
  readonly eventPictureBackground?: SpriteRef | string;
  /** The icon shown for this event's entry in the notification feed (`events.cwt:291-292`). */
  readonly notificationEventIcon?: SpriteRef | string;
  /** Which of the four leader-conversation window styles renders this event (`events.cwt:287-288`). */
  readonly eventWindowType?: EventWindowType;
  /** A `<message_type>` reference controlling the message-feed presentation (`events.cwt:393`). */
  readonly eventMessageType?: MessageTypeRef | string;
  /** The `<event_chain>` this event belongs to (`events.cwt:396`). */
  readonly eventChain?: EventChainRef | string;
  /** A `<specimen>` reference (`events.cwt:417`), used by xenology/zoo content. */
  readonly specimen?: SpecimenRef | string;
  /** Associates this event with a situation scope (`events.cwt:399`, `scope[situation]`); `(ctx) => ctx.from` writes `situation = from`. */
  readonly situation?: EventSituation<S, From>;
  /** Where the event's window renders relative to (`events.cwt:308`); dig-stage events set `(ctx) => ctx.from`. */
  readonly location?: EventLocation<S, From>;
  /**
   * The scope this event expects FROM to be when fired. Emits nothing — it
   * is the compile-time contract every fire site is checked against.
   */
  readonly from?: From;
  readonly isTriggeredOnly?: boolean;
  readonly hideWindow?: boolean;
  /** Renders the event in the diplomatic screen instead of the ordinary event window (`events.cwt:311`). */
  readonly diplomatic?: boolean;
  /** Forces a diplomatic event to be viewed rather than queued (`events.cwt:303-305`). */
  readonly forceOpen?: boolean;
  /** Shows the event to other countries (`events.cwt:421`). */
  readonly major?: boolean;
  /**
   * Narrows which countries see a `major` event (`events.cwt:423-425`,
   * `subtype[major]`). `subtype[major]` is an attribute subtype driven by
   * `major`'s own value, not by the event's kind — the same class as
   * `diplomatic`/`subtype[diplomatic]` — so this stays an unconditional
   * field rather than a second `S`-conditioned parameter; it is simply
   * inert unless `major: true` is also set, the same way
   * `meanTimeToHappen` is inert alongside `isTriggeredOnly: true`.
   *
   * Typed `Trigger<"country">` rather than `Trigger<S>`: the CWT comment at
   * `events.cwt:419-425` and its example (`has_ethic = ethic_materialist`)
   * both describe this block filtering the *other countries* that should
   * receive the event, evaluated once per candidate recipient — a fixed
   * country scope independent of what `S` the major event itself runs in.
   * `Trigger<S>` would reject a country-only predicate on a non-country
   * major event and admit an `S`-scoped predicate the game never evaluates
   * in that scope here.
   */
  readonly majorTrigger?: Trigger<"country">;
  /** Whether the event is trackable from the outliner (`events.cwt:438`). */
  readonly trackable?: boolean;
  /** Marks the event as coming from an advisor (`events.cwt:441`). */
  readonly isAdvisorEvent?: boolean;
  /** Whether the game may auto-select an option for this event (`events.cwt:444`). */
  readonly autoSelect?: boolean;
  /** Forces the event to pop up even with pop-ups suppressed (`events.cwt:315`). */
  readonly autoOpens?: boolean;
  /** Marks the event as a developer test event (`events.cwt:318`, `events.cwt:414`). */
  readonly isTestEvent?: boolean;
  readonly fireOnlyOnce?: boolean;
  /**
   * The archaeology-window flag (`events.cwt:503`, `subtype[fleet]`): the
   * blocking case this field set closes — every vanilla dig-stage event sets
   * it, and without it a fleet event never renders in the excavation window.
   * Legal only on `defineFleetEvent`, enforced by conditioning on `S`.
   */
  readonly archaeology?: S extends "fleet" ? boolean : never;
  /** The first-contact window flag (`events.cwt:507`, `subtype[first_contact]`). */
  readonly firstContact?: S extends "first_contact" ? boolean : never;
  /** The espionage-operation window flag (`events.cwt:511`, `subtype[espionage_operation]`). */
  readonly espionageOperation?: S extends "espionage_operation" ? boolean : never;
  /** The astral-rift window flag (`events.cwt:515`, `subtype[astral_rift]`). */
  readonly astralRift?: S extends "astral_rift" ? boolean : never;
  /** Astral-rift difficulty (`events.cwt:517`, `subtype[astral_rift]`), alongside `astralRift`. */
  readonly difficulty?: S extends "astral_rift" ? number : never;
  /** Visibility gate for the whole event (`events.cwt:521`). */
  readonly trigger?: Trigger<S>;
  /** Cancels the event with no options run when this becomes true (`events.cwt:429`). */
  readonly abortTrigger?: Trigger<S>;
  /** Effects run when `abortTrigger` fires (`events.cwt:432`). */
  readonly abortEffect?: (scope: ScopeObjOf<S>, ctx: ScriptCtx<S, From>) => void;
  /** Scheduling weight for a non-triggered event (`events.cwt:456`). */
  readonly meanTimeToHappen?: MeanTimeToHappen<S>;
  /** AI scheduling weight for a triggered event (`events.cwt:448-452`, `subtype[triggered]`). */
  readonly weightMultiplier?: WeightMultiplier<S>;
  readonly immediate?: (scope: ScopeObjOf<S>, ctx: ScriptCtx<S, From>) => void;
  readonly after?: (scope: ScopeObjOf<S>, ctx: ScriptCtx<S, From>) => void;
  readonly options?: ReadonlyArray<EventOption<S, From>>;
}

export type DefinedEvent<
  S extends ScopeName,
  From extends ScopeName | undefined,
  Kind extends string = S,
> = EventRef<S, From, Kind> & {
  readonly entry: PdxEntry;
  /**
   * Content references the event's closures and option conditions wrote. The
   * closures ran here, at the definition site, so the recorder's report is
   * captured here too — `buildMod` resolves it against the ids the build
   * defined, exactly as it does for declarative content fields.
   */
  readonly refs: readonly ContentRefUse[];
  /**
   * Diagnostics collected at define time — today, just an `unstable-desc-key`
   * entry per `aiChance`/`meanTimeToHappen`/`weightMultiplier` modifier row
   * whose `desc` had no `descKey` (see `modifierDescKey`, `effect-core.ts`).
   * Events have no `ContentAuthoring` instance to hang `onUnstableDescKey`
   * off — they are built at the definer call site, before `buildMod` ever
   * runs — so this rides along the same way `refs` and `locEntries` do:
   * `event-definers.ts`'s generated `definerOf` spreads `built` into the
   * returned item, `EventItemBase.warnings` carries it from there, and
   * `buildMod` drains it into `mod.warnings` alongside `registerLocEntries`.
   */
  readonly warnings: readonly ModWarning[];
};

/** Where definition-side localization lands; the caller supplies its registry. */
export interface LocSink {
  register(key: string, text: string): void;
}

const OPTION_KEYS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Lowers a `WeightBlock`-shaped modifier row list, reusing the `modifier_rule`
 * writer `effect-core.ts` already exposes rather than re-deriving it — the
 * only field-specific bits (`factor` vs. `base`, which extra scalars come
 * before the rows) stay with each call site. `ownerKey` is the same
 * `${ownerId}::${fieldPath}` token `registerModifierDescs` below registered
 * this same field's desc-bearing rows under — required so a shared row
 * object resolves its own occurrence's key at lowering (PR #16 review
 * finding 3), the same reasoning `content.ts`'s `descOwnerKey` documents.
 */
function modifierRows<S extends ScopeName>(
  modifiers: readonly Modifier<S>[] | undefined,
  refs: ContentRefUse[],
  ownerKey: string
): PdxEntry[] {
  return (modifiers ?? []).map((modifier) =>
    modifierEntry(modifier as Modifier<ScopeName>, refs, ownerKey)
  );
}

/**
 * Registers one localisation key per desc-bearing row in a modifier list, via
 * the shared derivation `modifierDescKey` (`effect-core.ts`) — the same one
 * `content.ts`'s `collectModifierDescs` uses, so the two never drift and a
 * future fix to the derivation reaches events automatically. Must run before
 * `modifierRows` lowers the same array: `modifierEntry` throws if a row's
 * `desc` reaches it unregistered, and an event has the stable id and
 * `LocSink` a registration needs, the same as every other
 * definition-attached localization slot.
 *
 * `warnings` collects the `unstable-desc-key` entry `modifierDescKey` returns
 * when a row falls back to a content hash — see `DefinedEvent.warnings` for
 * why events carry this on the returned event rather than through a
 * `ContentAuthoring`-style callback.
 *
 * Returns the `${ownerId}::${fieldPath}` token every row on this field was
 * registered under, for the caller to hand to the matching `modifierRows`
 * call — the same per-owner-occurrence scheme `content.ts`'s `descOwnerKey`
 * uses, needed so a row object reused across two fields resolves its own
 * key rather than whichever registration ran last (PR #16 review finding 3).
 */
function registerModifierDescs<S extends ScopeName>(
  warnings: ModWarning[],
  loc: LocSink,
  ownerId: string,
  fieldPath: string,
  modifiers: readonly Modifier<S>[] | undefined
): string {
  const ownerKey = `${ownerId}::${fieldPath}`;
  (modifiers ?? []).forEach((modifier) => {
    if (modifier.desc === undefined) {
      return;
    }
    const { key, unstableWarning } = modifierDescKey(
      ownerId,
      fieldPath,
      modifier as ModifierWithLoc<ScopeName>
    );
    loc.register(key, modifier.desc);
    registerModifierDescKey(modifier as Modifier<ScopeName>, ownerKey, key);
    if (unstableWarning !== undefined) {
      warnings.push({ code: "unstable-desc-key", message: unstableWarning });
    }
  });
  return ownerKey;
}

/**
 * SDK-internal cast for the four kind-gated window flags: `EventDef`
 * conditions their types on `S` so a wrong-kind `defineXEvent` call is a
 * compile error, but that makes them `S extends "fleet" ? boolean : never`
 * — a deferred conditional inside this generic function, where `S` is not
 * yet a literal. The cast reads them back as plain optional fields; the
 * compile-time guarantee already happened at the call site that built `def`.
 */
function windowFlags(def: object): {
  readonly archaeology?: boolean;
  readonly firstContact?: boolean;
  readonly espionageOperation?: boolean;
  readonly astralRift?: boolean;
  readonly difficulty?: number;
} {
  return def as never;
}

export function buildEvent<S extends ScopeName, From extends ScopeName | undefined>(
  kind: EventKindKey,
  scope: S,
  namespace: string,
  def: EventDef<S, From>,
  loc: LocSink
): DefinedEvent<S, From> {
  const id = `${namespace}.${def.id}`;
  const ctx = scriptCtx<S, From>();
  const flags = windowFlags(def);
  const warnings: ModWarning[] = [];

  const entries: PdxEntry[] = [kv("id", id)];
  if (def.title !== undefined) {
    loc.register(`${id}.name`, def.title);
    entries.push(kv("title", `${id}.name`));
  }
  if (def.desc !== undefined) {
    loc.register(`${id}.desc`, def.desc);
    entries.push(kv("desc", `${id}.desc`));
  }
  if (def.diplomaticTitle !== undefined) {
    loc.register(`${id}.diplomatic_title`, def.diplomaticTitle);
    entries.push(kv("diplomatic_title", `${id}.diplomatic_title`));
  }
  if (def.messageDesc !== undefined) {
    loc.register(`${id}.message_desc`, def.messageDesc);
    entries.push(kv("message_desc", `${id}.message_desc`));
  }
  if (def.picture !== undefined) {
    entries.push(kv("picture", refId(def.picture)));
  }
  if (def.showSound !== undefined) {
    entries.push(kv("show_sound", refId(def.showSound)));
  }
  if (def.eventPictureBackground !== undefined) {
    entries.push(kv("event_picture_background", refId(def.eventPictureBackground)));
  }
  if (def.notificationEventIcon !== undefined) {
    entries.push(kv("notification_event_icon", refId(def.notificationEventIcon)));
  }
  if (def.eventWindowType !== undefined) {
    entries.push(kv("event_window_type", def.eventWindowType));
  }
  if (def.eventMessageType !== undefined) {
    entries.push(kv("event_message_type", refId(def.eventMessageType)));
  }
  if (def.eventChain !== undefined) {
    entries.push(kv("event_chain", refId(def.eventChain)));
  }
  if (def.specimen !== undefined) {
    entries.push(kv("specimen", refId(def.specimen)));
  }
  if (def.situation !== undefined) {
    const situation = typeof def.situation === "function" ? def.situation(ctx) : def.situation;
    entries.push(kv("situation", situation.path));
  }
  if (def.location !== undefined) {
    const location = typeof def.location === "function" ? def.location(ctx) : def.location;
    entries.push(kv("location", location.path));
  }
  if (def.hideWindow === true) {
    entries.push(kv("hide_window", true));
  }
  if (def.diplomatic === true) {
    entries.push(kv("diplomatic", true));
  }
  if (def.forceOpen === true) {
    entries.push(kv("force_open", true));
  }
  if (def.major === true) {
    entries.push(kv("major", true));
  }
  if (def.trackable === true) {
    entries.push(kv("trackable", true));
  }
  if (def.isAdvisorEvent === true) {
    entries.push(kv("is_advisor_event", true));
  }
  if (def.autoSelect === true) {
    entries.push(kv("auto_select", true));
  }
  if (def.autoOpens === true) {
    entries.push(kv("auto_opens", true));
  }
  if (def.isTestEvent === true) {
    entries.push(kv("is_test_event", true));
  }
  if (def.isTriggeredOnly === true) {
    entries.push(kv("is_triggered_only", true));
  }
  if (def.fireOnlyOnce === true) {
    entries.push(kv("fire_only_once", true));
  }
  if (flags.archaeology === true) {
    entries.push(kv("archaeology", true));
  }
  if (flags.firstContact === true) {
    entries.push(kv("first_contact", true));
  }
  if (flags.espionageOperation === true) {
    entries.push(kv("espionage_operation", true));
  }
  if (flags.astralRift === true) {
    entries.push(kv("astral_rift", true));
  }
  if (flags.difficulty !== undefined) {
    entries.push(kv("difficulty", flags.difficulty));
  }
  const refs: ContentRefUse[] = [];
  if (def.trigger !== undefined) {
    entries.push(block("trigger", [...def.trigger.entries]));
    refs.push(...underField(def.trigger.refs, "trigger"));
  }
  if (def.majorTrigger !== undefined) {
    entries.push(block("major_trigger", [...def.majorTrigger.entries]));
    refs.push(...underField(def.majorTrigger.refs, "major_trigger"));
  }
  if (def.abortTrigger !== undefined) {
    entries.push(block("abort_trigger", [...def.abortTrigger.entries]));
    refs.push(...underField(def.abortTrigger.refs, "abort_trigger"));
  }
  if (def.abortEffect !== undefined) {
    const recorded: ContentRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.abortEffect!(scope, ctx));
    entries.push(block("abort_effect", sink));
    refs.push(...underField(recorded, "abort_effect"));
  }
  if (def.meanTimeToHappen !== undefined) {
    const mtth = def.meanTimeToHappen;
    const mtthEntries: PdxEntry[] = [];
    if (mtth.years !== undefined) {
      mtthEntries.push(kv("years", mtth.years));
    }
    if (mtth.months !== undefined) {
      mtthEntries.push(kv("months", mtth.months));
    }
    if (mtth.days !== undefined) {
      mtthEntries.push(kv("days", mtth.days));
    }
    const mtthOwnerKey = registerModifierDescs(
      warnings,
      loc,
      id,
      "mean_time_to_happen",
      mtth.modifiers
    );
    const mtthRefs: ContentRefUse[] = [];
    mtthEntries.push(...modifierRows(mtth.modifiers, mtthRefs, mtthOwnerKey));
    entries.push(block("mean_time_to_happen", mtthEntries));
    refs.push(...underField(mtthRefs, "mean_time_to_happen"));
  }
  if (def.weightMultiplier !== undefined) {
    const weight = def.weightMultiplier;
    const weightEntries: PdxEntry[] = [kv("factor", weight.factor)];
    const weightOwnerKey = registerModifierDescs(
      warnings,
      loc,
      id,
      "weight_multiplier",
      weight.modifiers
    );
    const weightRefs: ContentRefUse[] = [];
    weightEntries.push(...modifierRows(weight.modifiers, weightRefs, weightOwnerKey));
    entries.push(block("weight_multiplier", weightEntries));
    refs.push(...underField(weightRefs, "weight_multiplier"));
  }
  if (def.immediate !== undefined) {
    const recorded: ContentRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.immediate!(scope, ctx));
    entries.push(block("immediate", sink));
    refs.push(...underField(recorded, "immediate"));
  }
  if (def.after !== undefined) {
    const recorded: ContentRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.after!(scope, ctx));
    entries.push(block("after", sink));
    refs.push(...underField(recorded, "after"));
  }
  (def.options ?? []).forEach((option, index) => {
    const optionKey = `${id}.${OPTION_KEYS[index] ?? `opt${index}`}`;
    loc.register(optionKey, option.name);
    const optionEntries: PdxEntry[] = [kv("name", optionKey)];
    const where = `option[${index}]`;
    if (option.icon !== undefined) {
      const iconEntries: PdxEntry[] = [kv("icon", refId(option.icon.icon))];
      if (option.icon.iconBackground !== undefined) {
        iconEntries.push(kv("icon_background", refId(option.icon.iconBackground)));
      }
      if (option.icon.text !== undefined) {
        const textKey = `${optionKey}.icon`;
        loc.register(textKey, option.icon.text);
        iconEntries.push(kv("text", textKey));
      }
      optionEntries.push(block("icon", iconEntries));
    }
    if (option.sound !== undefined) {
      optionEntries.push(kv("sound", option.sound));
    }
    if (option.trigger !== undefined) {
      optionEntries.push(block("trigger", [...option.trigger.entries]));
      refs.push(...underField(option.trigger.refs, `${where}.trigger`));
    }
    if (option.allow !== undefined) {
      optionEntries.push(block("allow", [...option.allow.entries]));
      refs.push(...underField(option.allow.refs, `${where}.allow`));
    }
    if (option.exclusiveTrigger !== undefined) {
      optionEntries.push(block("exclusive_trigger", [...option.exclusiveTrigger.entries]));
      refs.push(...underField(option.exclusiveTrigger.refs, `${where}.exclusive_trigger`));
    }
    if (option.aiChance !== undefined) {
      const aiChanceEntries: PdxEntry[] = [];
      if (option.aiChance.factor !== undefined) {
        aiChanceEntries.push(kv("factor", option.aiChance.factor));
      }
      const aiChanceOwnerKey = registerModifierDescs(
        warnings,
        loc,
        id,
        `option_${index}.ai_chance`,
        option.aiChance.modifiers
      );
      const aiChanceRefs: ContentRefUse[] = [];
      aiChanceEntries.push(...modifierRows(option.aiChance.modifiers, aiChanceRefs, aiChanceOwnerKey));
      optionEntries.push(block("ai_chance", aiChanceEntries));
      refs.push(...underField(aiChanceRefs, `${where}.ai_chance`));
    }
    if (option.responseText !== undefined) {
      const responseKey = `${optionKey}.response`;
      loc.register(responseKey, option.responseText);
      optionEntries.push(kv("response_text", responseKey));
    }
    if (option.isDialogOnly === true) {
      optionEntries.push(kv("is_dialog_only", true));
    }
    if (option.hideIfNotAllowed === true) {
      optionEntries.push(kv("hide_option_if_not_allowed", true));
    }
    if (option.defaultHideOption === true) {
      optionEntries.push(kv("default_hide_option", true));
    }
    if (option.customGui !== undefined) {
      optionEntries.push(kv("custom_gui", option.customGui));
    }
    if (option.tag !== undefined) {
      optionEntries.push(kv("tag", option.tag));
    }
    if (option.effects !== undefined) {
      const recorded: ContentRefUse[] = [];
      const sink = recordEffects<S>(recorded, (scope) => option.effects!(scope, ctx));
      optionEntries.push(...sink);
      refs.push(...underField(recorded, where));
    }
    entries.push(block("option", optionEntries));
  });

  return { kind: "event-ref", scope, id, from: def.from, entry: block(kind, entries), refs, warnings };
}

// ---------------------------------------------------------------------------
// Fire effects: typed signatures over the runtime encoders
// ---------------------------------------------------------------------------

export interface FireEventArgs<
  S extends ScopeName,
  From extends ScopeName | undefined,
  Kind extends string = S,
> {
  /**
   * The event to fire. `Kind` pins it to the subtype this fire effect writes:
   * `observer_event = { id = ... }` dispatches an observer event, and an
   * ordinary country event is not one however alike their scopes are.
   */
  readonly id: EventRef<S, From, Kind>;
  readonly days?: number;
  readonly months?: number;
  readonly years?: number;
  /** Random extra delay from 0 to this many days, added to `days`. */
  readonly random?: number;
}

export interface WitnessedFireEventArgs<
  S extends ScopeName,
  F extends ScopeName,
  Kind extends string = S,
> extends FireEventArgs<S, F, Kind> {
  /**
   * Proof the fired event's declared FROM is satisfied: usually `ctx.self`.
   * Any other ref emits the game's `scopes = { from = ... }` override.
   * `NoInfer` keeps the event ref the single inference source, so a
   * wrong-scope witness fails instead of unifying.
   */
  readonly from: ScopeValue<NoInfer<F>>;
}
