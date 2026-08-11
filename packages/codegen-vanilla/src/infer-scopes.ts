/**
 * Infers the scopes a vanilla scripted trigger or effect is legal in, by
 * intersecting the scopes the CWT rules already declare for the primitives its
 * body evaluates.
 *
 * This is not the body inference originally rejected for this package. That was heuristics over what a body *means*; this reads only what
 * the rules already say about where each key is *legal*, and every key the
 * rules do not cover contributes nothing rather than a guess. The analysis can
 * therefore be too wide — which is exactly the `Trigger<ScopeName>` the SDK
 * would otherwise emit — but a narrowing it produces is a consequence of the
 * rules, not an opinion about the script.
 *
 * Soundness rests on five rules, each of which is a way to *avoid* narrowing:
 *
 * - **`OR` unions, everything else intersects.** Vanilla deliberately writes
 *   dual-scope triggers as `OR` arms that are simply false in the other scope.
 *   Intersecting those yields the empty set; unioning them yields the truth.
 * - **A pushed scope contributes nothing to the enclosing one.** Conditions
 *   inside `owner = { ... }` or `any_owned_planet = { ... }` constrain the
 *   pushed scope. Only the link or iterator key itself constrains the caller.
 * - **`[[FLAG] ... ]` blocks contribute nothing.** The block may be absent at
 *   the call site, so its conditions are not the definition's.
 * - **A `$PARAM$` in key position, a caller-relative path, and any key the
 *   rules do not cover contribute nothing.**
 * - **An empty result falls back to unconstrained.** ∅ means either a genuine
 *   dual-scope definition or an analysis that lost the thread; neither is a
 *   claim worth making.
 *
 * Measured against a real 4.4.6 install this narrows 90% of scripted triggers
 * and 63% of scripted effects. The standing gate checks 4,860 direct call
 * sites across 9,856 known-scope events, reaching 894 of 3,275 definitions
 * (27%), and finds no contradiction in that structural slice. It leaves 81%
 * of narrowed trigger claims and 66% of narrowed effect claims unfalsified;
 * definitions using clause-bearing effect rules require manual review because
 * the event-body walk cannot see those calls.
 */

import type { RuleFact, RuleScopes, ScopeFacts } from "@pdx-ts/codegen-cwt/scope-facts";
import type { PdxItem, PdxValue } from "@pdx-ts/pdxscript";

import type { ScriptedDefinition } from "./read-scripted.ts";

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
 * `prev` is the caller's previous scope, `root`/`from` its entry points,
 * `event_target:`/`this` are saved or ambient. A body that navigates through
 * one of these says nothing about where the definition itself is legal.
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

export type ScriptedKind = "trigger" | "effect";

/** Why a definition ended up unconstrained, or less narrow than it might be. */
export interface ScopeDiagnostic {
  readonly kind: "unknown-key" | "parameter-key" | "param-block" | "caller-relative" | "emptied";
  readonly detail: string;
}

export interface InferredScope {
  readonly name: string;
  readonly scopes: RuleScopes;
  readonly diagnostics: readonly ScopeDiagnostic[];
}

// ---------------------------------------------------------------------------
// Scope-set algebra. `"universal"` is the intersection identity and the union
// absorber — the two properties that make "unknown" safe.
// ---------------------------------------------------------------------------

export function intersectScopes(left: RuleScopes, right: RuleScopes): RuleScopes {
  if (left === "universal") {
    return right;
  }
  if (right === "universal") {
    return left;
  }
  return left.filter((scope) => right.includes(scope));
}

export function unionScopes(left: RuleScopes, right: RuleScopes): RuleScopes {
  if (left === "universal" || right === "universal") {
    return "universal";
  }
  return [...new Set([...left, ...right])].sort();
}

// ---------------------------------------------------------------------------

function itemsOf(value: PdxValue): readonly PdxItem[] | null {
  return value.kind === "container" ? value.items : null;
}

class Walker {
  private readonly memo = new Map<string, RuleScopes>();
  private readonly active = new Set<string>();
  private diagnostics: ScopeDiagnostic[] = [];
  private cycles = 0;

  private readonly facts: ScopeFacts;
  private readonly definitions: Readonly<
    Record<ScriptedKind, ReadonlyMap<string, ScriptedDefinition>>
  >;

  constructor(
    facts: ScopeFacts,
    definitions: Readonly<Record<ScriptedKind, ReadonlyMap<string, ScriptedDefinition>>>
  ) {
    this.facts = facts;
    this.definitions = definitions;
  }

  infer(definition: ScriptedDefinition, kind: ScriptedKind): InferredScope {
    this.diagnostics = [];
    const scopes = this.scopesOf(definition, kind);
    return { name: definition.name, scopes, diagnostics: this.diagnostics };
  }

  private scopesOf(definition: ScriptedDefinition, kind: ScriptedKind): RuleScopes {
    const key = `${kind}:${definition.name.toLowerCase()}`;
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
    const body = this.walkBody(definition.body, true, kind);
    this.active.delete(key);
    const emptied = body !== "universal" && body.length === 0;
    if (emptied) {
      this.note("emptied", definition.name);
    }
    const scopes = emptied ? "universal" : body;
    // A result computed across a broken cycle depends on the entry point, so it
    // is answered but not remembered — otherwise the emitted scope would depend
    // on generation order, which nothing about this output may.
    if (this.cycles === before) {
      this.memo.set(key, scopes);
    }
    return scopes;
  }

  private note(kind: ScopeDiagnostic["kind"], detail: string): void {
    this.diagnostics.push({ kind, detail });
  }

  /**
   * A body is an implicit AND of its statements. `applies` is false when the
   * statements run in a pushed scope — they are still walked, so their unknown
   * keys are reported, but they cannot constrain the caller.
   */
  private walkBody(items: readonly PdxItem[], applies: boolean, kind: ScriptedKind): RuleScopes {
    let scopes: RuleScopes = "universal";
    for (const item of items) {
      scopes = intersectScopes(scopes, this.walkItem(item, applies, kind));
    }
    return scopes;
  }

  private walkItem(item: PdxItem, applies: boolean, kind: ScriptedKind): RuleScopes {
    switch (item.kind) {
      case "entry":
        return this.walkEntry(item.key, item.value, applies, kind);
      case "param":
        // `[[FLAG] ... ]` — present only when the caller defines FLAG, so its
        // conditions are the call site's, not the definition's. Walked for
        // diagnostics with `applies: false`, never for constraint.
        this.note("param-block", item.name);
        this.walkBody(item.items, false, kind);
        return "universal";
      default:
        return "universal";
    }
  }

  private walkEntry(
    rawKey: string,
    value: PdxValue,
    applies: boolean,
    kind: ScriptedKind
  ): RuleScopes {
    const key = rawKey.toLowerCase();
    const children = itemsOf(value);

    if (rawKey.includes("$")) {
      // A `$PARAM$` substitution in key position. Nothing is known about what
      // the key will be.
      this.note("parameter-key", rawKey);
      return "universal";
    }
    if (INTERSECTING.has(key)) {
      return children === null ? "universal" : this.walkBody(children, applies, kind);
    }
    if (UNIONING.has(key)) {
      if (children === null) {
        return "universal";
      }
      // Each arm is one statement. A definition is legal in a scope as long as
      // one arm is, so the arms union rather than intersect. This is the rule
      // that keeps deliberately dual-scope triggers from emptying.
      let arms: RuleScopes = [];
      for (const child of children) {
        arms = unionScopes(arms, this.walkItem(child, applies, kind));
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

    const link = this.facts.links.get(first);
    if (link !== undefined) {
      if (children !== null && first === key) {
        this.walkBody(children, false, kind);
      }
      return applies ? link.inputScopes : "universal";
    }

    const own = this.definitions[kind].get(key);
    const nested = own ?? this.definitions.trigger.get(key);
    if (nested !== undefined) {
      // A scripted effect's body reaches scripted triggers through its `limit`
      // blocks, so the lookup crosses kinds — and the callee is walked
      // under ITS own kind, not the caller's.
      const scopes = this.scopesOf(nested, own === undefined ? "trigger" : kind);
      return applies ? scopes : "universal";
    }

    const rule = this.ruleFor(key, kind);
    if (rule !== undefined) {
      const declared = applies ? rule.scopes : "universal";
      return children === null
        ? declared
        : intersectScopes(declared, this.walkRuleBody(rule, children, applies, kind));
    }

    this.note("unknown-key", rawKey);
    return "universal";
  }

  /**
   * The interior of a known block rule. Only clause fields hold conditions;
   * everything else is an argument and is ignored rather than reported as an
   * unknown key. A clause that runs in the enclosing scope still constrains it —
   * that is what makes `custom_tooltip` and `if`'s `limit` transparent.
   */
  private walkRuleBody(
    rule: RuleFact,
    children: readonly PdxItem[],
    applies: boolean,
    kind: ScriptedKind
  ): RuleScopes {
    let scopes: RuleScopes = "universal";
    for (const child of children) {
      const name = child.kind === "entry" ? child.key.toLowerCase() : null;
      const clause = name === null ? undefined : rule.clauses.get(name);
      if (clause !== undefined) {
        const items = child.kind === "entry" ? itemsOf(child.value) : null;
        if (items !== null) {
          scopes = intersectScopes(scopes, this.walkBody(items, applies && clause === null, kind));
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
      scopes = intersectScopes(
        scopes,
        this.walkItem(child, applies && rule.splice.scope === null, kind)
      );
    }
    return scopes;
  }

  private ruleFor(key: string, kind: ScriptedKind): RuleFact | undefined {
    // A scripted effect's body holds effects and, inside `limit`, triggers, so
    // the effect walk falls back to the trigger table.
    return kind === "trigger"
      ? this.facts.triggers.get(key)
      : (this.facts.effects.get(key) ?? this.facts.triggers.get(key));
  }
}

function index(
  definitions: readonly ScriptedDefinition[]
): ReadonlyMap<string, ScriptedDefinition> {
  return new Map(definitions.map((definition) => [definition.name.toLowerCase(), definition]));
}

/**
 * Both registries are walked by one walker, because a scripted effect's `limit`
 * blocks call scripted triggers and resolving those is worth more than keeping
 * the two runs independent — 59 effect definitions lost their whole narrowing
 * to `is_machine_empire` alone before this.
 */
export function inferScopes(
  facts: ScopeFacts,
  sources: Readonly<Record<ScriptedKind, readonly ScriptedDefinition[]>>
): Record<ScriptedKind, InferredScope[]> {
  const walker = new Walker(facts, {
    trigger: index(sources.trigger),
    effect: index(sources.effect),
  });
  return {
    trigger: sources.trigger.map((definition) => walker.infer(definition, "trigger")),
    effect: sources.effect.map((definition) => walker.infer(definition, "effect")),
  };
}
