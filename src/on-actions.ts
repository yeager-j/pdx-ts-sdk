import { block, list, scalar, serialize, type PdxEntry } from "@pdx-ts/pdxscript";

import type { DefinedEvent } from "./events.ts";
import type { ScopeName } from "./generated/scopes.ts";

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

  render(): string | undefined {
    if (this.registrations.length === 0) {
      return undefined;
    }
    const byHook = new Map<string, DefinedEvent<ScopeName, ScopeName | undefined>[]>();
    for (const registration of this.registrations) {
      const events = byHook.get(registration.hook.name) ?? [];
      events.push(registration.event);
      byHook.set(registration.hook.name, events);
    }
    const entries: PdxEntry[] = [...byHook].map(([name, events]) =>
      block(name, [
        list(
          "events",
          events.map((event) => scalar(event.id))
        ),
      ])
    );
    return serialize(entries);
  }
}

function contract(scope: ScopeName, from: ScopeName | undefined): string {
  return `${scope} scope${from === undefined ? " with no FROM" : ` with FROM ${from}`}`;
}
