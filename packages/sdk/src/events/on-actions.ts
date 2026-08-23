import { block, list, scalar, type PdxEntry } from "@pdx-ts/pdxscript";

import type { EventScopelessRef } from "../generated/refs.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { compareUtf8 } from "../ordering.ts";
import { refId } from "../script/scalar.ts";
import { isAuthoredEvent, type EventItem, type EventItemBase, type EventRef } from "./types.ts";
import { weightedEventBlock, type WeightedEventRow } from "./weighted-events.ts";

/** A generated game hook with its event scope and FROM contract. */
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

interface OnActionHookItemBase {
  readonly itemKind: "on-action";
  readonly hook: OnActionRef;
}

/** Authored event lists attached to one game hook, with at least one non-empty list. */
export type OnActionHookItem = OnActionHookItemBase &
  (
    | {
        /** Ordinary events retain author order and must be placed in this mod. */
        readonly events: NonEmpty<EventItemBase>;
        /** Weighted choices retain author order and may repeat weights or event ids. */
        readonly randomEvents?: NonEmpty<OnActionRandomEvent>;
      }
    | {
        /** Ordinary events retain author order and must be placed in this mod. */
        readonly events?: NonEmpty<EventItemBase>;
        /** Weighted choices retain author order and may repeat weights or event ids. */
        readonly randomEvents: NonEmpty<OnActionRandomEvent>;
      }
  );

type OnActionEventReference<
  S extends ScopeName | null,
  From extends ScopeName | undefined,
> = S extends null ? EventScopelessRef : EventRef<Extract<S, ScopeName>, From>;

/** One weighted on-action choice; omit `event` for the literal `0` no-op arm. */
export type OnActionRandomEvent<
  S extends ScopeName | null = ScopeName | null,
  From extends ScopeName | undefined = ScopeName | undefined,
> = WeightedEventRow<OnActionEventReference<S, From> | string>;

type NonEmpty<T> = readonly [T, ...T[]];

/** The object form of a scoped on-action contribution, with at least one non-empty list. */
export type OnActionEvents<S extends ScopeName, From extends ScopeName | undefined> =
  | {
      readonly events: NonEmpty<EventItem<NoInfer<S>, NoInfer<From>>>;
      readonly randomEvents?: NonEmpty<OnActionRandomEvent<NoInfer<S>, NoInfer<From>>>;
    }
  | {
      readonly events?: NonEmpty<EventItem<NoInfer<S>, NoInfer<From>>>;
      readonly randomEvents: NonEmpty<OnActionRandomEvent<NoInfer<S>, NoInfer<From>>>;
    };

/** The object form for a scopeless hook, which accepts checked or raw event references. */
export interface ScopelessOnActionEvents {
  readonly events?: never;
  readonly randomEvents: NonEmpty<OnActionRandomEvent<null, undefined>>;
}

interface HookedEvent {
  readonly hook: OnActionRef;
  readonly event: EventItemBase;
}

interface HookedRandomEvent {
  readonly hook: OnActionRef;
  readonly row: OnActionRandomEvent;
}

/** Fold-local accumulator that validates and assembles the shared on-action file. */
export class OnActionAuthoring {
  private readonly hooked: HookedEvent[] = [];
  private readonly hookedRandom: HookedRandomEvent[] = [];
  private readonly ownsEvent: (event: EventItemBase) => boolean;
  private readonly eventExists: (id: string) => boolean;
  private readonly prefix: string;

  /** Creates an accumulator with the selected Feature set as its ownership authority. */
  constructor(
    prefix: string,
    ownsEvent: (event: EventItemBase) => boolean,
    eventExists: (id: string) => boolean
  ) {
    this.prefix = prefix;
    this.ownsEvent = ownsEvent;
    this.eventExists = eventExists;
  }

  /** Adds one ordinary event after validating ownership and the hook contract. */
  register(hook: OnActionRef, event: EventItemBase): void {
    if (hook.scope === null) {
      throw new Error(
        `On-action "${hook.name}" has no scope; ordinary events require a scoped hook`
      );
    }
    this.assertOwnedEvent(hook, event);
    if (
      this.hooked.some(
        (registration) => registration.hook.name === hook.name && registration.event === event
      )
    ) {
      throw new Error(`Event "${event.id}" is already registered on on-action "${hook.name}"`);
    }
    this.hooked.push({ hook, event });
  }

  /** Adds one weighted row, validating authored values without deduplicating probability arms. */
  registerRandom(hook: OnActionRef, row: OnActionRandomEvent): void {
    if (isAuthoredEvent(row.event)) {
      this.assertOwnedEvent(hook, row.event);
    } else if (typeof row.event === "string") {
      this.assertRawEventExists(row.event, hook);
    }
    this.hookedRandom.push({ hook, row });
  }

  private assertOwnedEvent(hook: OnActionRef, event: EventItemBase): void {
    if (!this.ownsEvent(event)) {
      throw new Error(
        `Event "${event.id}" is not among the features passed to buildMod; on-action ` +
          `"${hook.name}" can only fire this mod's own authored events`
      );
    }
    if (hook.scope !== event.scope || hook.from !== event.from) {
      throw new Error(
        `On-action "${hook.name}" supplies ${contract(hook.scope, hook.from)}, but event ` +
          `"${event.id}" declares ${contract(event.scope, event.from)}`
      );
    }
  }

  private assertRawEventExists(id: string, hook: OnActionRef): void {
    const ownEventId = new RegExp(`^${this.prefix}(_[a-z0-9_]*)?\\.\\d+$`);
    if (ownEventId.test(id) && !this.eventExists(id)) {
      throw new Error(
        `On-action "${hook.name}" references event "${id}", which looks like one of this ` +
          `mod's event ids but is not among the features passed to buildMod`
      );
    }
  }

  /** The finished hook blocks, with no mutable authoring state exposed. */
  entries(): PdxEntry[] {
    const byHook = new Map<
      string,
      { events: EventItemBase[]; randomEvents: OnActionRandomEvent[] }
    >();
    for (const registration of this.hooked) {
      const contribution = byHook.get(registration.hook.name) ?? emptyContribution();
      contribution.events.push(registration.event);
      byHook.set(registration.hook.name, contribution);
    }
    for (const registration of this.hookedRandom) {
      const contribution = byHook.get(registration.hook.name) ?? emptyContribution();
      contribution.randomEvents.push(registration.row);
      byHook.set(registration.hook.name, contribution);
    }
    return [...byHook]
      .sort(([a], [b]) => compareUtf8(a, b))
      .map(([name, contribution]) => {
        const entries: PdxEntry[] = [];
        if (contribution.events.length > 0) {
          entries.push(
            list(
              "events",
              contribution.events.map((event) => scalar(event.id))
            )
          );
        }
        if (contribution.randomEvents.length > 0) {
          entries.push(
            weightedEventBlock("random_events", contribution.randomEvents, (event) =>
              scalar(eventId(event))
            )
          );
        }
        return block(name, entries);
      });
  }
}

function emptyContribution(): {
  events: EventItemBase[];
  randomEvents: OnActionRandomEvent[];
} {
  return { events: [], randomEvents: [] };
}

function contract(scope: ScopeName | null, from: ScopeName | undefined): string {
  const describedScope = scope === null ? "no scope" : `${scope} scope`;
  return `${describedScope}${from === undefined ? " with no FROM" : ` with FROM ${from}`}`;
}

function eventId(event: NonNullable<OnActionRandomEvent["event"]>): string {
  return String(refId(event));
}

/** Returns the canonical sort key for one contribution without changing list order. */
export function onActionContributionKey(item: OnActionHookItem): string {
  return JSON.stringify([
    item.events?.map((event) => event.id) ?? [],
    item.randomEvents?.map((row) => [String(row.weight), row.event && eventId(row.event)]) ?? [],
  ]);
}

/** Creates one capability-owned ordinary on-action binding. */
export function on<S extends ScopeName, From extends ScopeName | undefined>(
  hook: OnActionRef<S, From>,
  events: NonEmpty<EventItem<NoInfer<S>, NoInfer<From>>>
): OnActionHookItem;
/** Creates one capability-owned scoped on-action contribution. */
export function on<S extends ScopeName, From extends ScopeName | undefined>(
  hook: OnActionRef<S, From>,
  events: OnActionEvents<S, From>
): OnActionHookItem;
/** Creates one capability-owned scopeless random on-action contribution. */
export function on(
  hook: OnActionRef<null, undefined>,
  events: ScopelessOnActionEvents
): OnActionHookItem;
export function on(
  hook: OnActionRef,
  events:
    | readonly EventItemBase[]
    | {
        readonly events?: readonly EventItemBase[];
        readonly randomEvents?: readonly OnActionRandomEvent[];
      }
): OnActionHookItem {
  const contribution: {
    readonly events?: readonly EventItemBase[];
    readonly randomEvents?: readonly OnActionRandomEvent[];
  } = Array.isArray(events)
    ? { events: events as readonly EventItemBase[] }
    : (events as {
        readonly events?: readonly EventItemBase[];
        readonly randomEvents?: readonly OnActionRandomEvent[];
      });
  if (contribution.events?.length === 0) {
    throw new Error(`On-action "${hook.name}" events must contain at least one event`);
  }
  if (contribution.randomEvents?.length === 0) {
    throw new Error(`On-action "${hook.name}" randomEvents must contain at least one row`);
  }
  if (contribution.events === undefined && contribution.randomEvents === undefined) {
    throw new Error(`On-action "${hook.name}" must define events, randomEvents, or both`);
  }
  return { itemKind: "on-action", hook, ...contribution } as OnActionHookItem;
}
