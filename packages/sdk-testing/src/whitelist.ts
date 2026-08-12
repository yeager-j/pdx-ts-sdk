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

import { scalarText, type PdxEntry, type PdxItem, type PdxScalar } from "@pdx-ts/pdxscript";
import type { StructuralEffectKey } from "@pdx-ts/sdk";

import {
  archaeologicalSiteState,
  countryState,
  describeEntity,
  planetState,
  situationState,
  type ChoicePlanState,
  type EntityId,
  type WorldState,
} from "./state.ts";

/** The execution context an interpretation runs under. */
export interface ExecCtx {
  readonly state: WorldState;
  /** The scope the event/effect run started in — the live-oracle-verified natural FROM for fires. */
  readonly root: EntityId;
  /** FROM as bound by the harness or the fire that queued this run. */
  readonly from: EntityId | undefined;
  /** Forced random_list arm indices, consumed in encounter order across an event chain. */
  readonly choicePlan: ChoicePlanState;
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

function stringArg(entry: PdxEntry): string {
  const value = scalarOf(entry);
  if (value.kind !== "str") {
    throw new InterpreterError(
      `${entry.key}: expected a name, got ${scalarText(value)}. ${coverageSummary()}`
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
    const rendered = scalarText(value);
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
      `${entry.key}: expected yes/no, got ${scalarText(value)}. ${coverageSummary()}`
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

/**
 * The variable store a scope's `set_variable`/`change_variable`/
 * `multiply_variable`/`check_variable`/`is_variable_set` read and write.
 * Modeled for situation scope only — the one scope this harness's evidence
 * needed it for; every other scope throws loudly rather than silently
 * pretending to have variable storage it does not.
 */
function variablesOf(state: WorldState, scope: EntityId): Map<string, number> {
  if (scope.kind !== "situation") {
    throw new InterpreterError(
      `Variables are modeled for situation scope only; ${describeEntity(state, scope)} has no ` +
        `variable storage in the fixture. ${coverageSummary()}`
    );
  }
  return situationState(state, scope).variables;
}

/**
 * Reads a variable that the game requires to already exist, throwing rather
 * than guessing 0 or false when it does not. `effects.cwt`'s own comment
 * above `change_variable`/`add_variable`/etc. — "presumably need to check
 * the variable exists first for these, somehow" — and `set_variable`'s
 * "Sets or creates" wording (the one variable effect that does NOT require
 * prior existence) both say the same thing: an unset read is not a
 * documented zero/false default, it is undefined behavior the vendored
 * rules flag as needing a guard. `is_variable_set` is that guard; a fixture
 * that silently answered 0/false here would let a test pass on a branch the
 * real game never reaches.
 */
function requireVariable(state: WorldState, scope: EntityId, which: string, key: string): number {
  const current = variablesOf(state, scope).get(which);
  if (current === undefined) {
    throw new InterpreterError(
      `${key} "${which}": not previously set. The vendored rules document this as requiring an ` +
        `existing variable (effects.cwt's "presumably need to check the variable exists first for ` +
        `these" comment on the variable-arithmetic effects) — guard with is_variable_set first, or ` +
        `set_variable to establish a starting value. ${coverageSummary()}`
    );
  }
  return current;
}

/** `which`/`value` field pair shared by `set_variable`/`change_variable`/`multiply_variable`. */
function whichValueArgs(entry: PdxEntry): { readonly which: string; readonly value: number } {
  const fields = blockEntries(entry);
  const whichField = fields.find((field) => field.key === "which");
  const valueField = fields.find((field) => field.key === "value");
  if (whichField === undefined || valueField === undefined) {
    throw new InterpreterError(
      `${entry.key}: expected "which" and "value" fields. ${coverageSummary()}`
    );
  }
  return { which: stringArg(whichField), value: numberArg(valueField) };
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
  is_variable_set: {
    note: "Checks the scope's variable store (situation scope only — see variablesOf) for the name.",
    eval: (entry, scope, ex) => {
      const name = stringArg(entry);
      const result = variablesOf(ex.state, scope).has(name);
      return { result, detail: result ? `"${name}" is set` : `"${name}" is not set` };
    },
  },
  check_variable: {
    note: "Compares a stored variable's value; reading an unset one throws rather than guessing a result, since `is_variable_set` is the game's own documented guard against exactly that (`is_variable_set`'s generated doc comment: \"Use to avoid unset variables errors\") — a fixture that quietly answered false would let a test take a branch the real game never reaches.",
    eval: (entry, scope, ex) => {
      const fields = blockEntries(entry);
      const whichField = fields.find((field) => field.key === "which");
      const valueField = fields.find((field) => field.key === "value");
      if (whichField === undefined || valueField === undefined) {
        throw new InterpreterError(
          `check_variable: expected "which" and "value" fields. ${coverageSummary()}`
        );
      }
      const which = stringArg(whichField);
      const current = requireVariable(ex.state, scope, which, "check_variable");
      const result = compare(current, valueField.op, numberArg(valueField));
      return { result, detail: `${which} = ${current}` };
    },
  },
  situation_progress: {
    note: "Compares the situation's stored progress value.",
    eval: (entry, scope, ex) => {
      const progress = situationState(ex.state, scope).progress;
      const expected = numberArg(entry);
      return { result: compare(progress, entry.op, expected), detail: `progress ${progress}` };
    },
  },
  current_situation_approach: {
    note: "Compares the id of the approach currently picked on the situation.",
    eval: (entry, scope, ex) => {
      const approach = situationState(ex.state, scope).approach;
      const expected = stringArg(entry);
      const result = approach === expected;
      return {
        result,
        detail: approach === undefined ? "no approach picked" : `approach is "${approach}"`,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Combinators — implemented in the walker, audited here
// ---------------------------------------------------------------------------

export interface CombinatorImpl {
  readonly note: string;
  /** all = every child true; any = some child true; none = every child false; notAll = some child false. */
  readonly mode: "all" | "any" | "none" | "notAll";
}

export const COMBINATOR_SEMANTICS: Readonly<Record<string, CombinatorImpl>> = {
  AND: { note: "Every entry must hold — same as PDXScript's implicit sibling AND.", mode: "all" },
  OR: { note: "At least one entry must hold.", mode: "any" },
  NOT: {
    note: "Paradox's NOT is actually NOR over its entries: true iff every entry is false.",
    mode: "none",
  },
  NOR: { note: "No entry may hold.", mode: "none" },
  NAND: { note: "At least one entry must not hold.", mode: "notAll" },
  hidden_trigger: {
    note: "Transparent: every entry must hold, exactly as AND. Hiding is a tooltip concern with no bearing on whether the condition holds, and the block changes no scope.",
    mode: "all",
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
  set_site_progress_locked: {
    note: "Locks/unlocks the archaeological site's progress bar — plain boolean state on the site.",
    apply: (entry, scope, ex) => {
      archaeologicalSiteState(ex.state, scope).progressLocked = boolArg(entry);
    },
  },
  set_variable: {
    note: "Overwrites a stored variable (situation scope only — see variablesOf).",
    apply: (entry, scope, ex) => {
      const { which, value } = whichValueArgs(entry);
      variablesOf(ex.state, scope).set(which, value);
    },
  },
  change_variable: {
    note: "Increments a previously-set variable by an amount; throws on an unset one rather than guessing 0 — see requireVariable's doc comment for the effects.cwt citation.",
    apply: (entry, scope, ex) => {
      const { which, value } = whichValueArgs(entry);
      const vars = variablesOf(ex.state, scope);
      const current = requireVariable(ex.state, scope, which, "change_variable");
      vars.set(which, current + value);
    },
  },
  multiply_variable: {
    note: "Multiplies a previously-set variable by an amount; throws on an unset one rather than guessing 0 — see requireVariable's doc comment for the effects.cwt citation.",
    apply: (entry, scope, ex) => {
      const { which, value } = whichValueArgs(entry);
      const vars = variablesOf(ex.state, scope);
      const current = requireVariable(ex.state, scope, which, "multiply_variable");
      vars.set(which, current * value);
    },
  },
};

// ---------------------------------------------------------------------------
// Structural effects — one audited dispatcher contract for the walker
// ---------------------------------------------------------------------------

export type StructuralDisposition =
  | "conditional-start"
  | "conditional-continuation"
  | "conditional-fallback"
  | "transparent"
  | "forced-list"
  | "leaf"
  | "unimplemented";

export interface StructuralImpl {
  /** The walker's closed dispatch/disposition for this structural key. */
  readonly disposition: StructuralDisposition;
  /** One line defending the modeled behavior or deliberate refusal. */
  readonly note: string;
}

function defineStructuralSemantics<const T extends Record<StructuralEffectKey, StructuralImpl>>(
  semantics: T & Record<Exclude<keyof T, StructuralEffectKey>, never>
): Readonly<T> {
  return semantics;
}

/**
 * Every structural effect key the SDK records has one interpreter disposition
 * here. The walker dispatches this table directly; coverage derives from it.
 * `leaf` preserves the existing EFFECT_SEMANTICS authority for structures
 * whose mechanics are ordinary leaf mutations, while `unimplemented` makes a
 * real but unverified structural effect a deliberate refusal rather than a
 * generic generated-key fallback.
 */
export const STRUCTURAL_SEMANTICS = defineStructuralSemantics({
  add_resource: {
    disposition: "leaf",
    note: "Delegates to EFFECT_SEMANTICS: the audited fixture stockpile mutation already owns this resource block.",
  },
  add_event_chain_counter: {
    disposition: "unimplemented",
    note: "Event-chain counter lifetime and progression are absent from the fixture, so incrementing one would invent state semantics.",
  },
  else: {
    disposition: "conditional-fallback",
    note: "Runs iff no preceding if/else_if in the positional chain applied.",
  },
  else_if: {
    disposition: "conditional-continuation",
    note: "Associates with the preceding if by position, as the game does.",
  },
  hidden_effect: {
    disposition: "transparent",
    note: "Transparent: the entries run as they would unwrapped. Hiding is a tooltip concern and the block changes no scope.",
  },
  if: {
    disposition: "conditional-start",
    note: "Evaluates limit via the trigger walker, then applies the body.",
  },
  inverted_switch: {
    disposition: "unimplemented",
    note: "No branch-selection semantics have been verified for this control-flow form.",
  },
  locked_random_list: {
    disposition: "unimplemented",
    note: "Its locked tooltip and selection semantics have not been calibrated; forcing random_list does not establish them.",
  },
  random: {
    disposition: "unimplemented",
    note: "Chance and modifier evaluation need a probability model; the fixture only forces random_list arms.",
  },
  random_list: {
    disposition: "forced-list",
    note: "Takes the FORCED arm by zero-based occurrence index — weights are not identities. Forced branches, not seeds; weight modifiers are deliberately not evaluated under forcing.",
  },
  reset_event_chain_counter: {
    disposition: "unimplemented",
    note: "Event-chain counter lifetime and progression are absent from the fixture, so resetting one would invent state semantics.",
  },
  save_event_target_as: {
    disposition: "leaf",
    note: "Delegates to EFFECT_SEMANTICS: the audited per-execution event-target map already owns this save.",
  },
  save_global_event_target_as: {
    disposition: "unimplemented",
    note: "Global target lifetime is not modeled: the fixture intentionally keeps targets local to one execution.",
  },
  switch: {
    disposition: "unimplemented",
    note: "No branch-selection semantics have been verified for this control-flow form.",
  },
  while: {
    disposition: "unimplemented",
    note: "Count and limit iteration can change execution order and termination, neither of which the fixture has calibrated.",
  },
});

export function structuralSemanticsFor(key: string): StructuralImpl | undefined {
  return STRUCTURAL_SEMANTICS[key as StructuralEffectKey];
}

// Fire effects (`planet_event = { id = ... }`) are recognized via the
// SDK's generated event-fire policy and enqueue on the discrete-event queue; the
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

/**
 * Named scope-changing navigation, shared by the effect walker's block
 * entries (`from = { ... }`, `target = { ... }`) and the trigger walker's
 * scope-link blocks — the same table either side reads, since resolving
 * "what scope does this name land in" does not care whether the entries
 * being evaluated afterward are effects or conditions.
 */
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
  target: {
    note: "A situation's declared target (see SituationSpec.targetCountry) — the same link `target<S>()` and `situation.target<S>(body)` name in the authoring API. `links.cwt` gives it `output_scope = any`; the fixture resolves it through the situation's own declared target rather than reading anything from the trigger or effect body.",
    resolve: (scope, ex) => situationState(ex.state, scope).targetId,
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
  const structural = Object.values(STRUCTURAL_SEMANTICS);
  const structuralWalker = structural.filter(
    ({ disposition }) => disposition !== "leaf" && disposition !== "unimplemented"
  ).length;
  const structuralLeaf = structural.filter(({ disposition }) => disposition === "leaf").length;
  const structuralRefused = structural.filter(
    ({ disposition }) => disposition === "unimplemented"
  ).length;
  const iterators = Object.keys(ITERATOR_SEMANTICS).length;
  const links = Object.keys(LINK_SEMANTICS).length + 1; // + the event_target: prefix rule
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return (
    `(coverage: ${count(triggers, "trigger")} + ${count(combinators, "combinator")}, ` +
    `${count(effects, "effect")} + ${count(structuralWalker, "walker-modeled structural")} + ` +
    `${count(structuralLeaf, "leaf-delegated structural")} + ` +
    `${count(structuralRefused, "explicitly refused structural")}, ` +
    `${count(iterators, "iterator")}, ${count(links, "link")})`
  );
}
