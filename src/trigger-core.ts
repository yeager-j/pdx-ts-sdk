import type { PdxEntry } from "./ast.ts";
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
  readonly [scopeBrand]: (scope: S) => void;
}

const POISON_MESSAGE =
  "A trigger is a description of an in-game condition, not a build-time boolean. " +
  "A plain TypeScript 'if' branches at BUILD time and cannot see game state. " +
  "Use the trigger where a condition block is expected (e.g. a technology's 'potential').";

export function trigger<S extends ScopeName>(entries: PdxEntry[]): Trigger<S> {
  return Object.assign(
    () => {
      throw new Error(POISON_MESSAGE);
    },
    { kind: "trigger", entries } as const
  ) as unknown as Trigger<S>;
}
