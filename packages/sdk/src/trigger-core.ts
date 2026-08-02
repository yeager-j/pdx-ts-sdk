import type { PdxEntry } from "@pdx-ts/pdxscript";

import type { ContentRefUse } from "./content-refs.ts";
import type { ScopeName } from "./generated/scopes.ts";

declare const scopeBrand: unique symbol;

/**
 * A declarative in-game condition, valid in every scope named by S.
 *
 * Triggers are expression trees, not booleans: they describe a condition the
 * game engine evaluates long after this TypeScript has finished running.
 * The call signature exists purely to poison truthiness — `if (someTrigger)`
 * is a compile error, and calling the trigger throws.
 */
export interface Trigger<in S extends ScopeName = ScopeName> {
  (): never;
  readonly kind: "trigger";
  readonly entries: readonly PdxEntry[];
  /**
   * The content references this condition writes, recorded against the keys
   * that hold them. A trigger is a value that travels — into a content field,
   * an event option, an effect's `limit` — so it carries its own references
   * rather than expecting each splice site to rediscover them.
   */
  readonly refs: readonly ContentRefUse[];
  readonly [scopeBrand]: (scope: S) => void;
}

const POISON_MESSAGE =
  "A trigger is a description of an in-game condition, not a build-time boolean. " +
  "A plain TypeScript 'if' branches at BUILD time and cannot see game state. " +
  "Use the trigger where a condition block is expected (a technology's 'potential', " +
  "an effect's 'limit'), or for in-game branching inside an effect closure use " +
  "scope.if(trigger, (s) => ...).elseIf(...).else(...).";

export function trigger<S extends ScopeName>(
  entries: PdxEntry[],
  refs: readonly ContentRefUse[] = []
): Trigger<S> {
  return Object.assign(
    () => {
      throw new Error(POISON_MESSAGE);
    },
    { kind: "trigger", entries, refs } as const
  ) as unknown as Trigger<S>;
}
