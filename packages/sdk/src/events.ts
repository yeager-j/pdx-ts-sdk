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
import { recordEffects, scriptCtx, type ScopeValue, type ScriptCtx } from "./effect-core.ts";
import type { ScopeObjOf } from "./generated/effects.ts";
import type { EventKindKey } from "./generated/events.ts";
import { refId, type SoundEffectRef, type SpriteRef, type TypedRef } from "./generated/refs.ts";
import type { ScopeName } from "./generated/scopes.ts";
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

export interface EventOption<S extends ScopeName, From extends ScopeName | undefined> {
  /** English text; the localization key rides along on the definition. */
  readonly name: string;
  /** Visibility gate for the option. */
  readonly trigger?: Trigger<S>;
  /** Availability gate — the option shows greyed out when this fails. */
  readonly allow?: Trigger<S>;
  readonly hideIfNotAllowed?: boolean;
  readonly effects?: (scope: ScopeObjOf<S>, ctx: ScriptCtx<S, From>) => void;
}

export interface EventDef<S extends ScopeName, From extends ScopeName | undefined> {
  /** Numeric id within the mod's namespace; the full id is `namespace.id`. */
  readonly id: number;
  /** English title text; omit for hidden events. */
  readonly title?: string;
  readonly desc?: string;
  readonly picture?: SpriteRef | string;
  readonly showSound?: SoundEffectRef | string;
  /**
   * The scope this event expects FROM to be when fired. Emits nothing — it
   * is the compile-time contract every fire site is checked against.
   */
  readonly from?: From;
  readonly isTriggeredOnly?: boolean;
  readonly hideWindow?: boolean;
  readonly fireOnlyOnce?: boolean;
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
};

/** Where definition-side localization lands; the caller supplies its registry. */
export interface LocSink {
  register(key: string, text: string): void;
}

const OPTION_KEYS = "abcdefghijklmnopqrstuvwxyz";

export function buildEvent<S extends ScopeName, From extends ScopeName | undefined>(
  kind: EventKindKey,
  scope: S,
  namespace: string,
  def: EventDef<S, From>,
  loc: LocSink
): DefinedEvent<S, From> {
  const id = `${namespace}.${def.id}`;
  const ctx = scriptCtx<S, From>();

  const entries: PdxEntry[] = [kv("id", id)];
  if (def.title !== undefined) {
    loc.register(`${id}.name`, def.title);
    entries.push(kv("title", `${id}.name`));
  }
  if (def.desc !== undefined) {
    loc.register(`${id}.desc`, def.desc);
    entries.push(kv("desc", `${id}.desc`));
  }
  if (def.picture !== undefined) {
    entries.push(kv("picture", refId(def.picture)));
  }
  if (def.showSound !== undefined) {
    entries.push(kv("show_sound", refId(def.showSound)));
  }
  if (def.hideWindow === true) {
    entries.push(kv("hide_window", true));
  }
  if (def.isTriggeredOnly === true) {
    entries.push(kv("is_triggered_only", true));
  }
  if (def.fireOnlyOnce === true) {
    entries.push(kv("fire_only_once", true));
  }
  const refs: ContentRefUse[] = [];
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
    if (option.trigger !== undefined) {
      optionEntries.push(block("trigger", [...option.trigger.entries]));
      refs.push(...underField(option.trigger.refs, `${where}.trigger`));
    }
    if (option.allow !== undefined) {
      optionEntries.push(block("allow", [...option.allow.entries]));
      refs.push(...underField(option.allow.refs, `${where}.allow`));
    }
    if (option.hideIfNotAllowed === true) {
      optionEntries.push(kv("hide_option_if_not_allowed", true));
    }
    if (option.effects !== undefined) {
      const recorded: ContentRefUse[] = [];
      const sink = recordEffects<S>(recorded, (scope) => option.effects!(scope, ctx));
      optionEntries.push(...sink);
      refs.push(...underField(recorded, where));
    }
    entries.push(block("option", optionEntries));
  });

  return { kind: "event-ref", scope, id, from: def.from, entry: block(kind, entries), refs };
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
