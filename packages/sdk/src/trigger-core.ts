import { block, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ContentRefUse } from "./content-refs.ts";
import type { ScopeName } from "./generated/scopes.ts";

declare const scopeBrand: unique symbol;

/**
 * What the poison call signature "returns". Nothing produces one and nothing
 * accepts one — calling a trigger throws.
 *
 * Deliberately not `never`, which is assignable to every type and so made
 * every trigger a structurally valid closure: `Trigger<"planet">` is `() =>
 * never`, which satisfies any `(...args) => Trigger<"country">`. That defeated
 * scope checking on every field whose type admits a closure returning a
 * trigger — a wrong-scope condition passed as the closure instead.
 */
export interface TriggerNotCalled {
  readonly [triggerNotCalled]: true;
}

declare const triggerNotCalled: unique symbol;

/**
 * A declarative in-game condition, valid in every scope named by S.
 *
 * Triggers are expression trees, not booleans: they describe a condition the
 * game engine evaluates long after this TypeScript has finished running.
 * The call signature exists purely to poison truthiness — `if (someTrigger)`
 * is a compile error, and calling the trigger throws.
 */
export interface Trigger<S extends ScopeName = ScopeName> {
  (): TriggerNotCalled;
  readonly kind: "trigger";
  readonly entries: readonly PdxEntry[];
  /**
   * The content references this condition writes, recorded against the keys
   * that hold them. A trigger is a value that travels — into a content field,
   * an event option, an effect's `limit` — so it carries its own references
   * rather than expecting each splice site to rediscover them.
   */
  readonly refs: readonly ContentRefUse[];
  /**
   * Fluent conjunction: `a.and(b, c)` builds the same tree `and(a, b, c)`
   * does (`./triggers.ts`) — declarative, not mutating. `a`, `b`, and `c` are
   * unchanged; the method returns a new `Trigger` and records nothing on its
   * own, the same as every other combinator.
   */
  and(this: Trigger<S>, ...others: readonly Trigger<S>[]): Trigger<S>;
  readonly [scopeBrand]: (scope: S) => void;
}

const POISON_MESSAGE =
  "A trigger is a description of an in-game condition, not a build-time boolean. " +
  "A plain TypeScript 'if' branches at BUILD time and cannot see game state. " +
  "Use the trigger where a condition block is expected (a technology's 'potential', " +
  "an effect's 'limit'), or for in-game branching inside an effect closure use " +
  "scope.if(trigger, (s) => ...).elseIf(...).else(...).";

/**
 * The conjunction tree every `and`-shaped combinator builds: an `AND` block
 * wrapping every operand's entries, in argument order. `./triggers.ts`
 * exports this same shape as the free `and()` function; `trigger()` wires it
 * to every value's `.and()` method so the two spellings never drift apart.
 */
export function conjoin<S extends ScopeName>(operands: readonly Trigger<S>[]): Trigger<S> {
  return trigger(
    [
      block(
        "AND",
        operands.flatMap((operand) => [...operand.entries])
      ),
    ],
    operands.flatMap((operand) => [...operand.refs])
  );
}

export function trigger<S extends ScopeName>(
  entries: PdxEntry[],
  refs: readonly ContentRefUse[] = []
): Trigger<S> {
  return Object.assign(
    () => {
      throw new Error(POISON_MESSAGE);
    },
    {
      kind: "trigger",
      entries,
      refs,
      and(this: Trigger<S>, ...others: readonly Trigger<S>[]): Trigger<S> {
        return conjoin([this, ...others]);
      },
    } as const
  ) as unknown as Trigger<S>;
}
