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
 * Both halves of that are refusals rather than notes now. Registration reads
 * the whole event body and refuses an event carrying script delivery would
 * skip (`assertDeliverable`), and `advance` refuses to cross a month boundary
 * while a situation's monthly progress would silently stand still
 * (`assertSituationClock`) — the same discipline the whitelist keys have,
 * applied one level up, where a fired record for an event the game would not
 * have fired is the green test.
 *
 * `fire` carries the FROM contract: the type-level witness pair mirrors the
 * SDK's fire effects (`from` is required iff the event declares `from:`,
 * forbidden otherwise), and `advance` re-checks the contract at delivery
 * against the registry's declared kinds — the harness restores type safety
 * on the one path production cannot check.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";
import type { DefinedEvent, EventRef, ScopeName } from "@pdx-ts/sdk";

import {
  applyEffectEntries,
  assertChoicePlanConsumed,
  DAYS_PER_MONTH,
  type ForcedArms,
} from "./interpret.ts";
import {
  ArchaeologicalSite,
  assertSupportedSimScope,
  buildState,
  cloneState,
  commitState,
  Country,
  Fleet,
  renderEntity,
  sameEntity,
  Situation,
  type ChoicePlanState,
  type FiredRecord,
  type FixtureSpec,
  type PendingFire,
  type SimScope,
  type SimScopeName,
  type WorldState,
} from "./state.ts";
import {
  coverageSummary,
  eventFieldDeliveryFor,
  InterpreterError,
  itemsAsEntries,
  optionCarriesEffects,
  type ExecCtx,
} from "./whitelist.ts";

export { DAYS_PER_MONTH, DAYS_PER_YEAR, type ForcedArms } from "./interpret.ts";

/** An event the fixture can deliver, narrowed to the scopes the sim models. */
export type SimEvent<
  S extends SimScopeName = SimScopeName,
  From extends SimScopeName | undefined = SimScopeName | undefined,
> = DefinedEvent<S, From, string>;

/** The event's main scope, as the sim models it. */
type EventScope<E> =
  E extends EventRef<infer S, ScopeName | undefined, string> ? Extract<S, SimScopeName> : never;

/** The event's declared FROM kind; `undefined` when contract-less. */
type EventFromKind<E> = E extends EventRef<ScopeName, infer F, string> ? F : undefined;

export interface FixtureOptions {
  /**
   * Every event `advance` may deliver. Runtime scope and FROM metadata come
   * directly from the authored `DefinedEvent`.
   *
   * The list accepts any `ScopeName`, not just `SimScopeName` — narrowing it
   * to `SimEvent` here would mean an ordinary unsupported event
   * (`defineLeaderEvent`, say) never reaches `World`'s constructor at all,
   * so `assertSupportedSimScope`'s diagnosis would never run and every
   * author would keep seeing TypeScript's own bare assignability failure
   * instead (SDK-49's second half).
   */
  readonly events: ReadonlyArray<DefinedEvent<ScopeName, ScopeName | undefined, string>>;
}

interface HarnessFireOpts extends ForcedArms {
  readonly from?: SimScope<SimScopeName>;
}

function immediateEntriesOf(
  event: DefinedEvent<ScopeName, ScopeName | undefined, string>
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

/**
 * Refuses an event whose body carries structure delivery will never run.
 *
 * Registration rather than delivery, because the fixture's event list is where
 * an author says what this world is made of: an event that cannot be delivered
 * honestly should never become deliverable, and finding that out at the fire
 * that happens to reach it — or worse, at a queued delivery days later — is the
 * same surprise arriving later. The disposition and the reason both come from
 * `EVENT_FIELD_DELIVERY`, so this reads the table and never restates it.
 */
function assertDeliverable(event: DefinedEvent<ScopeName, ScopeName | undefined, string>): void {
  if (event.entry.value.kind !== "container") {
    return;
  }
  for (const field of itemsAsEntries(event.entry.value.items, `Event "${event.id}"`)) {
    const why = deliveryRefusal(field);
    if (why !== undefined) {
      throw new InterpreterError(
        `Event "${event.id}" carries "${field.key}", which delivery will not run: ${why} ` +
          coverageSummary()
      );
    }
  }
}

/**
 * Whether the event's body says the game fires it only once, read through the
 * same table the rest of delivery reads — the `once` disposition is the flag's
 * whole definition here, so a second field earning it needs no code change.
 *
 * `= no` is not that claim, so it says nothing: a field that spells the flag
 * out as false leaves the event as repeatable as one that never wrote it.
 */
function firesOnlyOnce(event: DefinedEvent<ScopeName, ScopeName | undefined, string>): boolean {
  if (event.entry.value.kind !== "container") {
    return false;
  }
  return itemsAsEntries(event.entry.value.items, `Event "${event.id}"`).some(
    (field) =>
      eventFieldDeliveryFor(field.key)?.disposition === "once" &&
      field.value.kind === "bool" &&
      field.value.value
  );
}

/** Why this field makes its event undeliverable, or `undefined` when it does not. */
function deliveryRefusal(field: PdxEntry): string | undefined {
  const delivery = eventFieldDeliveryFor(field.key);
  if (delivery === undefined) {
    return (
      `it is not a field the SDK's own event policy declares, so nothing here knows whether ` +
      `delivering this event would skip it.`
    );
  }
  if (delivery.disposition === "refused") {
    return delivery.note;
  }
  if (delivery.disposition !== "options") {
    return undefined;
  }
  const effects = optionCarriesEffects(field);
  return effects.length === 0
    ? undefined
    : `${delivery.note} This one carries ${effects.join(", ")}.`;
}

export class World {
  private readonly state: WorldState;
  private readonly registry: Map<string, DefinedEvent<ScopeName, ScopeName | undefined, string>>;

  constructor(state: WorldState, options: FixtureOptions) {
    this.state = state;
    this.registry = new Map();
    for (const event of options.events) {
      // FixtureOptions deliberately accepts every authored event kind so an
      // unsupported scope reaches this targeted diagnosis instead of failing
      // as an opaque assignability error at the call site.
      assertSupportedSimScope(event.scope, `Registering event "${event.id}"`);
      if (event.from !== undefined) {
        assertSupportedSimScope(
          event.from,
          `Registering event "${event.id}"'s declared FROM contract`
        );
      }
      if (this.registry.has(event.id)) {
        throw new InterpreterError(
          `Event "${event.id}" is registered more than once; event IDs must be unique. ` +
            coverageSummary()
        );
      }
      assertDeliverable(event);
      this.registry.set(event.id, event);
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
    if (registered !== event) {
      throw new InterpreterError(
        `Event "${event.id}" is not registered with this fixture — pass this exact event via ` +
          `fixture(spec, { events: [...] }) before firing it. ${coverageSummary()}`
      );
    }
    if (event.scope !== scope.id.kind) {
      throw new InterpreterError(
        `Event "${event.id}" is ${event.scope}-scoped but was fired on a ${scope.id.kind} scope. ` +
          coverageSummary()
      );
    }
    if (event.from === undefined) {
      if (opts?.from !== undefined) {
        throw new InterpreterError(
          `Event "${event.id}" does not declare FROM, so fire it without a FROM witness. ` +
            coverageSummary()
        );
      }
    } else {
      if (opts?.from === undefined || opts.from.id.kind !== event.from) {
        throw new InterpreterError(
          `Event "${event.id}" declares from: "${event.from}" — fire it with a matching ` +
            `FROM: world.fire(event, scope, { from }). ${coverageSummary()}`
        );
      }
    }
    this.transact((state) => {
      const choicePlan: ChoicePlanState = { arms: [...(opts?.arms ?? [])], next: 0 };
      this.deliver(
        state,
        {
          id: event.id,
          dueDay: state.day,
          scope: scope.id,
          from: opts?.from?.id,
          seq: state.seq++,
          choicePlan,
        },
        event,
        "harness"
      );
    });
  }

  /**
   * Moves the clock `days` forward, delivering queued fires due in the
   * window in (dueDay, reverse-enqueue-order) order; delivered immediates may
   * enqueue more, which also deliver if due. Ages nothing else.
   */
  advance(days: number): void {
    if (!Number.isSafeInteger(days) || days < 0) {
      throw new InterpreterError(
        `advance days must be a non-negative safe integer, got ${String(days)}. ` +
          coverageSummary()
      );
    }
    const end = this.state.day + days;
    if (!Number.isSafeInteger(end)) {
      throw new InterpreterError(
        `advance would move the world to an unsafe day value (${String(end)}). ` + coverageSummary()
      );
    }
    this.assertSituationClock(end);
    for (;;) {
      const next = this.state.queue
        .filter((pending) => pending.dueDay <= end)
        .sort((a, b) => a.dueDay - b.dueDay || b.seq - a.seq)[0];
      if (next === undefined) {
        break;
      }
      const registered = this.registry.get(next.id);
      if (registered === undefined) {
        throw new InterpreterError(
          `Queued event "${next.id}" is not registered with this fixture — pass it via ` +
            `fixture(spec, { events: [...] }) so delivery can run its immediate. ` +
            coverageSummary()
        );
      }
      if (registered.from !== undefined && next.from?.kind !== registered.from) {
        throw new InterpreterError(
          `Queued event "${next.id}" declares from: "${registered.from}" but was delivered ` +
            `with FROM ${next.from === undefined ? "unbound" : `a ${next.from.kind}`}. ` +
            coverageSummary()
        );
      }
      this.transact((state) => {
        const draftNext = state.queue.find((pending) => pending.seq === next.seq);
        if (draftNext === undefined) {
          throw new Error(`unreachable: queued event ${next.seq} disappeared from cloned state`);
        }
        state.queue.splice(state.queue.indexOf(draftNext), 1);
        state.day = Math.max(state.day, draftNext.dueDay);
        this.deliver(state, draftNext, registered, "effect");
      });
    }
    this.state.day = end;
  }

  /**
   * The situation clock, decided: this harness does not have one, and says so
   * at the moment the difference starts to matter.
   *
   * A situation is a monthly mechanic — the game ticks `monthly_progress`,
   * runs `on_monthly`, moves between stages and finishes at `total_progress`,
   * every month, and that ticking is the whole reason situations exist. None
   * of it is modeled: `advance` is a queue drain, so progress stays exactly
   * where the fixture put it however far the clock moves. Modeling the
   * arithmetic alone would be worse than modeling none of it — progress would
   * sail past the completion the game ends the situation at, and every
   * assertion after that point would be green for a world the game was never
   * in.
   *
   * So a crossed month boundary with a situation in the fixture is refused
   * rather than quietly frozen, on the same terms as every unimplemented key
   * here. Months are the 30-day months this harness already commits to in its
   * own delay arithmetic (`DAYS_PER_MONTH`), not the calendar's.
   *
   * `SituationSpec.staticProgress` is the way through: it is the author saying
   * the chain under test does not depend on this situation's progress moving,
   * which is a claim a reader can check. What it never becomes is a default.
   */
  private assertSituationClock(end: number): void {
    const crossed = Math.floor(end / DAYS_PER_MONTH) > Math.floor(this.state.day / DAYS_PER_MONTH);
    if (!crossed) {
      return;
    }
    const ticking = this.state.situations.filter((situation) => !situation.staticProgress);
    if (ticking.length === 0) {
      return;
    }
    throw new InterpreterError(
      `advance would move the world from day ${this.state.day} to day ${end}, crossing a month ` +
        `boundary while the fixture holds ${ticking.length} situation` +
        `${ticking.length === 1 ? "" : "s"} whose progress this harness does not tick ` +
        `(${ticking.map((situation) => `"${situation.name}"`).join(", ")}). Situations advance ` +
        `monthly in game — monthly_progress, on_monthly, stage transitions, completion — and none ` +
        `of that is modeled, so every month crossed here is a month the real situation moved and ` +
        `this one did not. Compute the arithmetic directly instead ` +
        `(evaluateWeightBlock(type.def.monthlyProgress, world.situation(n))), keep the advance ` +
        `inside the month, or declare staticProgress: true on the situation to state that this ` +
        `chain does not depend on its progress. ${coverageSummary()}`
    );
  }

  private deliver(
    state: WorldState,
    pending: PendingFire,
    event: DefinedEvent<ScopeName, ScopeName | undefined, string>,
    via: FiredRecord["via"]
  ): void {
    // The fired log is the ledger — a second delivery of a fire-only-once
    // event is a firing the game would not have made, and running its
    // immediate again would apply its effects to a world no game ever held.
    // Read rather than stored: `fired` already records every delivery, and it
    // is already rolled back with everything else when one fails.
    const delivered = state.fired.find((record) => record.id === pending.id);
    if (delivered !== undefined && firesOnlyOnce(event)) {
      throw new InterpreterError(
        `Event "${pending.id}" declares fire_only_once and was already delivered in this world ` +
          `(day ${delivered.day}, ${delivered.scopeLabel}), so the game would not fire it again. ` +
          `${eventFieldDeliveryFor("fire_only_once")?.note ?? ""} ${coverageSummary()}`
      );
    }
    state.fired.push({
      id: pending.id,
      day: state.day,
      scope: pending.scope,
      from: pending.from,
      via,
      scopeLabel: renderEntity(state, pending.scope),
      fromLabel: pending.from === undefined ? undefined : renderEntity(state, pending.from),
    });
    const entries = immediateEntriesOf(event);
    if (entries !== undefined) {
      const ex: ExecCtx = {
        state,
        root: pending.scope,
        from: pending.from,
        choicePlan: pending.choicePlan,
        targets: new Map(),
      };
      applyEffectEntries(entries, pending.scope, ex);
    }
    if (!state.queue.some((queued) => queued.choicePlan === pending.choicePlan)) {
      assertChoicePlanConsumed(pending.choicePlan);
    }
  }

  private transact(apply: (draft: WorldState) => void): void {
    const draft = cloneState(this.state);
    apply(draft);
    commitState(this.state, draft);
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
