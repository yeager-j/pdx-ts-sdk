/**
 * Hand-written stand-in for the event-definition surface.
 *
 * The real slice puts `defineCountryEvent`/`definePlanetEvent` on `Mod` (with
 * loc riding along and a per-namespace duplicate check); the probe keeps them
 * standalone so Stage 0 touches nothing in src/. Closures run eagerly, here,
 * inside define — errors carry the user's stack and cross-references require
 * definition order, exactly like `prerequisites: [theory]` already does.
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScopeName } from "../../packages/sdk/src/generated/scopes.ts";
import type { Trigger } from "../../packages/sdk/src/trigger-core.ts";
import { makeScope, scopeRef, type EventCtx, type EventRef } from "./effect-core.ts";
import type { KnownScope, ScopeObjOf } from "./scopes-sample.ts";

export interface EventOption<S extends KnownScope, From extends ScopeName | undefined> {
  /** Localization key for the option text. */
  readonly name: string;
  /** Visibility gate for the option. */
  readonly trigger?: Trigger<S>;
  readonly effects?: (scope: ScopeObjOf<S>, ctx: EventCtx<S, From>) => void;
}

export interface EventDef<S extends KnownScope, From extends ScopeName | undefined> {
  /** Numeric id within the namespace; the full id becomes `namespace.id`. */
  readonly id: number;
  /** Localization key for the title. */
  readonly title?: string;
  /** Localization key for the description. */
  readonly desc?: string;
  /**
   * The scope this event expects FROM to be when fired. Emits nothing — it is
   * the compile-time contract every fire site is checked against.
   */
  readonly from?: From;
  readonly isTriggeredOnly?: boolean;
  readonly hideWindow?: boolean;
  readonly immediate?: (scope: ScopeObjOf<S>, ctx: EventCtx<S, From>) => void;
  readonly options?: ReadonlyArray<EventOption<S, From>>;
}

export type DefinedEvent<K extends KnownScope, From extends ScopeName | undefined> = EventRef<
  K,
  From
> & { readonly entry: PdxEntry };

const EVENT_KEYS: Record<KnownScope, string> = {
  country: "country_event",
  planet: "planet_event",
};

function defineEvent<S extends KnownScope, From extends ScopeName | undefined>(
  kind: S,
  namespace: string,
  def: EventDef<S, From>
): DefinedEvent<S, From> {
  const id = `${namespace}.${def.id}`;
  const ctx = {
    self: scopeRef("this"),
    from: scopeRef("from"),
  } as EventCtx<S, From>;

  const entries: PdxEntry[] = [kv("id", id)];
  if (def.title !== undefined) {
    entries.push(kv("title", def.title));
  }
  if (def.desc !== undefined) {
    entries.push(kv("desc", def.desc));
  }
  if (def.hideWindow === true) {
    entries.push(kv("hide_window", true));
  }
  if (def.isTriggeredOnly === true) {
    entries.push(kv("is_triggered_only", true));
  }
  if (def.immediate !== undefined) {
    const sink: PdxEntry[] = [];
    def.immediate(makeScope<S>(sink), ctx);
    entries.push(block("immediate", sink));
  }
  for (const option of def.options ?? []) {
    const optionEntries: PdxEntry[] = [kv("name", option.name)];
    if (option.trigger !== undefined) {
      optionEntries.push(block("trigger", [...option.trigger.entries]));
    }
    if (option.effects !== undefined) {
      const sink: PdxEntry[] = [];
      option.effects(makeScope<S>(sink), ctx);
      optionEntries.push(...sink);
    }
    entries.push(block("option", optionEntries));
  }

  return {
    kind: "event-ref",
    eventKind: kind,
    id,
    entry: block(EVENT_KEYS[kind], entries),
  };
}

export function defineCountryEvent<From extends ScopeName | undefined = undefined>(
  namespace: string,
  def: EventDef<"country", From>
): DefinedEvent<"country", From> {
  return defineEvent("country", namespace, def);
}

export function definePlanetEvent<From extends ScopeName | undefined = undefined>(
  namespace: string,
  def: EventDef<"planet", From>
): DefinedEvent<"planet", From> {
  return defineEvent("planet", namespace, def);
}
