/**
 * The stateful testing layer: `fixture()` builds a `World`, `world.fire()`
 * runs an event's immediate now, and `world.advance(days)` drains the
 * discrete-event queue.
 *
 * `advance` is a queue drain, NOT a tick simulation: it moves the clock,
 * delivers queued fires due in the window in timestamp order (LIFO within a
 * day), and lets delivered immediates enqueue more — cascades fall out
 * correctly. It ages NOTHING else: no MTTH rolls, no monthly income, no
 * pull-event evaluation, and no option auto-selection (delivery runs the
 * `immediate` block only).
 *
 * `fire` carries the FROM contract: the type-level witness pair mirrors the
 * SDK's fire effects (`from` is required iff the event declares `from:`,
 * forbidden otherwise), and `advance` re-checks the contract at delivery
 * against the registry's declared kinds — the harness restores type safety
 * on the one path production cannot check.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import type { DefinedEvent, EventRef, ScopeName } from "@pdx-ts/sdk";

import { applyEffectEntries, type ForcedArms } from "./interpret.ts";
import {
  ArchaeologicalSite,
  assertSupportedSimScope,
  buildState,
  Country,
  Fleet,
  renderEntity,
  sameEntity,
  Situation,
  type FiredRecord,
  type FixtureSpec,
  type PendingFire,
  type SimScope,
  type SimScopeName,
  type WorldState,
} from "./state.ts";
import { coverageSummary, InterpreterError, itemsAsEntries, type ExecCtx } from "./whitelist.ts";

export { DAYS_PER_MONTH, DAYS_PER_YEAR, type ForcedArms } from "./interpret.ts";

/** An event the fixture can deliver, narrowed to the scopes the sim models. */
export type SimEvent<
  S extends SimScopeName = SimScopeName,
  From extends SimScopeName | undefined = SimScopeName | undefined,
> = DefinedEvent<S, From>;

/** The event's main scope, as the sim models it. */
type EventScope<E> =
  E extends EventRef<infer S, ScopeName | undefined> ? Extract<S, SimScopeName> : never;

/** The event's declared FROM kind; `undefined` when contract-less. */
type EventFromKind<E> = E extends EventRef<ScopeName, infer F> ? F : undefined;

export interface EventRegistryEntry {
  /**
   * Widened past `SimEvent` (any `ScopeName`, any declared FROM) rather than
   * narrowed to what the fixture actually supports — see `FixtureOptions.events`'s
   * doc comment for why. `assertSupportedSimScope` is what turns an
   * unsupported scope caught here into a diagnosis instead of silent
   * acceptance.
   */
  readonly event: DefinedEvent<ScopeName, ScopeName | undefined>;
  /** The declared FROM kind, re-checked at delivery. */
  readonly from: SimScopeName | undefined;
}

/**
 * Registers an event that declares a FROM contract. The phantom is erased at
 * runtime, so the fixture needs the kind restated — this helper type-checks
 * the restatement against the phantom, one line per event.
 */
export function declareFrom<F extends SimScopeName>(
  event: SimEvent<SimScopeName, F>,
  from: F
): EventRegistryEntry {
  return { event, from };
}

export interface FixtureOptions {
  /**
   * Every event `advance` may deliver. Contract-less events register as bare
   * handles; events with a `from:` declaration go through `declareFrom`.
   *
   * The bare-handle arm accepts any `ScopeName`, not just `SimScopeName` —
   * narrowing it to `SimEvent` here would mean an ordinary unsupported event
   * (`defineLeaderEvent`, say) never reaches `World`'s constructor at all,
   * so `assertSupportedSimScope`'s diagnosis would never run and every
   * author would keep seeing TypeScript's own bare assignability failure
   * instead (SDK-49's second half). `From` stays pinned to `undefined` here
   * regardless: an event that declares a FROM contract still has to go
   * through `declareFrom`, supported scope or not, so that contract is
   * re-checked rather than silently dropped.
   */
  readonly events: ReadonlyArray<DefinedEvent<ScopeName, undefined> | EventRegistryEntry>;
}

interface HarnessFireOpts extends ForcedArms {
  readonly from?: SimScope<SimScopeName>;
}

function immediateEntriesOf(
  event: DefinedEvent<ScopeName, ScopeName | undefined>
): readonly PdxEntry[] | undefined {
  if (event.entry.value.kind !== "container") {
    return undefined;
  }
  const immediate = event.entry.value.items.find(
    (item): item is PdxEntry => item.kind === "entry" && item.key === "immediate"
  );
  if (immediate === undefined || immediate.value.kind !== "container") {
    return undefined;
  }
  return itemsAsEntries(immediate.value.items, "immediate");
}

export class World {
  private readonly state: WorldState;
  private readonly registry: Map<string, EventRegistryEntry>;

  constructor(state: WorldState, options: FixtureOptions) {
    this.state = state;
    this.registry = new Map();
    for (const registration of options.events) {
      const entry: EventRegistryEntry =
        "event" in registration ? registration : { event: registration, from: undefined };
      // The static types already require every registered event's scope (and
      // declared FROM) to be a SimScopeName; this is the runtime backstop for
      // events built from data rather than through the typed definers — see
      // `assertSupportedSimScope`'s doc comment.
      assertSupportedSimScope(entry.event.scope, `Registering event "${entry.event.id}"`);
      if (entry.from !== undefined) {
        assertSupportedSimScope(
          entry.from,
          `Registering event "${entry.event.id}"'s declared FROM contract`
        );
      }
      this.registry.set(entry.event.id, entry);
    }
  }

  country(index: number): Country {
    if (this.state.countries[index] === undefined) {
      throw new Error(`No country at index ${index} in this fixture`);
    }
    return new Country(this.state, index);
  }

  fleet(index: number): Fleet {
    if (this.state.fleets[index] === undefined) {
      throw new Error(`No fleet at index ${index} in this fixture`);
    }
    return new Fleet(this.state, index);
  }

  archaeologicalSite(index: number): ArchaeologicalSite {
    if (this.state.sites[index] === undefined) {
      throw new Error(`No archaeological site at index ${index} in this fixture`);
    }
    return new ArchaeologicalSite(this.state, index);
  }

  situation(index: number): Situation {
    if (this.state.situations[index] === undefined) {
      throw new Error(`No situation at index ${index} in this fixture`);
    }
    return new Situation(this.state, index);
  }

  get day(): number {
    return this.state.day;
  }

  /** The rich log: id, delivery day, firing scope, FROM. The failure trace. */
  get fired(): readonly FiredRecord[] {
    return this.state.fired;
  }

  get log(): readonly string[] {
    return this.state.log;
  }

  /**
   * Fires the event now, running its immediate. `from` is required iff the
   * event declares a FROM contract, forbidden otherwise. The whole event
   * type is the single inference site — scope and witness kinds are DERIVED
   * from it — so a wrong-kind witness cannot widen the inference and unify
   * (the same failure the SDK's fire effects prevent with `NoInfer`).
   */
  fire<E extends SimEvent>(
    event: E,
    scope: SimScope<EventScope<E>>,
    ...opts: [EventFromKind<E>] extends [SimScopeName]
      ? [opts: ForcedArms & { readonly from: SimScope<EventFromKind<E>> }]
      : [opts?: ForcedArms & { readonly from?: never }]
  ): void;
  fire(event: SimEvent, scope: SimScope<SimScopeName>, opts?: HarnessFireOpts): void {
    assertSupportedSimScope(event.scope, `Firing event "${event.id}"`);
    const registered = this.registry.get(event.id);
    if (registered !== undefined && registered.from !== undefined) {
      if (opts?.from === undefined || opts.from.id.kind !== registered.from) {
        throw new InterpreterError(
          `Event "${event.id}" declares from: "${registered.from}" — fire it with a matching ` +
            `FROM: world.fire(event, scope, { from }). ${coverageSummary()}`
        );
      }
    }
    this.deliver(
      {
        id: event.id,
        dueDay: this.state.day,
        scope: scope.id,
        from: opts?.from?.id,
        seq: this.state.seq++,
      },
      event,
      "harness",
      [...(opts?.arms ?? [])]
    );
  }

  /**
   * Moves the clock `days` forward, delivering queued fires due in the
   * window in (dueDay, reverse-enqueue-order) order; delivered immediates may
   * enqueue more, which also deliver if due. Ages nothing else.
   */
  advance(days: number): void {
    const end = this.state.day + days;
    for (;;) {
      const next = this.state.queue
        .filter((pending) => pending.dueDay <= end)
        .sort((a, b) => a.dueDay - b.dueDay || b.seq - a.seq)[0];
      if (next === undefined) {
        break;
      }
      this.state.queue.splice(this.state.queue.indexOf(next), 1);
      this.state.day = Math.max(this.state.day, next.dueDay);

      const registered = this.registry.get(next.id);
      if (registered === undefined) {
        throw new InterpreterError(
          `Queued event "${next.id}" is not registered with this fixture — pass it via ` +
            `fixture(spec, { events: [...] }) so delivery can run its immediate. ` +
            coverageSummary()
        );
      }
      if (registered.event.scope !== next.scope.kind) {
        throw new InterpreterError(
          `Queued event "${next.id}" is ${registered.event.scope}-scoped but was fired on a ` +
            `${next.scope.kind} scope. ${coverageSummary()}`
        );
      }
      if (registered.from !== undefined && next.from?.kind !== registered.from) {
        throw new InterpreterError(
          `Queued event "${next.id}" declares from: "${registered.from}" but was delivered ` +
            `with FROM ${next.from === undefined ? "unbound" : `a ${next.from.kind}`}. ` +
            coverageSummary()
        );
      }
      this.deliver(next, registered.event, "effect", []);
    }
    this.state.day = end;
  }

  private deliver(
    pending: PendingFire,
    event: DefinedEvent<ScopeName, ScopeName | undefined>,
    via: FiredRecord["via"],
    forcedArms: number[]
  ): void {
    this.state.fired.push({
      id: pending.id,
      day: this.state.day,
      scope: pending.scope,
      from: pending.from,
      via,
      scopeLabel: renderEntity(this.state, pending.scope),
      fromLabel: pending.from === undefined ? undefined : renderEntity(this.state, pending.from),
    });
    const entries = immediateEntriesOf(event);
    if (entries !== undefined) {
      const ex: ExecCtx = {
        state: this.state,
        root: pending.scope,
        from: pending.from,
        forcedArms,
        targets: new Map(),
      };
      applyEffectEntries(entries, pending.scope, ex);
    }
  }
}

export function fixture(spec: FixtureSpec, options: FixtureOptions): World {
  return new World(buildState(spec), options);
}

/** Renders the fired log for goldens and failure messages. */
export function renderFired(world: World): string {
  return renderFiredRecords(world.fired);
}

export function renderFiredRecords(records: readonly FiredRecord[]): string {
  return records
    .map((record) => {
      const from = record.fromLabel === undefined ? "" : ` from ${record.fromLabel}`;
      return `[day ${record.day}] ${record.id} @ ${record.scopeLabel}${from} via ${record.via}`;
    })
    .join("\n");
}

export function containsFired(
  records: readonly FiredRecord[],
  eventId: string,
  details?: { readonly day?: number; readonly from?: SimScope<SimScopeName> }
): boolean {
  return records.some(
    (record) =>
      record.id === eventId &&
      (details?.day === undefined || record.day === details.day) &&
      (details?.from === undefined || sameEntity(record.from, details.from.id))
  );
}
