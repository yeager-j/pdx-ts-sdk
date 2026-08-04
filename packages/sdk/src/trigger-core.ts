import { varRef, type PdxEntry, type PdxScalar } from "@pdx-ts/pdxscript";

import type { ContentRefUse } from "./content-refs.ts";
import type { ScopeName } from "./generated/scopes.ts";

declare const scopeBrand: unique symbol;
declare const scriptValueBrand: unique symbol;

/**
 * A numeric expression the game evaluates rather than a literal this build
 * reads: a scripted variable's name, a `scope.variable` path, or
 * `value:<script_value>` / `trigger:<name>` (1 or 0). CWT calls the field
 * type `value_field` (or `int_value_field` for the integer-only arm) and
 * distinguishes it from a plain `float`/`int` — a distinction the lowering
 * used to erase, typing every one of them `number` and making the other
 * three forms unwritable.
 *
 * The brand is optional, the same soft brand `ValueSetMember` uses: script
 * value and scripted trigger names are open sets no rule file enumerates, so
 * a raw string still assigns. `number` is the other arm of every
 * `ScriptValue` field, so a plain float call site is unaffected — the
 * brand only ever adds a form, never removes one.
 */
export type ScriptValue = number | (string & { readonly [scriptValueBrand]?: true });

/**
 * Lowers an authored `ScriptValue` to what the PDXScript AST accepts.
 *
 * A number, a `value:<script_value>`/`trigger:<name>` form, or a bare
 * `scope.variable` path all already write bare as an unquoted string scalar:
 * pdxscript's serializer only quotes a `str` node when writing it bare would
 * re-parse as something else (a bool, a number, or — this is the case that
 * matters here — a `var`). A `@name` scripted-variable reference *is* that
 * "something else": passed through as a plain string it would be quoted
 * defensively (`base = "@my_value"`), which the game reads as a literal
 * string rather than evaluating the variable. It has to become a `var` node
 * explicitly to write bare as `@my_value` — see `GRAMMAR.md`'s note on `str`
 * vs `var`, and `packages/pdxscript` stays syntax-only, so this conversion
 * belongs here on the authoring side, not in the serializer's classification.
 */
export function scriptValueScalar(value: ScriptValue): ScriptValue | PdxScalar {
  return typeof value === "string" && value.startsWith("@") ? varRef(value) : value;
}

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
export interface Trigger<in S extends ScopeName = ScopeName> {
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
