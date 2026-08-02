/**
 * Typed event definitions with the FROM contract.
 *
 * An event declares the scope it expects FROM to be (`from: "country"`) as a
 * phantom type; every fire site is then checked against it by passing a
 * witness ref — usually `ctx.self`, proving the firing event's own scope is
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

import { makeScope, scopeRef, type ScopeRef } from "./effect-core.ts";
import type { ScopeObjOf } from "./generated/effects.ts";
import type { EventKindKey } from "./generated/events.ts";
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
 */
export interface EventRef<
  S extends ScopeName = ScopeName,
  From extends ScopeName | undefined = ScopeName | undefined,
> {
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
 * The sentinel behind `ctx.from` on an event with no `from:` declaration.
 * Deliberately NOT a `ScopeRef` (and not `never`, which would assign
 * anywhere), so every use site fails with this type's name in the message.
 */
export interface UndeclaredFrom {
  readonly kind: "undeclared-from";
  readonly hint: 'Declare the FROM contract on the event (`from: "country"`) to read FROM.';
}

/**
 * The second argument every event closure receives. `self` doubles as the
 * FROM witness at fire sites: passing `from: ctx.self` proves the fired
 * event's declared FROM matches this event's own scope.
 */
export interface EventCtx<Self extends ScopeName, From extends ScopeName | undefined> {
  readonly self: ScopeRef<Self>;
  /**
   * FROM, as declared by this event's `from:` field. Undeclared events get
   * an inert sentinel — touching FROM without declaring it is a compile error.
   */
  readonly from: [From] extends [ScopeName] ? ScopeRef<From> : UndeclaredFrom;
}

export interface EventOption<S extends ScopeName, From extends ScopeName | undefined> {
  /** English text; the localization key rides along on the definition. */
  readonly name: string;
  /** Visibility gate for the option. */
  readonly trigger?: Trigger<S>;
  /** Availability gate — the option shows greyed out when this fails. */
  readonly allow?: Trigger<S>;
  readonly hideIfNotAllowed?: boolean;
  readonly effects?: (scope: ScopeObjOf<S>, ctx: EventCtx<S, From>) => void;
}

export interface EventDef<S extends ScopeName, From extends ScopeName | undefined> {
  /** Numeric id within the mod's namespace; the full id is `namespace.id`. */
  readonly id: number;
  /** English title text; omit for hidden events. */
  readonly title?: string;
  readonly desc?: string;
  readonly picture?: string;
  /**
   * The scope this event expects FROM to be when fired. Emits nothing — it
   * is the compile-time contract every fire site is checked against.
   */
  readonly from?: From;
  readonly isTriggeredOnly?: boolean;
  readonly hideWindow?: boolean;
  readonly fireOnlyOnce?: boolean;
  readonly immediate?: (scope: ScopeObjOf<S>, ctx: EventCtx<S, From>) => void;
  readonly after?: (scope: ScopeObjOf<S>, ctx: EventCtx<S, From>) => void;
  readonly options?: ReadonlyArray<EventOption<S, From>>;
}

export type DefinedEvent<S extends ScopeName, From extends ScopeName | undefined> = EventRef<
  S,
  From
> & { readonly entry: PdxEntry };

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
  const ctx = {
    self: scopeRef("this"),
    from: scopeRef("from"),
  } as EventCtx<S, From>;

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
    entries.push(kv("picture", def.picture));
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
  if (def.immediate !== undefined) {
    const sink: PdxEntry[] = [];
    def.immediate(makeScope<S>(sink), ctx);
    entries.push(block("immediate", sink));
  }
  if (def.after !== undefined) {
    const sink: PdxEntry[] = [];
    def.after(makeScope<S>(sink), ctx);
    entries.push(block("after", sink));
  }
  (def.options ?? []).forEach((option, index) => {
    const optionKey = `${id}.${OPTION_KEYS[index] ?? `opt${index}`}`;
    loc.register(optionKey, option.name);
    const optionEntries: PdxEntry[] = [kv("name", optionKey)];
    if (option.trigger !== undefined) {
      optionEntries.push(block("trigger", [...option.trigger.entries]));
    }
    if (option.allow !== undefined) {
      optionEntries.push(block("allow", [...option.allow.entries]));
    }
    if (option.hideIfNotAllowed === true) {
      optionEntries.push(kv("hide_option_if_not_allowed", true));
    }
    if (option.effects !== undefined) {
      const sink: PdxEntry[] = [];
      option.effects(makeScope<S>(sink), ctx);
      optionEntries.push(...sink);
    }
    entries.push(block("option", optionEntries));
  });

  return { kind: "event-ref", scope, id, from: def.from, entry: block(kind, entries) };
}

// ---------------------------------------------------------------------------
// Fire effects: typed signatures over the runtime encoders
// ---------------------------------------------------------------------------

export interface FireEventArgs<S extends ScopeName, From extends ScopeName | undefined> {
  readonly id: EventRef<S, From>;
  readonly days?: number;
  readonly months?: number;
  readonly years?: number;
  /** Random extra delay from 0 to this many days, added to `days`. */
  readonly random?: number;
}

export interface WitnessedFireEventArgs<
  S extends ScopeName,
  F extends ScopeName,
> extends FireEventArgs<S, F> {
  /**
   * Proof the fired event's declared FROM is satisfied: usually `ctx.self`.
   * Any other ref emits the game's `scopes = { from = ... }` override.
   * `NoInfer` keeps the event ref the single inference source, so a
   * wrong-scope witness fails instead of unifying.
   */
  readonly from: ScopeRef<NoInfer<F>>;
}
