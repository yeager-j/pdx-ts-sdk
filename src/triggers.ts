import { block, cmp, kv, type PdxEntry, type PdxOp } from "./ast.ts";
import type { TechRef } from "./tech.ts";

export type ScopeName = "country" | "planet" | "system" | "leader";

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

// Universal triggers — valid in every scope.

export function always(value: boolean): Trigger {
  return trigger([kv("always", value)]);
}

export function hasGlobalFlag(flag: string): Trigger {
  return trigger([kv("has_global_flag", flag)]);
}

export function yearsPassed(op: PdxOp, years: number): Trigger {
  return trigger([cmp("years_passed", op, years)]);
}

// Country-scope triggers.

export function hasCountryFlag(flag: string): Trigger<"country"> {
  return trigger([kv("has_country_flag", flag)]);
}

export function isAi(): Trigger<"country"> {
  return trigger([kv("is_ai", true)]);
}

export function hasTechnology(tech: TechRef | string): Trigger<"country"> {
  const id = typeof tech === "string" ? tech : tech.id;
  return trigger([kv("has_technology", id)]);
}

// Planet-scope triggers.

export function hasPlanetFlag(flag: string): Trigger<"planet"> {
  return trigger([kv("has_planet_flag", flag)]);
}

// Scope-changing triggers.

export function anyCountry(condition: Trigger<"country">): Trigger {
  return trigger([block("any_country", [...condition.entries])]);
}

// Combinators.

export function and<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger([
    block(
      "AND",
      triggers.flatMap((t) => [...t.entries])
    ),
  ]);
}

export function or<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger([
    block(
      "OR",
      triggers.flatMap((t) => [...t.entries])
    ),
  ]);
}

export function not<S extends ScopeName>(condition: Trigger<S>): Trigger<S> {
  return trigger([block("NOT", [...condition.entries])]);
}
