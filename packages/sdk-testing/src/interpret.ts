/**
 * The one interpreter under both testing layers (pure `run()` and the
 * stateful `World`). It walks the exact `PdxEntry` ASTs the SDK records —
 * triggers via `Trigger.entries`, effects via event `immediate` blocks — and
 * dispatches every key through the whitelist. Unknown or unimplemented keys
 * throw with the coverage summary; nothing evaluates silently.
 *
 * `explain` (handoff open question 2) is the point of the trigger walker:
 * not the boolean but the pass/fail tree that names the failing
 * subcondition. Per-entry attribution over the recorded AST is enough
 * because every generated leaf trigger records exactly one entry.
 */

import type { PdxEntry, PdxScalar } from "@pdx-ts/pdxscript";
import {
  EVENT_KINDS,
  isEffectKey,
  recordEffects,
  type ComplexTriggerModifier,
  type Modifier,
  type ScopeObjOf,
  type Trigger,
  type WeightBlockRow,
} from "@pdx-ts/sdk";

import {
  ArchaeologicalSite,
  cloneState,
  Country,
  Fleet,
  Planet,
  Situation,
  type EntityId,
  type HandleOf,
  type SimScope,
  type SimScopeName,
  type WorldState,
} from "./state.ts";
import {
  COMBINATOR_SEMANTICS,
  coverageSummary,
  EFFECT_SEMANTICS,
  EVENT_TARGET_PREFIX,
  InterpreterError,
  itemsAsEntries,
  ITERATOR_SEMANTICS,
  LINK_SEMANTICS,
  resolveEventTarget,
  STRUCTURAL_SEMANTICS,
  TRIGGER_SEMANTICS,
  type ExecCtx,
} from "./whitelist.ts";

export { InterpreterError } from "./whitelist.ts";

export interface ForcedArms {
  /** random_list arms to take, by weight key, consumed in encounter order. */
  readonly arms?: readonly number[];
}

export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 360;

// ---------------------------------------------------------------------------
// Trigger evaluation and explain
// ---------------------------------------------------------------------------

export type Explanation =
  | {
      readonly kind: "leaf";
      readonly key: string;
      /** The condition as recorded, e.g. `has_country_flag = tp_pacifist_path`. */
      readonly rendered: string;
      readonly result: boolean;
      readonly detail: string;
    }
  | {
      readonly kind: "all" | "any" | "none";
      readonly label: string;
      readonly result: boolean;
      readonly children: readonly Explanation[];
    };

function renderScalar(scalar: PdxScalar): string {
  switch (scalar.kind) {
    case "bool":
      return scalar.value ? "yes" : "no";
    case "num":
      return String(scalar.value);
    case "str":
      return scalar.value;
    case "var":
      return scalar.name;
    case "math":
      return scalar.source;
  }
}

function renderCondition(entry: PdxEntry): string {
  if (entry.value.kind === "container") {
    return `${entry.key} ${entry.op} { ... }`;
  }
  return `${entry.key} ${entry.op} ${renderScalar(entry.value)}`;
}

/** Collects every key in a trigger tree the whitelist does not implement. */
function unimplementedTriggerKeys(entries: readonly PdxEntry[], found: Set<string>): void {
  for (const entry of entries) {
    const combinator = COMBINATOR_SEMANTICS[entry.key];
    if (combinator !== undefined) {
      if (entry.value.kind === "container") {
        unimplementedTriggerKeys(itemsAsEntries(entry.value.items, entry.key), found);
      }
      continue;
    }
    const link = LINK_SEMANTICS[entry.key];
    if (link !== undefined) {
      if (entry.value.kind === "container") {
        unimplementedTriggerKeys(itemsAsEntries(entry.value.items, entry.key), found);
      }
      continue;
    }
    if (TRIGGER_SEMANTICS[entry.key] === undefined) {
      found.add(entry.key);
    }
  }
}

function combine(mode: "all" | "any" | "none", children: readonly Explanation[]): boolean {
  switch (mode) {
    case "all":
      return children.every((child) => child.result);
    case "any":
      return children.some((child) => child.result);
    case "none":
      return children.every((child) => !child.result);
  }
}

function explainEntry(entry: PdxEntry, scope: EntityId, ex: ExecCtx): Explanation {
  const combinator = COMBINATOR_SEMANTICS[entry.key];
  if (combinator !== undefined) {
    if (entry.value.kind !== "container") {
      throw new InterpreterError(`${entry.key}: expected a block. ${coverageSummary()}`);
    }
    const children = itemsAsEntries(entry.value.items, entry.key).map((child) =>
      explainEntry(child, scope, ex)
    );
    return {
      kind: combinator.mode,
      label: entry.key,
      result: combine(combinator.mode, children),
      children,
    };
  }
  // Scope links (`target = { ... }`, `from = { ... }`) are structurally like
  // a combinator block, but their children evaluate against a different
  // scope — the one thing COMBINATOR_SEMANTICS's same-scope recursion cannot
  // express, so this is a second, scope-changing arm rather than a special
  // case bolted onto the first.
  const link = LINK_SEMANTICS[entry.key];
  if (link !== undefined) {
    if (entry.value.kind !== "container") {
      throw new InterpreterError(`${entry.key}: expected a block. ${coverageSummary()}`);
    }
    const target = link.resolve(scope, ex);
    const children = itemsAsEntries(entry.value.items, entry.key).map((child) =>
      explainEntry(child, target, ex)
    );
    return { kind: "all", label: entry.key, result: combine("all", children), children };
  }
  const impl = TRIGGER_SEMANTICS[entry.key];
  if (impl === undefined) {
    throw new InterpreterError(
      `Unimplemented trigger "${entry.key}" — the interpreter whitelists semantics ` +
        `deliberately; nothing evaluates silently. ${coverageSummary()}`
    );
  }
  const { result, detail } = impl.eval(entry, scope, ex);
  return { kind: "leaf", key: entry.key, rendered: renderCondition(entry), result, detail };
}

function explainEntries(entries: readonly PdxEntry[], scope: EntityId, ex: ExecCtx): Explanation {
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only !== undefined) {
    return explainEntry(only, scope, ex);
  }
  const children = entries.map((entry) => explainEntry(entry, scope, ex));
  return { kind: "all", label: "(top)", result: combine("all", children), children };
}

function execCtxFor(scope: SimScope<SimScopeName>): ExecCtx {
  return {
    state: scope.state,
    root: scope.id,
    from: undefined,
    forcedArms: [],
    targets: new Map(),
  };
}

/**
 * Appended to both "I do not know this key" errors, because the likeliest cause
 * is now a scripted binding rather than a codegen gap — and the two want
 * completely different responses.
 *
 * A vanilla scripted trigger will never be implementable here: the identifier
 * package carries names, parameters and scopes and never bodies, by a licensing
 * constraint the generator enforces. So this is not a backlog item, and saying
 * only "unimplemented" sends the reader looking for one.
 */
const SCRIPTED_HINT =
  "A vanilla or third-party scripted trigger/effect lands here and always will: " +
  "the SDK binds them by name and never reads their bodies, so the interpreter " +
  "has nothing to evaluate. Assert against the emitted script instead.";

export function explain<S extends SimScopeName>(
  trigger: Trigger<S>,
  scope: SimScope<S>
): Explanation {
  // Pre-scan so a test with several gaps reports them all at once — the
  // error is the coverage report.
  const missing = new Set<string>();
  unimplementedTriggerKeys(trigger.entries, missing);
  if (missing.size > 0) {
    const evaluated = new Set<string>();
    collectTriggerKeys(trigger.entries, evaluated);
    throw new InterpreterError(
      `This trigger uses ${evaluated.size} condition${evaluated.size === 1 ? "" : "s"}; ` +
        `${missing.size} unimplemented: ${[...missing].join(", ")}. ` +
        `The interpreter whitelists semantics deliberately; nothing evaluates silently. ` +
        `${SCRIPTED_HINT} ${coverageSummary()}`
    );
  }
  return explainEntries(trigger.entries, scope.id, execCtxFor(scope));
}

function collectTriggerKeys(entries: readonly PdxEntry[], found: Set<string>): void {
  for (const entry of entries) {
    const recurses =
      (COMBINATOR_SEMANTICS[entry.key] !== undefined || LINK_SEMANTICS[entry.key] !== undefined) &&
      entry.value.kind === "container";
    if (recurses) {
      collectTriggerKeys(itemsAsEntries(entry.value.items, entry.key), found);
    } else {
      found.add(entry.key);
    }
  }
}

export function evaluate<S extends SimScopeName>(trigger: Trigger<S>, scope: SimScope<S>): boolean {
  return explain(trigger, scope).result;
}

/**
 * The matcher pack's runtime door: same walker, no scope correlation —
 * vitest's `Assertion<T>` cannot relate the received trigger's scope to the
 * matcher argument, so the check happens at runtime (the whitelist impls
 * guard entity kinds). Tests should use `evaluate`/`explain`.
 */
export function explainFor(
  trigger: { readonly entries: readonly PdxEntry[] },
  scope: SimScope<SimScopeName>
): Explanation {
  return explainEntries(trigger.entries, scope.id, execCtxFor(scope));
}

export function renderExplanation(explanation: Explanation): string {
  const lines: string[] = [];
  const render = (node: Explanation, depth: number): void => {
    const indent = "  ".repeat(depth);
    const mark = node.result ? "✓" : "✗";
    if (node.kind === "leaf") {
      lines.push(`${indent}${mark} ${node.rendered} — ${node.detail}`);
    } else {
      lines.push(`${indent}${mark} ${node.label}`);
      for (const child of node.children) {
        render(child, depth + 1);
      }
    }
  };
  render(explanation, 0);
  return lines.join("\n");
}

/** Evaluates a limit block (implicit AND over its entries). */
function evaluateLimit(entries: readonly PdxEntry[], scope: EntityId, ex: ExecCtx): boolean {
  return entries.every((entry) => explainEntry(entry, scope, ex).result);
}

// ---------------------------------------------------------------------------
// Effect application
// ---------------------------------------------------------------------------

const FIRE_KEYS = new Map<string, (typeof EVENT_KINDS)[keyof typeof EVENT_KINDS]>(
  Object.values(EVENT_KINDS).map((kind) => [kind.key, kind])
);

function requireBlock(entry: PdxEntry): readonly PdxEntry[] {
  if (entry.value.kind !== "container") {
    throw new InterpreterError(
      `${entry.key}: expected a block, got a ${entry.value.kind}. ${coverageSummary()}`
    );
  }
  return itemsAsEntries(entry.value.items, entry.key);
}

function applyFire(entry: PdxEntry, scope: EntityId, ex: ExecCtx): void {
  const kind = FIRE_KEYS.get(entry.key);
  if (kind === undefined) {
    throw new InterpreterError("unreachable: applyFire called for a non-fire key");
  }
  if (kind.scope !== scope.kind) {
    throw new InterpreterError(
      `${entry.key} fired from ${scope.kind} scope — the game requires ${String(kind.scope)} ` +
        `scope here. ${coverageSummary()}`
    );
  }
  let id: string | undefined;
  let delay = 0;
  let from: EntityId | undefined;
  for (const field of requireBlock(entry)) {
    if (field.key === "id" && field.value.kind === "str") {
      id = field.value.value;
    } else if (field.key === "days" && field.value.kind === "num") {
      delay += field.value.value;
    } else if (field.key === "months" && field.value.kind === "num") {
      delay += field.value.value * DAYS_PER_MONTH;
    } else if (field.key === "years" && field.value.kind === "num") {
      delay += field.value.value * DAYS_PER_YEAR;
    } else if (field.key === "random") {
      throw new InterpreterError(
        `${entry.key} has a random delay component — forced branches, not rolls: the ` +
          `testing SDK defaults random to zero, so a recorded one is deliberate and ` +
          `unsupported here. ${coverageSummary()}`
      );
    } else if (field.key === "scopes" && field.value.kind === "container") {
      for (const scopeField of itemsAsEntries(field.value.items, entry.key)) {
        if (scopeField.key !== "from" || scopeField.value.kind !== "str") {
          throw new InterpreterError(
            `${entry.key} scopes override "${scopeField.key}" is not modeled. ${coverageSummary()}`
          );
        }
        from = resolveScopePath(scopeField.value.value, scope, ex);
      }
    } else {
      throw new InterpreterError(
        `${entry.key} field "${field.key}" is not modeled. ${coverageSummary()}`
      );
    }
  }
  if (id === undefined) {
    throw new InterpreterError(`${entry.key} block has no id. ${coverageSummary()}`);
  }
  ex.state.queue.push({
    id,
    dueDay: ex.state.day + delay,
    scope,
    // The natural FROM is the firing execution's root scope — `from:
    // ctx.self` records nothing (the effect recorder), which is exactly this.
    from: from ?? ex.root,
    seq: ex.state.seq++,
  });
}

/** Resolves a recorded scope path (`this`, `from`, `event_target:x`). */
function resolveScopePath(path: string, scope: EntityId, ex: ExecCtx): EntityId {
  if (path === "this") {
    return scope;
  }
  if (path.startsWith(EVENT_TARGET_PREFIX)) {
    return resolveEventTarget(path.slice(EVENT_TARGET_PREFIX.length), ex);
  }
  const link = LINK_SEMANTICS[path];
  if (link === undefined) {
    throw new InterpreterError(`Scope path "${path}" is not modeled. ${coverageSummary()}`);
  }
  return link.resolve(scope, ex);
}

function applyRandomList(entry: PdxEntry, scope: EntityId, ex: ExecCtx): void {
  const arms = requireBlock(entry);
  const forced = ex.forcedArms.shift();
  if (forced === undefined) {
    throw new InterpreterError(
      `random_list encountered without a forced arm — tests choose branches explicitly ` +
        `(fire with { arms: [<weight>] }); forced branches make readable tests, seeds make ` +
        `flaky ones. Arms here: ${arms.map((arm) => arm.key).join(", ")}. ${coverageSummary()}`
    );
  }
  const matching = arms.filter((arm) => arm.key === String(forced));
  const chosen = matching[0];
  if (chosen === undefined || matching.length > 1) {
    throw new InterpreterError(
      `Forced arm ${forced} ${matching.length > 1 ? "is ambiguous" : "does not exist"} in this ` +
        `random_list — arms are chosen by weight key; available: ` +
        `${arms.map((arm) => arm.key).join(", ")}. ${coverageSummary()}`
    );
  }
  // Weight modifiers (`modifier` blocks) are deliberately NOT evaluated under
  // forcing — the test chose the arm, so weights are irrelevant.
  const body = requireBlock(chosen).filter((child) => child.key !== "modifier");
  applyEffectEntries(body, scope, ex);
}

function applyIterator(entry: PdxEntry, scope: EntityId, ex: ExecCtx): void {
  const iterator = ITERATOR_SEMANTICS[entry.key];
  if (iterator === undefined) {
    throw new InterpreterError("unreachable: applyIterator called for a non-iterator key");
  }
  const entries = requireBlock(entry);
  const limit = entries.find((child) => child.key === "limit");
  const body = entries.filter((child) => child.key !== "limit");
  for (const target of iterator.targets(scope, ex)) {
    if (limit !== undefined && !evaluateLimit(requireBlock(limit), target, ex)) {
      continue;
    }
    applyEffectEntries(body, target, ex);
  }
}

export function applyEffectEntries(
  entries: readonly PdxEntry[],
  scope: EntityId,
  ex: ExecCtx
): void {
  // if/else_if/else chains associate by position; `taken` tracks whether the
  // current chain has already applied a branch.
  let chain: { taken: boolean } | undefined;
  for (const entry of entries) {
    if (entry.key === "if") {
      chain = { taken: false };
      const body = requireBlock(entry);
      const limit = body.find((child) => child.key === "limit");
      if (limit === undefined) {
        throw new InterpreterError(`if without a limit block. ${coverageSummary()}`);
      }
      if (evaluateLimit(requireBlock(limit), scope, ex)) {
        chain.taken = true;
        applyEffectEntries(
          body.filter((child) => child.key !== "limit"),
          scope,
          ex
        );
      }
      continue;
    }
    if (entry.key === "else_if" || entry.key === "else") {
      if (chain === undefined) {
        throw new InterpreterError(
          `${entry.key} without a preceding if — the game associates chains by position. ` +
            coverageSummary()
        );
      }
      if (!chain.taken) {
        const body = requireBlock(entry);
        const limit = body.find((child) => child.key === "limit");
        const applies =
          entry.key === "else" ||
          (limit !== undefined && evaluateLimit(requireBlock(limit), scope, ex));
        if (applies) {
          chain.taken = true;
          applyEffectEntries(
            body.filter((child) => child.key !== "limit"),
            scope,
            ex
          );
        }
      }
      if (entry.key === "else") {
        chain = undefined;
      }
      continue;
    }
    chain = undefined;

    if (entry.key === "hidden_effect") {
      // Transparent: hiding is a tooltip concern, and the block changes no
      // scope. Its entries run exactly as they would unwrapped, which is what
      // the game does — nothing here is a guess about semantics.
      applyEffectEntries(requireBlock(entry), scope, ex);
      continue;
    }
    if (entry.key === "random_list") {
      applyRandomList(entry, scope, ex);
      continue;
    }
    if (FIRE_KEYS.has(entry.key)) {
      applyFire(entry, scope, ex);
      continue;
    }
    if (ITERATOR_SEMANTICS[entry.key] !== undefined) {
      applyIterator(entry, scope, ex);
      continue;
    }
    if (entry.key.startsWith(EVENT_TARGET_PREFIX) || LINK_SEMANTICS[entry.key] !== undefined) {
      const target = resolveScopePath(entry.key, scope, ex);
      applyEffectEntries(requireBlock(entry), target, ex);
      continue;
    }
    const effect = EFFECT_SEMANTICS[entry.key];
    if (effect !== undefined) {
      effect.apply(entry, scope, ex);
      continue;
    }
    const known = isEffectKey(entry.key) || STRUCTURAL_SEMANTICS[entry.key] !== undefined;
    throw new InterpreterError(
      known
        ? `Effect "${entry.key}" is real but unimplemented in the testing interpreter. ` +
            coverageSummary()
        : `Unknown key "${entry.key}" — not a whitelisted semantic and not in the SDK's ` +
            `effect meta table. ${SCRIPTED_HINT} ${coverageSummary()}`
    );
  }
}

// ---------------------------------------------------------------------------
// The pure layer: run one effect closure against a cloned world
// ---------------------------------------------------------------------------

export interface RunResult<S extends SimScopeName> {
  /** A handle into the cloned, mutated state; the input world is untouched. */
  readonly after: HandleOf<S>;
  readonly queued: ReadonlyArray<{ readonly id: string; readonly dueDay: number }>;
  readonly log: readonly string[];
}

/**
 * Records the closure with the SDK's real recorder, then interprets the
 * recorded entries against a CLONE of the scope's world. One-shot unit
 * testing without touching the stateful fixture — one interpreter under
 * both layers.
 */
export function run<S extends SimScopeName>(
  effect: (scope: ScopeObjOf<S>) => void,
  scope: SimScope<S>,
  opts?: ForcedArms
): RunResult<S> {
  // Through recordEffects, not makeScope: an author's closure may open a ref
  // with `.effects()`, and that needs a live recording to write into.
  const sink = recordEffects<S>([], effect);

  const clone = cloneState(scope.state);
  const queueBase = clone.queue.length;
  const logBase = clone.log.length;
  const ex: ExecCtx = {
    state: clone,
    root: scope.id,
    from: undefined,
    forcedArms: [...(opts?.arms ?? [])],
    targets: new Map(),
  };
  applyEffectEntries(sink, scope.id, ex);

  return {
    // The harness's one cast: HandleOf<S> cannot be narrowed structurally
    // from a runtime discriminant TypeScript does not connect to S.
    after: handleFor(clone, scope.id) as HandleOf<S>,
    queued: clone.queue.slice(queueBase).map(({ id, dueDay }) => ({ id, dueDay })),
    log: clone.log.slice(logBase),
  };
}

export function handleFor(
  state: WorldState,
  id: EntityId
): Country | Planet | Fleet | Situation | ArchaeologicalSite {
  switch (id.kind) {
    case "country":
      return new Country(state, id.country);
    case "planet":
      return new Planet(state, id.country, id.planet);
    case "fleet":
      return new Fleet(state, id.fleet);
    case "situation":
      return new Situation(state, id.situation);
    case "archaeological_site":
      return new ArchaeologicalSite(state, id.site);
  }
}

// ---------------------------------------------------------------------------
// Weight-block arithmetic — a situation's `monthlyProgress` and friends
// ---------------------------------------------------------------------------

const MODIFIER_OPS = [
  "add",
  "subtract",
  "mult",
  "multiplier",
  "factor",
  "divide",
  "minValue",
  "maxValue",
  "weight",
] as const;

/**
 * Every numeric operation `Modifier<S>` (`packages/sdk/src/script/effects/types.ts`)
 * declares, minus the members that are not operations: `desc` and its
 * companion `descKey` (localisation, SDK-48) and `when` (the gating trigger).
 * `applyModifierRow`'s multi-operation guard is only as complete as
 * `MODIFIER_OPS` — a member present on `Modifier` but missing here would let
 * a row that combines it with a recognized operation silently evaluate only
 * the recognized one, exactly the guessing this guard exists to refuse.
 *
 * Adding a non-operation member to `Modifier` therefore means excluding it
 * here as well. The guard below is what makes that a build failure rather
 * than a silent gap — it is doing its job when it fires.
 */
type ModifierOpKey = Exclude<keyof Modifier<never>, "desc" | "descKey" | "when">;

/** `true` iff `A` and `B` contain exactly the same members, in either order. */
type SameKeys<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

// Compile-time drift guard: if `Modifier<S>` gains or loses an operation
// field (PR #16 widens `WeightBlock`'s operations further), this line stops
// compiling until MODIFIER_OPS is updated to match — turning a silent gap in
// the multi-operation check into a build failure instead.
const _modifierOpsMatchModifier: SameKeys<(typeof MODIFIER_OPS)[number], ModifierOpKey> = true;

/**
 * The shape `evaluateWeightBlock` needs — `WeightBlock`/`WeightBlockWithLoc`
 * both satisfy it. `modifiers` is `WeightBlockRow<S, Modifier<S>>`
 * (`Modifier | ComplexTriggerModifier`), the same wider row union PR #16
 * gave `WeightBlock` itself, rather than `Modifier<S>` alone — otherwise a
 * real `situation.monthlyProgress` value (which can legally contain a
 * `complex_trigger_modifier` row) would not type-check as an argument here
 * even when every row it actually carries is a plain `Modifier`.
 * `evaluateWeightBlock` refuses a `ComplexTriggerModifier` row at the one
 * point it would otherwise reach `.when` on something that does not have
 * one, rather than admitting only `Modifier<S>[]` and pushing that
 * narrowing burden onto every call site.
 */
export interface WeightBlockLike<S extends SimScopeName> {
  readonly base?: number;
  readonly modifiers?: readonly WeightBlockRow<S, Modifier<S>>[];
}

function isComplexTriggerModifierRow<S extends SimScopeName>(
  row: WeightBlockRow<S, Modifier<S>>
): row is ComplexTriggerModifier<S> {
  return "trigger" in row;
}

/**
 * Computes a `modifier_rule` block's value: a starting `base`, then each
 * `modifier` row whose `when` trigger holds applies its one operation in
 * order. The operation set and spellings mirror `Modifier` itself
 * (`packages/sdk/src/script/effects/types.ts`, kept in sync by the `SameKeys` guard
 * above) — `add`/`subtract`/`mult`/`multiplier`/`factor`/`divide` change the
 * running value, `minValue`/`maxValue` clamp it, and `weight` is detected but
 * refused (see `applyModifierRow`'s `weight` case) because nothing has
 * verified its semantic against the game.
 *
 * A row combining more than one operation is refused rather than guessed:
 * nothing in the corpus measures a cross-operation order within one row, so
 * asserting one here would be exactly the kind of invented semantic this
 * interpreter's whitelist exists to avoid. The numeric v1 line applies too —
 * a row whose operand is a script value or variable (not a fixture-evaluable
 * literal) throws instead of silently reading as 0/NaN.
 *
 * A `complex_trigger_modifier` row (PR #16) is refused the same way: its
 * value depends on a named trigger's runtime result, which nothing here
 * evaluates, so guessing a number for it would be exactly the invented
 * semantic this interpreter exists to avoid.
 */
export function evaluateWeightBlock<S extends SimScopeName>(
  block: WeightBlockLike<S>,
  scope: SimScope<S>
): number {
  let value = block.base ?? 0;
  for (const row of block.modifiers ?? []) {
    if (isComplexTriggerModifierRow(row)) {
      throw new InterpreterError(
        `A monthly-progress row names a scripted trigger ("${row.trigger}") instead of a when ` +
          `condition — complex_trigger_modifier rows depend on that trigger's runtime result, ` +
          `which this interpreter does not evaluate. ${coverageSummary()}`
      );
    }
    if (!evaluate(row.when, scope)) {
      continue;
    }
    value = applyModifierRow(row, value);
  }
  return value;
}

function applyModifierRow<S extends SimScopeName>(modifier: Modifier<S>, value: number): number {
  const present = MODIFIER_OPS.filter((op) => modifier[op] !== undefined);
  if (present.length !== 1) {
    throw new InterpreterError(
      `A monthly-progress row${modifier.desc !== undefined ? ` ("${modifier.desc}")` : ""} sets ` +
        `${present.length} operation${present.length === 1 ? "" : "s"}` +
        `${present.length === 0 ? "" : ` (${present.join(", ")})`} — the testing interpreter ` +
        `evaluates exactly one operation per row; combining operations on one row has no ` +
        `corpus-measured evaluation order. ${coverageSummary()}`
    );
  }
  const [op] = present;
  if (op === undefined) {
    throw new InterpreterError("unreachable: present.length === 1 was just checked");
  }
  const amount = modifier[op];
  if (typeof amount !== "number") {
    throw new InterpreterError(
      `${op} ${String(amount)}: expected a number — the numeric v1 line evaluates literals and ` +
        `fixture-stored numbers only; script values and variables are out. ${coverageSummary()}`
    );
  }
  switch (op) {
    case "add":
      return value + amount;
    case "subtract":
      return value - amount;
    case "mult":
    case "multiplier":
    case "factor":
      return value * amount;
    case "divide":
      return value / amount;
    case "minValue":
      return Math.max(value, amount);
    case "maxValue":
      return Math.min(value, amount);
    case "weight":
      // `weight` is a real, distinct member of `modifier_rule.cwt`'s
      // `complex_maths_enum` (alongside `set`, which `Modifier` does not
      // even expose) — the vendored rules give it no descriptive comment,
      // so nothing here says whether it behaves like `set` (replace the
      // running value) or something else. MODIFIER_OPS still has to detect
      // it (a row that combines `weight` with a recognized operation must
      // be refused as ambiguous, not silently read as the other operation),
      // but evaluating it on its own would be exactly the guessed semantic
      // this interpreter's whitelist exists to avoid.
      throw new InterpreterError(
        `weight ${amount}: recognized but not evaluated — the vendored rules document no ` +
          `semantic for it distinct from "set", and nothing here has verified one against the ` +
          `game. ${coverageSummary()}`
      );
  }
}
