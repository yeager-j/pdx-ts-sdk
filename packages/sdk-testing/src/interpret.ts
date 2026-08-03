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
import { EVENT_KINDS, isEffectKey, makeScope, type ScopeObjOf, type Trigger } from "@pdx-ts/sdk";

import {
  cloneState,
  Country,
  Planet,
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
    if (COMBINATOR_SEMANTICS[entry.key] !== undefined && entry.value.kind === "container") {
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
    // ctx.self` records nothing (src/effect-core.ts), which is exactly this.
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
    if (entry.key === "from" || entry.key.startsWith(EVENT_TARGET_PREFIX)) {
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
  const sink: PdxEntry[] = [];
  effect(makeScope<S>(sink));

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

export function handleFor(state: WorldState, id: EntityId): Country | Planet {
  if (id.kind === "country") {
    return new Country(state, id.country);
  }
  return new Planet(state, id.country, id.planet);
}
