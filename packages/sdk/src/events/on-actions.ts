import { block, list, scalar, type PdxEntry } from "@pdx-ts/pdxscript";

import type { EventItem, EventItemBase, OnActionBindingItem } from "../authoring/feature.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { compareUtf8 } from "../ordering.ts";
import type { DefinedEvent } from "./types.ts";

export interface OnActionRef<
  S extends ScopeName | null = ScopeName | null,
  From extends ScopeName | undefined = ScopeName | undefined,
> {
  readonly kind: "on-action-ref";
  readonly name: string;
  /** The event scope supplied by the hook; null means the hook is scopeless. */
  readonly scope: S;
  /** The FROM scope supplied by the hook, when one is available. */
  readonly from: From;
}

interface Registration {
  readonly hook: OnActionRef;
  readonly event: DefinedEvent<ScopeName, ScopeName | undefined>;
}

export class OnActionAuthoring {
  private readonly registrations: Registration[] = [];
  private readonly ownsEvent: (event: DefinedEvent<ScopeName, ScopeName | undefined>) => boolean;

  constructor(ownsEvent: (event: DefinedEvent<ScopeName, ScopeName | undefined>) => boolean) {
    this.ownsEvent = ownsEvent;
  }

  register(hook: OnActionRef, event: DefinedEvent<ScopeName, ScopeName | undefined>): void {
    if (hook.scope === null) {
      throw new Error(
        `On-action "${hook.name}" has no scope; scopeless events are not supported by this SDK`
      );
    }
    if (!this.ownsEvent(event)) {
      throw new Error(
        `Event "${event.id}" is not among the collections passed to buildMod; on-action ` +
          `"${hook.name}" can only fire this mod's own events`
      );
    }
    if (hook.scope !== event.scope || hook.from !== event.from) {
      throw new Error(
        `On-action "${hook.name}" supplies ${contract(hook.scope, hook.from)}, but event ` +
          `"${event.id}" declares ${contract(event.scope, event.from)}`
      );
    }
    if (
      this.registrations.some(
        (registration) => registration.hook.name === hook.name && registration.event === event
      )
    ) {
      throw new Error(`Event "${event.id}" is already registered on on-action "${hook.name}"`);
    }
    this.registrations.push({ hook, event });
  }

  /** The finished hook blocks. `buildMod` keeps this instance to itself and
   * puts only these entries on the mod, so nothing can register after the fold. */
  entries(): PdxEntry[] {
    const byHook = new Map<string, DefinedEvent<ScopeName, ScopeName | undefined>[]>();
    for (const registration of this.registrations) {
      const events = byHook.get(registration.hook.name) ?? [];
      events.push(registration.event);
      byHook.set(registration.hook.name, events);
    }
    // Hook blocks sort by hook name (SDK-23: emission order is a function of
    // content, never of registration order). The events inside one hook keep
    // registration order — that list is author data, and the game fires it as
    // written.
    return [...byHook]
      .sort(([a], [b]) => compareUtf8(a, b))
      .map(([name, events]) =>
        block(name, [
          list(
            "events",
            events.map((event) => scalar(event.id))
          ),
        ])
      );
  }
}

function contract(scope: ScopeName, from: ScopeName | undefined): string {
  return `${scope} scope${from === undefined ? " with no FROM" : ` with FROM ${from}`}`;
}

/** Creates one capability-owned on-action binding. */
export function on<S extends ScopeName, From extends ScopeName | undefined>(
  hook: OnActionRef<S, From>,
  events: readonly [EventItem<NoInfer<S>, NoInfer<From>>, ...EventItem<NoInfer<S>, NoInfer<From>>[]]
): OnActionBindingItem {
  return { itemKind: "on-action", hook, events: events as readonly EventItemBase[] };
}
