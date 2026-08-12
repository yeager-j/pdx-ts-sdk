/**
 * The interpreter's whitelist — one audited table;
 * adding an entry should feel expensive. Every entry carries a `note`
 * defending its semantics against the real game and a `docs` pin naming the
 * paragraph it was audited against, because a wrong emulator is worse than no
 * emulator: every divergence is a green test for broken behavior. Anything not
 * listed here throws at evaluation time with the coverage summary — nothing
 * evaluates silently.
 *
 * Split, mirroring the handoff: leaf triggers, combinators, leaf effects,
 * structural effects (implemented in the walker, listed here for the audit),
 * iterators (fixture relations), and scope links (navigation).
 */

import {
  scalarText,
  tryNumberValue,
  type PdxEntry,
  type PdxItem,
  type PdxScalar,
} from "@pdx-ts/pdxscript";
import {
  EVENT_FIELD_SUPPORT,
  EVENT_OPTION_FIELD_SUPPORT,
  type StructuralEffectKey,
} from "@pdx-ts/sdk";

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
 * The vendored documentation dump every `docs` pin below was taken from.
 *
 * `packages/sdk-testing/tests/whitelist-audit.test.ts` fails when
 * `vendor/cwtools-stellaris-config/script-docs/` holds a different version, so
 * revendoring a newer dump is what forces the whole table to be re-read rather
 * than assumed. The calibration was a one-shot manual record before that gate
 * existed; this is what makes it repeat.
 */
export const AUDITED_DOC_DUMP = "v4.4.1";

/**
 * The build one specific claim was recorded on in a running game: that delayed
 * delivery starts a new execution with no saved event targets. Nothing else
 * rides here. A second live claim gets its own record and its own written
 * evidence — sharing this constant would let one probe's rerun silently
 * re-bless another claim nobody rechecked.
 *
 * It is not the dump's version and must never be quietly written as if it were:
 * cwtools vendors Paradox's dumps per game version and has published none past
 * {@link AUDITED_DOC_DUMP}, while the probe under
 * `examples/from-oracle/calibration` ran on Pegasus 4.4.6.
 *
 * A hash cannot re-verify an observation of a running game, so the audit gate
 * pins it from both sides instead: this literal must equal the repository's
 * verified build (`SUPPORTED_STELLARIS_BUILD`) *and* the build the calibration
 * record itself reports. Bumping it without re-running the probe leaves that
 * record disagreeing, and the gate says so.
 */
export const LIVE_CALIBRATION_BUILD = "4.4.6";

/**
 * The install file the storage-capacity bound is read from — the game's own
 * resource definitions, whose header calls `max` the resource's maximum storage
 * capacity. Install-derived rather than dump-derived, so the gate that re-reads
 * it is install-gated the way `codegen-vanilla`'s call-site falsification is:
 * CI has no Stellaris, and a measurement of the game cannot be faked into
 * existence.
 */
export const STORAGE_CAPACITY_SOURCE = "common/strategic_resources/00_strategic_resources.txt";

/** The wording in that file that makes `max` a capacity rather than a starting figure. */
export const STORAGE_CAPACITY_CLAIM = "maximum storage capacity of the resource";

/**
 * The paragraph in Paradox's own documentation dump that an entry's `note` was
 * audited against, pinned by hash.
 *
 * The dump is the closest thing to a specification this interpreter has, and
 * the notes are only as good as the reading they came from. Pinning the
 * paragraph makes a revendor say which readings changed instead of leaving
 * every note silently older than the game — the same shape as
 * `packages/codegen-vanilla/tests/callsites.test.ts`, which falsifies inference
 * against the game before a regeneration is accepted.
 */
export interface DocPin {
  /**
   * The dump's own name for this key, when it differs from the whitelist key:
   * the combinators are the case, dumped lowercase (`AND` is `and` there).
   */
  readonly name?: string;
  /** First 16 hex characters of the sha-256 the audit gate computes over the paragraph. */
  readonly sha: string;
  /**
   * Required exactly when the pinned paragraph carries Paradox's deprecation
   * marker: why the deprecated key is still modeled, and what modeling the
   * replacement would actually cost. An unacknowledged deprecation fails the
   * gate, and so does an acknowledgement of a paragraph that no longer carries
   * one.
   */
  readonly deprecated?: string;
}

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
  // A numeral no double holds exactly (`9007199254740993`) is out for the
  // same reason a script value is: this line evaluates, and evaluating it
  // would mean answering with a different number than the file says.
  const number = value.kind === "num" ? tryNumberValue(value.lexeme) : null;
  if (number === null) {
    const rendered = scalarText(value);
    throw new InterpreterError(
      `${entry.key} ${entry.op} ${rendered}: expected a number — the numeric v1 line evaluates ` +
        `literals and fixture-stored numbers only; script values and variables are out. ` +
        coverageSummary()
    );
  }
  return number;
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
  /** The `triggers.log` paragraph the note was read from. */
  readonly docs: DocPin;
  readonly eval: (
    entry: PdxEntry,
    scope: EntityId,
    ex: ExecCtx
  ) => { result: boolean; detail: string };
}

/**
 * The count the dump reads as owned colonies: planet and ship colonies both.
 * The fixture's ownership relation is that count by construction — every
 * nested planet is an owned colony, and no ship colonies are modeled — which
 * is why one implementation answers both spellings of the trigger.
 */
const ownedColonyCount: TriggerImpl["eval"] = (entry, scope, ex) => {
  countryState(ex.state, scope);
  const expected = numberArg(entry);
  const actual = scope.kind === "country" ? (ex.state.planets[scope.country]?.length ?? 0) : 0;
  return {
    result: compare(actual, entry.op, expected),
    detail: `${actual} owned colon${actual === 1 ? "y" : "ies"}`,
  };
};

export const TRIGGER_SEMANTICS: Readonly<Record<string, TriggerImpl>> = {
  has_country_flag: {
    docs: { sha: "3b22b2f86ab05534" },
    note: "Country flags are a plain string set; set/unset with no expiry modeled.",
    eval: (entry, scope, ex) => {
      const flag = stringArg(entry);
      const result = countryState(ex.state, scope).flags.has(flag);
      const where = describeEntity(ex.state, scope);
      return { result, detail: result ? `set on ${where}` : `not set on ${where}` };
    },
  },
  has_global_flag: {
    docs: { sha: "e62325d4f7e8df63" },
    note: "Global flags are one world-wide string set.",
    eval: (entry, _scope, ex) => {
      const flag = stringArg(entry);
      const result = ex.state.globalFlags.has(flag);
      return { result, detail: result ? "set globally" : "not set globally" };
    },
  },
  has_owner: {
    docs: { sha: "2029da3606d7b9e2" },
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
    docs: { sha: "08ee84cdf10fa64f" },
    note: "Researched techs are a string set of tech ids; give_technology adds to it.",
    eval: (entry, scope, ex) => {
      const tech = stringArg(entry);
      const result = countryState(ex.state, scope).technologies.has(tech);
      return { result, detail: result ? "researched" : "not researched" };
    },
  },
  num_owned_planets: {
    docs: {
      sha: "128c271a54cce0c8",
      deprecated:
        "Superseded by num_owned_colonies, which is modeled below and shares this implementation " +
        "— the dump gives the two the same summary word for word. Kept rather than dropped " +
        "because the game still evaluates it and the SDK still emits it (`numOwnedPlanets`), so " +
        "removing it here would throw on an authored chain the game runs fine.",
    },
    note: "Compares against the fixture ownership relation's size. The dump counts owned colonies, planet and ship colonies both; every fixture planet is an owned colony and no ship colonies are modeled, so that relation's size is exactly that count.",
    eval: ownedColonyCount,
  },
  num_owned_colonies: {
    docs: { sha: "79effd6e97321080" },
    note: "The undeprecated spelling of num_owned_planets, identical in the dump down to the summary line; one implementation answers both so the two can never drift apart here.",
    eval: ownedColonyCount,
  },
  is_variable_set: {
    docs: { sha: "b079be94a51e3fa4" },
    note: "Checks the scope's variable store (situation scope only — see variablesOf) for the name.",
    eval: (entry, scope, ex) => {
      const name = stringArg(entry);
      const result = variablesOf(ex.state, scope).has(name);
      return { result, detail: result ? `"${name}" is set` : `"${name}" is not set` };
    },
  },
  check_variable: {
    docs: { sha: "e7218970c3ee5af6" },
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
    docs: { sha: "db4de1af021a8428" },
    note: "Compares the situation's stored progress value.",
    eval: (entry, scope, ex) => {
      const progress = situationState(ex.state, scope).progress;
      const expected = numberArg(entry);
      return { result: compare(progress, entry.op, expected), detail: `progress ${progress}` };
    },
  },
  current_situation_approach: {
    docs: { sha: "126697652452b3e4" },
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
  /** The `triggers.log` paragraph the note was read from — lowercase there, hence the `name`. */
  readonly docs: DocPin;
  /** all = every child true; any = some child true; none = every child false; notAll = some child false. */
  readonly mode: "all" | "any" | "none" | "notAll";
}

export const COMBINATOR_SEMANTICS: Readonly<Record<string, CombinatorImpl>> = {
  AND: {
    docs: { name: "and", sha: "5c4672fba6f727fb" },
    note: "Every entry must hold — same as PDXScript's implicit sibling AND.",
    mode: "all",
  },
  OR: {
    docs: { name: "or", sha: "d842871d9cb68574" },
    note: "At least one entry must hold.",
    mode: "any",
  },
  NOT: {
    docs: { name: "not", sha: "3bc33b7fa1e95113" },
    note: "Paradox's NOT is actually NOR over its entries: true iff every entry is false.",
    mode: "none",
  },
  NOR: {
    docs: { name: "nor", sha: "3110fb3e77a2855f" },
    note: "No entry may hold.",
    mode: "none",
  },
  NAND: {
    docs: { name: "nand", sha: "2e50b38740210943" },
    note: "At least one entry must not hold.",
    mode: "notAll",
  },
  hidden_trigger: {
    docs: { sha: "5c9012ba9e9df0af" },
    note: "Transparent: every entry must hold, exactly as AND. Hiding is a tooltip concern with no bearing on whether the condition holds, and the block changes no scope.",
    mode: "all",
  },
};

// ---------------------------------------------------------------------------
// Leaf effects
// ---------------------------------------------------------------------------

export interface EffectImpl {
  readonly note: string;
  /** The `effects.log` paragraph the note was read from. */
  readonly docs: DocPin;
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
    docs: { sha: "3a748aaf3be2a4bb" },
    note: "Adds to the country's flag set; re-setting an existing flag is a no-op, as in game.",
    apply: (entry, scope, ex) => {
      countryState(ex.state, scope).flags.add(stringArg(entry));
    },
  },
  add_resource: {
    docs: { sha: "cbfdf3b3b513e86a" },
    note: "Adds to the stockpile, bounded above by the country's declared storage capacity for that resource. The bound is the claim and the whole claim: the game's own resource definitions call `max` the resource's maximum storage capacity (`common/strategic_resources/00_strategic_resources.txt`, which the audit gate re-reads against a real install), so a stockpile walking past it is a state no unmodified game holds and an unbounded add is a green test for a reward that was never paid out. What becomes of the excess — discarded, converted, refunded — is deliberately not modeled and not asserted anywhere. A missing stockpile starts at 0. A resource with no declared capacity is unbounded and says so: capacity is a base plus techs, buildings, modifiers and whatever the mod itself changes, and inventing a number would be the wrong emulator this harness exists to refuse — a test that cares declares one (CountrySpec.storage). `mult` is not modeled — loud error.",
    apply: (entry, scope, ex) => {
      const country = countryState(ex.state, scope);
      for (const field of blockEntries(entry)) {
        if (field.key === "mult") {
          throw new InterpreterError(
            `add_resource with mult is not modeled by the testing interpreter. ${coverageSummary()}`
          );
        }
        const total = (country.resources.get(field.key) ?? 0) + numberArg(field);
        const capacity = country.storage.get(field.key);
        country.resources.set(
          field.key,
          capacity === undefined ? total : Math.min(total, capacity)
        );
      }
    },
  },
  add_deposit: {
    docs: { sha: "9117e309e424376c" },
    note: "Appends to the planet's deposit list; duplicates allowed, as in game.",
    apply: (entry, scope, ex) => {
      planetState(ex.state, scope).deposits.push(stringArg(entry));
    },
  },
  give_technology: {
    docs: { sha: "036394cca1d797ab" },
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
    docs: { sha: "ce26257ec62671fe" },
    note: "Targets are a name -> entity map scoped to one event execution; a later save in that execution overwrites. Delayed delivery starts a new execution with no saved targets — an in-game record on Pegasus 4.4.6 (LIVE_CALIBRATION_BUILD, examples/from-oracle/calibration), not something the dump states, so it is pinned to the build rather than to the paragraph.",
    apply: (entry, scope, ex) => {
      ex.targets.set(stringArg(entry), scope);
    },
  },
  log: {
    docs: { sha: "b0bba22387d3d394" },
    note: "Appends to a log the test can read; the game writes game.log.",
    apply: (entry, _scope, ex) => {
      ex.state.log.push(stringArg(entry));
    },
  },
  set_site_progress_locked: {
    docs: { sha: "88e5769fbca6ab4f" },
    note: "Locks/unlocks the archaeological site's progress bar — plain boolean state on the site.",
    apply: (entry, scope, ex) => {
      archaeologicalSiteState(ex.state, scope).progressLocked = boolArg(entry);
    },
  },
  set_variable: {
    docs: { sha: "776ba03a4ba84f00" },
    note: "Overwrites a stored variable (situation scope only — see variablesOf).",
    apply: (entry, scope, ex) => {
      const { which, value } = whichValueArgs(entry);
      variablesOf(ex.state, scope).set(which, value);
    },
  },
  change_variable: {
    docs: { sha: "0ac78f8fc94699d4" },
    note: "Increments a previously-set variable by an amount; throws on an unset one rather than guessing 0 — see requireVariable's doc comment for the effects.cwt citation.",
    apply: (entry, scope, ex) => {
      const { which, value } = whichValueArgs(entry);
      const vars = variablesOf(ex.state, scope);
      const current = requireVariable(ex.state, scope, which, "change_variable");
      vars.set(which, current + value);
    },
  },
  multiply_variable: {
    docs: { sha: "8984e0807e5d3ab6" },
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
  /**
   * The `effects.log` paragraph the note was read from. A `leaf` entry reuses
   * the pin its EFFECT_SEMANTICS entry already carries rather than restating
   * the hash: one key, one paragraph, one place to re-read it.
   */
  readonly docs: DocPin;
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
    docs: EFFECT_SEMANTICS.add_resource!.docs,
    note: "Delegates to EFFECT_SEMANTICS: the audited fixture stockpile mutation already owns this resource block.",
  },
  add_event_chain_counter: {
    disposition: "unimplemented",
    docs: { sha: "21a62e7a143abd73" },
    note: "Event-chain counter lifetime and progression are absent from the fixture, so incrementing one would invent state semantics.",
  },
  else: {
    disposition: "conditional-fallback",
    docs: { sha: "bbe0ad2447163b24" },
    note: "Runs iff no preceding if/else_if in the positional chain applied.",
  },
  else_if: {
    disposition: "conditional-continuation",
    docs: { sha: "2e393aef256c351f" },
    note: "Associates with the preceding if by position, as the game does.",
  },
  hidden_effect: {
    disposition: "transparent",
    docs: { sha: "0025c011ebab872b" },
    note: "Transparent: the entries run as they would unwrapped. Hiding is a tooltip concern and the block changes no scope.",
  },
  if: {
    disposition: "conditional-start",
    docs: { sha: "0e8e6e3cfa6e1158" },
    note: "Evaluates limit via the trigger walker, then applies the body.",
  },
  inverted_switch: {
    disposition: "unimplemented",
    docs: { sha: "382dd8d9c895102a" },
    note: "No branch-selection semantics have been verified for this control-flow form.",
  },
  locked_random_list: {
    disposition: "unimplemented",
    docs: { sha: "7de8f1b01eac854e" },
    note: "Its locked tooltip and selection semantics have not been calibrated; forcing random_list does not establish them.",
  },
  random: {
    disposition: "unimplemented",
    docs: { sha: "7c289fad55fa014f" },
    note: "Chance and modifier evaluation need a probability model; the fixture only forces random_list arms.",
  },
  random_list: {
    disposition: "forced-list",
    docs: { sha: "7096b9ef05c77594" },
    note: "Takes the FORCED arm by zero-based occurrence index — weights are not identities. Forced branches, not seeds; weight modifiers are deliberately not evaluated under forcing.",
  },
  reset_event_chain_counter: {
    disposition: "unimplemented",
    docs: { sha: "30208b30ec6e951a" },
    note: "Event-chain counter lifetime and progression are absent from the fixture, so resetting one would invent state semantics.",
  },
  save_event_target_as: {
    disposition: "leaf",
    docs: EFFECT_SEMANTICS.save_event_target_as!.docs,
    note: "Delegates to EFFECT_SEMANTICS: the audited per-execution event-target map already owns this save.",
  },
  save_global_event_target_as: {
    disposition: "unimplemented",
    docs: { sha: "45517b254cf222a1" },
    note: "Global target lifetime is not modeled: the fixture intentionally keeps targets local to one execution.",
  },
  switch: {
    disposition: "unimplemented",
    docs: { sha: "df99c5125afb43cc" },
    note: "No branch-selection semantics have been verified for this control-flow form.",
  },
  while: {
    disposition: "unimplemented",
    docs: { sha: "394815909b80736a" },
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
  /** The `effects.log` paragraph the note was read from. */
  readonly docs: DocPin;
  /** The relation this iterator walks. The walker applies `limit` itself. */
  readonly targets: (scope: EntityId, ex: ExecCtx) => EntityId[];
}

export const ITERATOR_SEMANTICS: Readonly<Record<string, IteratorImpl>> = {
  every_owned_planet: {
    docs: {
      sha: "720c3b13e5e5f166",
      deprecated:
        "Superseded by every_owned_colony, which is not a rename here: that iterator enters " +
        "colony scope, and the fixture models planet scope only (SimScopeName). Adopting it means " +
        "widening the sim scope set with real colony state and real transitions, not aliasing " +
        "this entry — until then the game still runs this spelling and the SDK still emits it.",
    },
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
  /** The `scopes.log` paragraph the note was read from — links are dumped there, not with the triggers. */
  readonly docs: DocPin;
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
    docs: { sha: "8031e74b9daf40cd" },
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
  owner: {
    docs: { sha: "ce9ca820b0c3e72a" },
    note: "The fixture's ownership relation, read in the one direction it is stored: a planet's owner is the country it is nested under, which is what makes it owned in the first place. The dump lists two dozen input scopes and this models one — the others are refused by name rather than approximated, because the fixture holds no ownership edge for them: a fleet is deliberately unowned here (FleetSpec), a site is reached as a fleet event's FROM, and a situation carries a declared target, which is a different relation the game also gives it separately.",
    resolve: (scope, ex) => {
      if (scope.kind !== "planet") {
        throw new InterpreterError(
          `owner is a scope link the fixture resolves from planet scope only — it reads the ` +
            `country a planet is nested under. ${describeEntity(ex.state, scope)} carries no ` +
            `modeled ownership edge, so resolving one would be a guess. ${coverageSummary()}`
        );
      }
      return { kind: "country", country: scope.country };
    },
  },
  target: {
    docs: { sha: "03892ba5c618de8b" },
    note: "A situation's declared target (see SituationSpec.targetCountry) — the same link `target<S>()` and `situation.target<S>(body)` name in the authoring API. `links.cwt` gives it `output_scope = any`; the fixture resolves it through the situation's own declared target rather than reading anything from the trigger or effect body. The pinned paragraph is worth reading before trusting it: the dump's prose describes only the spy-network and espionage-operation readings, and `situation` appears among this link's legal inputs in `links.cwt` rather than in the sentence.",
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
// Event delivery — what a registered event may carry
// ---------------------------------------------------------------------------

/**
 * What delivery does with one top-level field of an event body.
 *
 * The tables above keep the promise one key at a time: an unknown trigger or
 * effect throws where it is evaluated. Delivery is a level up from there, and
 * the promise was not kept at that level — `World.deliver` runs the `immediate`
 * block and nothing else, so an event whose payoff lived in an option "fired"
 * successfully with its payoff never run, and a `trigger` block the game would
 * have checked was dropped without a word. A fired record for an event the game
 * would not have fired, or would not have finished, is a green test for broken
 * behavior in exactly the way this package exists to prevent.
 *
 * So registration reads the whole event body against this table and refuses the
 * events it cannot deliver honestly, rather than delivering part of one.
 */
export type EventFieldDisposition =
  /** Delivery runs it. `immediate`, and only `immediate`. */
  | "delivered"
  /** Nothing to run: identity, presentation, or a mechanic no delivery path reaches. */
  | "inert"
  /** Real script delivery will never run — registration refuses the event. */
  | "refused"
  /**
   * The option list, which is neither: an option is inert while it carries only
   * presentation (a name, an icon, a gate on a choice nothing here makes), and
   * refused the moment it carries effects, because those effects are the payoff
   * and no option is ever selected here. One key, two answers, decided by the
   * option's own contents — see {@link optionCarriesEffects}.
   */
  | "options"
  /**
   * A flag delivery enforces by refusing a repeat: the first delivery runs, a
   * second is a firing the game would not have made. Refusing the repeat is the
   * only honest way to model it — the rules say nothing about what the flag
   * counts by, so this harness declines to guess a granularity and declines to
   * ignore the flag, which is what left an event's effects applied twice.
   */
  | "once";

export interface EventFieldImpl {
  readonly disposition: EventFieldDisposition;
  /** One line defending the disposition — what the game does with it, and what delivery does. */
  readonly note: string;
}

/**
 * The event fields the SDK can actually emit, straight from its generated
 * support policy: anything the SDK declines to write can never appear in a
 * recorded event body, and pinning a disposition on it would be pinning one on
 * a shape nothing produces.
 */
type EmittableEventField = Extract<
  (typeof EVENT_FIELD_SUPPORT)[number],
  { readonly disposition: "supported" | "partial" }
>["scriptKey"];

/**
 * Exhaustive over {@link EmittableEventField} at compile time, the same way
 * `defineStructuralSemantics` is over `StructuralEffectKey`: a new event field
 * reaching the SDK's authoring surface fails to build here until somebody says
 * what delivery does with it. The runtime side of the same claim is in
 * `tests/whitelist-audit.test.ts`.
 */
function defineEventFieldDelivery<const T extends Record<EmittableEventField, EventFieldImpl>>(
  fields: T & Record<Exclude<keyof T, EmittableEventField>, never>
): Readonly<T> {
  return fields;
}

const WINDOW_PRESENTATION =
  "Event-window presentation: it decides how the event is shown to a player, and delivery shows " +
  "nothing. No script rides on it.";

const NOT_SCHEDULED_HERE =
  "Scheduling, and this harness never schedules: the test says what fires, `advance` only drains " +
  "the queue those fires build. Nothing is skipped at delivery — an event the game would have " +
  "raised on its own simply never appears, which fails an assertion rather than passing one.";

export const EVENT_FIELD_DELIVERY = defineEventFieldDelivery({
  id: { disposition: "inert", note: "The event's identity, which the registry keys on." },
  title: { disposition: "inert", note: WINDOW_PRESENTATION },
  desc: { disposition: "inert", note: WINDOW_PRESENTATION },
  diplomatic_title: { disposition: "inert", note: WINDOW_PRESENTATION },
  message_desc: { disposition: "inert", note: WINDOW_PRESENTATION },
  picture: { disposition: "inert", note: WINDOW_PRESENTATION },
  show_sound: { disposition: "inert", note: WINDOW_PRESENTATION },
  event_picture_background: { disposition: "inert", note: WINDOW_PRESENTATION },
  notification_event_icon: { disposition: "inert", note: WINDOW_PRESENTATION },
  event_window_type: { disposition: "inert", note: WINDOW_PRESENTATION },
  event_message_type: { disposition: "inert", note: WINDOW_PRESENTATION },
  hide_window: { disposition: "inert", note: WINDOW_PRESENTATION },
  diplomatic: { disposition: "inert", note: WINDOW_PRESENTATION },
  force_open: { disposition: "inert", note: WINDOW_PRESENTATION },
  auto_opens: { disposition: "inert", note: WINDOW_PRESENTATION },
  trackable: { disposition: "inert", note: WINDOW_PRESENTATION },
  is_advisor_event: { disposition: "inert", note: WINDOW_PRESENTATION },
  is_test_event: { disposition: "inert", note: WINDOW_PRESENTATION },
  archaeology: { disposition: "inert", note: WINDOW_PRESENTATION },
  first_contact: { disposition: "inert", note: WINDOW_PRESENTATION },
  espionage_operation: { disposition: "inert", note: WINDOW_PRESENTATION },
  astral_rift: { disposition: "inert", note: WINDOW_PRESENTATION },
  difficulty: { disposition: "inert", note: WINDOW_PRESENTATION },
  major: {
    disposition: "inert",
    note: 'Whether other countries see the event too (events.cwt: "Event will show for other countries"). A second audience for a window nobody opens here; the body still runs once, in the scope it was fired on.',
  },
  major_trigger: {
    disposition: "inert",
    note: 'Narrows that second audience (events.cwt: "Triggers for other countries on whether a major event should show for them"). It gates who sees the window, never whether the body runs, so dropping it costs delivery nothing.',
  },
  event_chain: {
    disposition: "inert",
    note: "Names the event chain this event belongs to. Chain counters are separately refused (STRUCTURAL_SEMANTICS's add/reset_event_chain_counter), so membership alone carries no state the fixture pretends to hold.",
  },
  specimen: {
    disposition: "inert",
    note: "The specimen the window displays — a reference read by presentation, with no script attached.",
  },
  situation: {
    disposition: "inert",
    note: "Binds the window to a situation for display. It does not change the scope the body runs in: the event's own scope is what the immediate is applied to, here as in game.",
  },
  location: {
    disposition: "inert",
    note: "Where the window points on the map (events.cwt: `scope[any]`). It is a display anchor, not a scope change for the body.",
  },
  is_triggered_only: {
    disposition: "inert",
    note: "Says the game raises this event only when something fires it — which is the only way anything fires here at all. Nothing to skip.",
  },
  auto_select: {
    disposition: "inert",
    note: "A window-side automation flag the rules give no comment. Whatever it selects, it selects an option, and an option carrying effects is already refused below — so this flag can never be the reason a payoff goes silently unrun.",
  },
  fire_only_once: {
    disposition: "once",
    note: "The game fires such an event once; delivering it twice would apply its effects to a world no game ever held, and the second fired record would read as ordinary. The flag's counting granularity is undocumented, so delivery models the part that is not in doubt — there is a first firing and no second — and refuses the repeat instead of inventing a per-scope or per-game ledger. A chain that genuinely needs a second firing needs a second fixture.",
  },
  mean_time_to_happen: { disposition: "inert", note: NOT_SCHEDULED_HERE },
  weight_multiplier: { disposition: "inert", note: NOT_SCHEDULED_HERE },
  immediate: {
    disposition: "delivered",
    note: "The one block delivery runs, through the same walker every effect goes through.",
  },
  trigger: {
    disposition: "refused",
    note: "The game's own gate on whether this event fires. Delivery does not evaluate it, so a fired record here would claim a firing the game may well have refused — and the immediate's effects would land on a world the condition was written to keep them off. Hold the condition in a named Trigger the test can `evaluate` on its own, and fire the event from a fixture that satisfies it.",
  },
  abort_trigger: {
    disposition: "refused",
    note: 'events.cwt: "Event will cancel (disappear without executing any of the effects in the options) if these triggers return true." A queued fire this harness never re-checks would deliver where the game cancelled it, and the days between queueing and delivery are exactly when the condition changes.',
  },
  abort_effect: {
    disposition: "refused",
    note: 'events.cwt: "Effects executed when abort_trigger returns true." Real script with a real path to running that delivery has no path to.',
  },
  after: {
    disposition: "refused",
    note: "Effects the game runs once the window closes. Delivery runs the immediate and stops, so these are recorded, never run, and their absence is invisible in the fired log — the same hole options had.",
  },
  option: {
    disposition: "options",
    note: "No option is ever selected here (`advance` runs no option auto-selection), so an option's effects never run. Presentation-only options stay deliverable — nothing is skipped when there is nothing to skip — and an option carrying effects is refused.",
  },
});

/**
 * `Object.hasOwn` rather than a bare index: a key read out of recorded script
 * is arbitrary text, and `Object.prototype`'s own members (`constructor`,
 * `toString`) would otherwise come back as though the table had answered —
 * turning the one branch that exists to refuse unknown fields into one that
 * accepts them.
 */
export function eventFieldDeliveryFor(key: string): EventFieldImpl | undefined {
  return Object.hasOwn(EVENT_FIELD_DELIVERY, key)
    ? EVENT_FIELD_DELIVERY[key as EmittableEventField]
    : undefined;
}

/**
 * The option's own declared fields, from the SDK's generated policy. The effect
 * splice (`alias_name[effect]`) is not one of them: option effects are lowered
 * straight into the option block, so every entry that is not one of these names
 * is script somebody wrote to run when the option is chosen.
 */
const OPTION_FIELD_KEYS: ReadonlySet<string> = new Set(
  EVENT_OPTION_FIELD_SUPPORT.map(({ scriptKey }) => scriptKey).filter(
    (scriptKey) => !scriptKey.startsWith("alias_name[")
  )
);

/** The keys inside one `option = { ... }` block that are effects rather than option fields. */
export function optionCarriesEffects(option: PdxEntry): readonly string[] {
  if (option.value.kind !== "container") {
    return [];
  }
  return itemsAsEntries(option.value.items, "option")
    .map((field) => field.key)
    .filter((key) => !OPTION_FIELD_KEYS.has(key));
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
