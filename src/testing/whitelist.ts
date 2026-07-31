/**
 * The interpreter's whitelist — one audited table;
 * adding an entry should feel expensive. Every entry carries a `note`
 * defending its semantics against the real game, because a wrong emulator is
 * worse than no emulator: every divergence is a green test for broken
 * behavior. Anything not listed here throws at evaluation time with the
 * coverage summary — nothing evaluates silently.
 *
 * Split, mirroring the handoff: leaf triggers, combinators, leaf effects,
 * structural effects (implemented in the walker, listed here for the audit),
 * iterators (fixture relations), and scope links (navigation).
 */

import type { PdxEntry, PdxItem, PdxScalar } from "@pdx-ts/pdxscript";

import {
  countryState,
  describeEntity,
  planetState,
  type EntityId,
  type WorldState,
} from "./state.ts";

/** The execution context an interpretation runs under. */
export interface ExecCtx {
  readonly state: WorldState;
  /** The scope the event/effect run started in — the natural FROM for fires. */
  readonly root: EntityId;
  /** FROM as bound by the harness or the fire that queued this run. */
  readonly from: EntityId | undefined;
  /** Forced random_list arms (weight keys), consumed in encounter order. */
  readonly forcedArms: number[];
  /** Saved targets visible during this event/effect execution. */
  readonly targets: Map<string, EntityId>;
}

export class InterpreterError extends Error {}

/**
 * Narrows container items to entries, loudly: authored SDK content never
 * records bare items, so one appearing here is an interpreter gap.
 */
export function itemsAsEntries(items: readonly PdxItem[], where: string): readonly PdxEntry[] {
  return items.map((item) => {
    if (item.kind !== "entry") {
      throw new InterpreterError(
        `${where}: bare ${item.kind} items are not modeled. ${coverageSummary()}`
      );
    }
    return item;
  });
}

function scalarOf(entry: PdxEntry): PdxScalar {
  if (entry.value.kind === "container") {
    throw new InterpreterError(
      `${entry.key}: expected a scalar value, got a container. ${coverageSummary()}`
    );
  }
  return entry.value;
}

function renderScalar(value: PdxScalar): string {
  switch (value.kind) {
    case "bool":
      return value.value ? "yes" : "no";
    case "num":
      return String(value.value);
    case "str":
      return value.value;
    case "var":
      return value.name;
    case "math":
      return value.source;
  }
}

function stringArg(entry: PdxEntry): string {
  const value = scalarOf(entry);
  if (value.kind !== "str") {
    throw new InterpreterError(
      `${entry.key}: expected a name, got ${renderScalar(value)}. ${coverageSummary()}`
    );
  }
  return value.value;
}

/**
 * The numeric v1 line (handoff open question 3): literals and fixture-stored
 * numbers evaluate; script values and variables throw.
 */
function numberArg(entry: PdxEntry): number {
  const value = scalarOf(entry);
  if (value.kind !== "num") {
    const rendered = renderScalar(value);
    throw new InterpreterError(
      `${entry.key} ${entry.op} ${rendered}: expected a number — the numeric v1 line evaluates ` +
        `literals and fixture-stored numbers only; script values and variables are out. ` +
        coverageSummary()
    );
  }
  return value.value;
}

function boolArg(entry: PdxEntry): boolean {
  const value = scalarOf(entry);
  if (value.kind !== "bool") {
    throw new InterpreterError(
      `${entry.key}: expected yes/no, got ${renderScalar(value)}. ${coverageSummary()}`
    );
  }
  return value.value;
}

function compare(actual: number, op: PdxEntry["op"], expected: number): boolean {
  switch (op) {
    case "=":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">":
      return actual > expected;
    case "<":
      return actual < expected;
    case ">=":
      return actual >= expected;
    case "<=":
      return actual <= expected;
  }
}

// ---------------------------------------------------------------------------
// Leaf triggers
// ---------------------------------------------------------------------------

export interface TriggerImpl {
  /** One line defending this semantic against the real game. */
  readonly note: string;
  readonly eval: (
    entry: PdxEntry,
    scope: EntityId,
    ex: ExecCtx
  ) => { result: boolean; detail: string };
}

export const TRIGGER_SEMANTICS: Readonly<Record<string, TriggerImpl>> = {
  has_country_flag: {
    note: "Country flags are a plain string set; set/unset with no expiry modeled.",
    eval: (entry, scope, ex) => {
      const flag = stringArg(entry);
      const result = countryState(ex.state, scope).flags.has(flag);
      const where = describeEntity(ex.state, scope);
      return { result, detail: result ? `set on ${where}` : `not set on ${where}` };
    },
  },
  has_global_flag: {
    note: "Global flags are one world-wide string set.",
    eval: (entry, _scope, ex) => {
      const flag = stringArg(entry);
      const result = ex.state.globalFlags.has(flag);
      return { result, detail: result ? "set globally" : "not set globally" };
    },
  },
  has_owner: {
    note: "Every fixture planet is owned by its nesting country, so this is true by construction; kept because the real chain's limit uses it.",
    eval: (entry, scope, ex) => {
      planetState(ex.state, scope);
      if (scope.kind !== "planet") {
        throw new InterpreterError("unreachable: planetState guards the kind");
      }
      const owner = describeEntity(ex.state, { kind: "country", country: scope.country });
      return { result: boolArg(entry), detail: `owned by ${owner}` };
    },
  },
  has_technology: {
    note: "Researched techs are a string set of tech ids; give_technology adds to it.",
    eval: (entry, scope, ex) => {
      const tech = stringArg(entry);
      const result = countryState(ex.state, scope).technologies.has(tech);
      return { result, detail: result ? "researched" : "not researched" };
    },
  },
  num_owned_planets: {
    note: "Compares against the fixture ownership relation's size (planets nested under the country).",
    eval: (entry, scope, ex) => {
      countryState(ex.state, scope);
      const expected = numberArg(entry);
      const actual = scope.kind === "country" ? (ex.state.planets[scope.country]?.length ?? 0) : 0;
      return {
        result: compare(actual, entry.op, expected),
        detail: `${actual} owned planet${actual === 1 ? "" : "s"}`,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Combinators — implemented in the walker, audited here
// ---------------------------------------------------------------------------

export interface CombinatorImpl {
  readonly note: string;
  /** all = every child true; any = some child true; none = every child false. */
  readonly mode: "all" | "any" | "none";
}

export const COMBINATOR_SEMANTICS: Readonly<Record<string, CombinatorImpl>> = {
  AND: { note: "Every entry must hold — same as PDXScript's implicit sibling AND.", mode: "all" },
  OR: { note: "At least one entry must hold.", mode: "any" },
  NOT: {
    note: "Paradox's NOT is actually NOR over its entries: true iff every entry is false.",
    mode: "none",
  },
};

// ---------------------------------------------------------------------------
// Leaf effects
// ---------------------------------------------------------------------------

export interface EffectImpl {
  readonly note: string;
  readonly apply: (entry: PdxEntry, scope: EntityId, ex: ExecCtx) => void;
}

function blockEntries(entry: PdxEntry): readonly PdxEntry[] {
  if (entry.value.kind !== "container") {
    throw new InterpreterError(
      `${entry.key}: expected a block, got a ${entry.value.kind}. ${coverageSummary()}`
    );
  }
  return itemsAsEntries(entry.value.items, entry.key);
}

export const EFFECT_SEMANTICS: Readonly<Record<string, EffectImpl>> = {
  set_country_flag: {
    note: "Adds to the country's flag set; re-setting an existing flag is a no-op, as in game.",
    apply: (entry, scope, ex) => {
      countryState(ex.state, scope).flags.add(stringArg(entry));
    },
  },
  add_resource: {
    note: "Adds to the stockpile; a missing stockpile starts at 0. `mult` is not modeled — loud error.",
    apply: (entry, scope, ex) => {
      const country = countryState(ex.state, scope);
      for (const field of blockEntries(entry)) {
        if (field.key === "mult") {
          throw new InterpreterError(
            `add_resource with mult is not modeled by the testing interpreter. ${coverageSummary()}`
          );
        }
        const amount = numberArg(field);
        country.resources.set(field.key, (country.resources.get(field.key) ?? 0) + amount);
      }
    },
  },
  add_deposit: {
    note: "Appends to the planet's deposit list; duplicates allowed, as in game.",
    apply: (entry, scope, ex) => {
      planetState(ex.state, scope).deposits.push(stringArg(entry));
    },
  },
  give_technology: {
    note: "Adds the tech id to the researched set. `message` is presentation-only and deliberately ignored.",
    apply: (entry, scope, ex) => {
      const country = countryState(ex.state, scope);
      for (const field of blockEntries(entry)) {
        if (field.key === "tech") {
          country.technologies.add(stringArg(field));
        } else if (field.key !== "message") {
          throw new InterpreterError(
            `give_technology field "${field.key}" is not modeled. ${coverageSummary()}`
          );
        }
      }
    },
  },
  save_event_target_as: {
    note: "Targets are a name -> entity map scoped to one event execution; a later save in that execution overwrites. Delayed delivery starts a new execution with no saved targets (Stellaris 4.4.6 calibration).",
    apply: (entry, scope, ex) => {
      ex.targets.set(stringArg(entry), scope);
    },
  },
  log: {
    note: "Appends to a log the test can read; the game writes game.log.",
    apply: (entry, _scope, ex) => {
      ex.state.log.push(stringArg(entry));
    },
  },
};

// ---------------------------------------------------------------------------
// Structural effects — implemented in the walker, audited here
// ---------------------------------------------------------------------------

export const STRUCTURAL_SEMANTICS: Readonly<Record<string, { readonly note: string }>> = {
  random_list: {
    note: "Takes the FORCED arm (by weight key) — forced branches, not seeds. Weight modifiers are deliberately not evaluated under forcing.",
  },
  if: { note: "Evaluates `limit` via the trigger walker, then applies the body." },
  else_if: { note: "Associated with the preceding if by position, as the game does." },
  else: { note: "Runs iff no preceding if/else_if in the chain applied." },
};

// Fire effects (`planet_event = { id = ... }`) are recognized via the
// generated EVENT_KINDS table and enqueue on the discrete-event queue; the
// walker owns that logic. Delay math: days + months*30 + years*360.

// ---------------------------------------------------------------------------
// Iterators — fixture relations (handoff open question 4)
// ---------------------------------------------------------------------------

export interface IteratorImpl {
  readonly note: string;
  /** The relation this iterator walks. The walker applies `limit` itself. */
  readonly targets: (scope: EntityId, ex: ExecCtx) => EntityId[];
}

export const ITERATOR_SEMANTICS: Readonly<Record<string, IteratorImpl>> = {
  every_owned_planet: {
    note: "Walks the country -> planets nesting relation, in fixture order (the game iterates all owned planets; order is not observable to the whitelisted effects).",
    targets: (scope, ex) => {
      countryState(ex.state, scope);
      if (scope.kind !== "country") {
        throw new InterpreterError("unreachable: countryState guards the kind");
      }
      return (ex.state.planets[scope.country] ?? []).map((_planet, p) => ({
        kind: "planet",
        country: scope.country,
        planet: p,
      }));
    },
  },
};

// ---------------------------------------------------------------------------
// Scope links — navigation (handoff open question 4)
// ---------------------------------------------------------------------------

export interface LinkImpl {
  readonly note: string;
  readonly resolve: (scope: EntityId, ex: ExecCtx) => EntityId;
}

export const LINK_SEMANTICS: Readonly<Record<string, LinkImpl>> = {
  from: {
    note: "Resolves to the FROM bound by the harness fire or the queued fire's contract; unbound FROM is a loud error, not an empty scope.",
    resolve: (_scope, ex) => {
      if (ex.from === undefined) {
        throw new InterpreterError(
          `FROM is not bound in this execution — fire the event with a FROM ` +
            `(world.fire(event, scope, { from })) or via a fire effect. ${coverageSummary()}`
        );
      }
      return ex.from;
    },
  },
};

/** `event_target:name` blocks resolve through the world's target map. */
export const EVENT_TARGET_PREFIX = "event_target:";

export function resolveEventTarget(name: string, ex: ExecCtx): EntityId {
  const target = ex.targets.get(name);
  if (target === undefined) {
    throw new InterpreterError(
      `event target "${name}" was never saved in this world. ${coverageSummary()}`
    );
  }
  return target;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export function coverageSummary(): string {
  const triggers = Object.keys(TRIGGER_SEMANTICS).length;
  const combinators = Object.keys(COMBINATOR_SEMANTICS).length;
  const effects = Object.keys(EFFECT_SEMANTICS).length;
  const structural = Object.keys(STRUCTURAL_SEMANTICS).length;
  const iterators = Object.keys(ITERATOR_SEMANTICS).length;
  const links = Object.keys(LINK_SEMANTICS).length + 1; // + the event_target: prefix rule
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return (
    `(coverage: ${count(triggers, "trigger")} + ${count(combinators, "combinator")}, ` +
    `${count(effects, "effect")} + ${structural} structural, ` +
    `${count(iterators, "iterator")}, ${count(links, "link")})`
  );
}
