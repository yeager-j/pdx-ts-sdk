/**
 * Infers the scopes a vanilla scripted trigger or effect is legal in, by
 * intersecting the scopes the CWT rules already declare for the primitives its
 * body evaluates.
 *
 * This is not the body inference `docs/handoff-vanilla-surface.md` rejected.
 * That was heuristics over what a body *means*; this reads only what the rules
 * already say about where each key is *legal*, and every key the rules do not
 * cover contributes nothing rather than a guess. The analysis can therefore be
 * too wide — which is exactly today's `Trigger<ScopeName>` — but a narrowing it
 * does produce is a consequence of the rules, not an opinion about the script.
 *
 * Soundness rests on four rules, each of which is a way to *avoid* narrowing:
 *
 * - **`OR` unions, everything else intersects.** Vanilla deliberately writes
 *   dual-scope triggers as `OR` arms that are simply false in the other scope.
 *   Intersecting those yields the empty set; unioning them yields the truth.
 * - **A pushed scope contributes nothing to the enclosing one.** Conditions
 *   inside `owner = { ... }` or `any_owned_planet = { ... }` constrain the
 *   pushed scope. Only the link or iterator key itself constrains the caller.
 * - **`[[FLAG] ... ]` blocks contribute nothing.** The block may be absent at
 *   the call site, so its conditions are not the trigger's.
 * - **An empty result falls back to unconstrained.** ∅ means either a genuine
 *   dual-scope trigger or an analysis that lost the thread; neither is a claim
 *   worth making.
 */

import type { PdxItem, PdxValue } from "@pdx-ts/pdxscript";

import type { RuleFact, RuleScopes, ScopeTables } from "./scope-tables.ts";

/**
 * Scope-transparent wrappers the rules declare nothing about.
 *
 * `AND`/`NOT`/`NOR`/`NAND` are combinators cwtools leaves to the engine.
 * `hidden_trigger` and `hidden_effect` only suppress tooltips — their contents
 * run in the enclosing scope, which is why they are here rather than skipped as
 * unknown keys. Both were the largest single gap in the probe's first run:
 * 42 trigger and 222 effect definitions lost every narrowing behind them.
 */
const INTERSECTING = new Set(["and", "nand", "not", "nor", "hidden_trigger", "hidden_effect"]);
const UNIONING = new Set(["or"]);

/**
 * Keys whose scope depends on the call site rather than the definition:
 * `prev` is the caller's previous scope, `root`/`from` the caller's entry
 * points, `event_target:`/`this` are saved or ambient. A body that navigates
 * through one of these says nothing about where the trigger itself is legal.
 */
const CALLER_RELATIVE = new Set([
  "this",
  "root",
  "prev",
  "prevprev",
  "prevprevprev",
  "prevprevprevprev",
  "from",
  "fromfrom",
  "fromfromfrom",
  "fromfromfromfrom",
]);

/** Why a definition ended up unconstrained, or less narrow than it might be. */
export interface Diagnostic {
  readonly kind: "unknown-key" | "parameter-key" | "param-block" | "caller-relative" | "emptied";
  readonly detail: string;
}

export interface Inferred {
  readonly name: string;
  readonly scopes: RuleScopes;
  readonly diagnostics: readonly Diagnostic[];
}

export interface Definition {
  readonly name: string;
  readonly items: readonly PdxItem[];
}

export type Registry = "trigger" | "effect";

// ---------------------------------------------------------------------------
// Scope-set algebra. `"universal"` is the intersection identity and the union
// absorber — the two properties that make "unknown" safe.
// ---------------------------------------------------------------------------

export function intersect(left: RuleScopes, right: RuleScopes): RuleScopes {
  if (left === "universal") {
    return right;
  }
  if (right === "universal") {
    return left;
  }
  return left.filter((scope) => right.includes(scope));
}

export function union(left: RuleScopes, right: RuleScopes): RuleScopes {
  if (left === "universal" || right === "universal") {
    return "universal";
  }
  return [...new Set([...left, ...right])].sort();
}

// ---------------------------------------------------------------------------

function itemsOf(value: PdxValue): readonly PdxItem[] | null {
  return value.kind === "container" ? value.items : null;
}

/** A `$PARAM$` substitution anywhere in the key makes the key unreadable. */
function isParameterized(key: string): boolean {
  return key.includes("$");
}

class Walker {
  private readonly memo = new Map<string, RuleScopes>();
  private readonly active = new Set<string>();
  private diagnostics: Diagnostic[] = [];
  private cycles = 0;

  private readonly tables: ScopeTables;
  private readonly definitions: Readonly<Record<Registry, ReadonlyMap<string, Definition>>>;

  constructor(
    tables: ScopeTables,
    definitions: Readonly<Record<Registry, ReadonlyMap<string, Definition>>>
  ) {
    this.tables = tables;
    this.definitions = definitions;
  }

  infer(definition: Definition, registry: Registry): Inferred {
    this.diagnostics = [];
    const scopes = this.scopesOf(definition, registry);
    return { name: definition.name, scopes, diagnostics: this.diagnostics };
  }

  private scopesOf(definition: Definition, registry: Registry): RuleScopes {
    const key = `${registry}:${definition.name.toLowerCase()}`;
    const cached = this.memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (this.active.has(key)) {
      // A cycle in the call graph. Nothing is known yet about the definition
      // being re-entered, and assuming anything would make the result depend on
      // which definition the walk happened to start from.
      this.cycles += 1;
      return "universal";
    }
    this.active.add(key);
    const before = this.cycles;
    const body = this.walkBody(definition.items, true, registry);
    this.active.delete(key);
    const emptied = body !== "universal" && body.length === 0;
    if (emptied) {
      this.note("emptied", definition.name);
    }
    const scopes = emptied ? "universal" : body;
    // A result computed across a broken cycle depends on the entry point, so it
    // is answered but not remembered.
    if (this.cycles === before) {
      this.memo.set(key, scopes);
    }
    return scopes;
  }

  private note(kind: Diagnostic["kind"], detail: string): void {
    this.diagnostics.push({ kind, detail });
  }

  /**
   * A body is an implicit AND of its statements. `applies` is false when the
   * statements run in a pushed scope — they are still walked, so their unknown
   * keys are reported, but they cannot constrain the caller.
   */
  private walkBody(items: readonly PdxItem[], applies: boolean, registry: Registry): RuleScopes {
    let scopes: RuleScopes = "universal";
    for (const item of items) {
      scopes = intersect(scopes, this.walkItem(item, applies, registry));
    }
    return scopes;
  }

  private walkItem(item: PdxItem, applies: boolean, registry: Registry): RuleScopes {
    switch (item.kind) {
      case "entry":
        return this.walkEntry(item.key, item.value, applies, registry);
      case "param":
        // `[[FLAG] ... ]` — present only when the caller defines FLAG, so its
        // conditions are the call site's, not the definition's. Walked for
        // diagnostics with `applies: false`, never for constraint.
        this.note("param-block", item.name);
        this.walkBody(item.items, false, registry);
        return "universal";
      default:
        return "universal";
    }
  }

  private walkEntry(
    rawKey: string,
    value: PdxValue,
    applies: boolean,
    registry: Registry
  ): RuleScopes {
    const key = rawKey.toLowerCase();
    const children = itemsOf(value);

    if (isParameterized(rawKey)) {
      this.note("parameter-key", rawKey);
      return "universal";
    }
    if (INTERSECTING.has(key)) {
      return children === null ? "universal" : this.walkBody(children, applies, registry);
    }
    if (UNIONING.has(key)) {
      if (children === null) {
        return "universal";
      }
      // Each arm is one statement. A trigger valid in a scope needs only one
      // arm legal there, so the arms union rather than intersect.
      let arms: RuleScopes = [];
      for (const child of children) {
        arms = union(arms, this.walkItem(child, applies, registry));
      }
      return arms;
    }

    // `owner.overlord.species = { ... }`, `starbase? = { ... }` — a chain of
    // hops written as one key. Only the first hop constrains the caller; where
    // the chain lands is several scopes away and nothing inside is attributable.
    const first = key.split(".")[0]!.replace(/\?$/, "");
    if (CALLER_RELATIVE.has(first) || first.includes(":")) {
      this.note("caller-relative", rawKey);
      return "universal";
    }

    const link = this.tables.links.get(first);
    if (link !== undefined) {
      const chained = first !== key;
      if (children !== null && !chained) {
        this.walkBody(children, false, registry);
      }
      return applies ? link.inputScopes : "universal";
    }

    const nested = this.definitions[registry].get(key) ?? this.definitions.trigger.get(key);
    if (nested !== undefined) {
      // A scripted effect's body reaches scripted triggers through its `limit`
      // blocks, so the lookup crosses registries — and the recursion walks the
      // callee under ITS registry, not the caller's.
      const calleeRegistry = this.definitions[registry].has(key) ? registry : "trigger";
      const scopes = this.scopesOf(nested, calleeRegistry);
      return applies ? scopes : "universal";
    }

    const rule = this.ruleFor(key, registry);
    if (rule !== undefined) {
      const own = applies ? rule.scopes : "universal";
      return children === null
        ? own
        : intersect(own, this.walkRuleBody(rule, children, applies, registry));
    }

    this.note("unknown-key", rawKey);
    return "universal";
  }

  /**
   * The interior of a known block rule. Only clause fields hold conditions;
   * everything else is an argument (`count = 2`) and is ignored rather than
   * reported as an unknown trigger. A clause that runs in the enclosing scope
   * still constrains it — that is what makes `custom_tooltip` and `limit`
   * inside `if` transparent.
   */
  private walkRuleBody(
    rule: RuleFact,
    children: readonly PdxItem[],
    applies: boolean,
    registry: Registry
  ): RuleScopes {
    let scopes: RuleScopes = "universal";
    for (const child of children) {
      const name = child.kind === "entry" ? child.key.toLowerCase() : null;
      const clause = name === null ? undefined : rule.clauses.get(name);
      if (clause !== undefined) {
        const items = child.kind === "entry" ? itemsOf(child.value) : null;
        if (items !== null) {
          scopes = intersect(scopes, this.walkBody(items, applies && clause === null, registry));
        }
        continue;
      }
      // An argument, not a condition: `while = { count = 5 <effects> }` splices
      // effects AND declares `count`, so "not a clause field" is not enough to
      // tell them apart — the rule's own field list is.
      if (name !== null && rule.args.has(name)) {
        continue;
      }
      if (rule.splice === null) {
        continue;
      }
      scopes = intersect(
        scopes,
        this.walkItem(child, applies && rule.splice.scope === null, registry)
      );
    }
    return scopes;
  }

  private ruleFor(key: string, registry: Registry): RuleFact | undefined {
    // A scripted effect's body holds effects and, inside `limit`, triggers, so
    // the effect walk falls back to the trigger table.
    return registry === "trigger"
      ? this.tables.triggers.get(key)
      : (this.tables.effects.get(key) ?? this.tables.triggers.get(key));
  }
}

export interface Sources {
  readonly trigger: readonly Definition[];
  readonly effect: readonly Definition[];
}

function index(definitions: readonly Definition[]): ReadonlyMap<string, Definition> {
  return new Map(definitions.map((definition) => [definition.name.toLowerCase(), definition]));
}

/**
 * Both registries are walked by one walker, because a scripted effect's `limit`
 * blocks call scripted triggers and resolving those is worth more than keeping
 * the two runs independent — 59 effect definitions lost their whole narrowing
 * to `is_machine_empire` alone before this.
 */
export function inferScopes(tables: ScopeTables, sources: Sources): Record<Registry, Inferred[]> {
  const walker = new Walker(tables, {
    trigger: index(sources.trigger),
    effect: index(sources.effect),
  });
  return {
    trigger: sources.trigger.map((definition) => walker.infer(definition, "trigger")),
    effect: sources.effect.map((definition) => walker.infer(definition, "effect")),
  };
}
