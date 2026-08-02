/**
 * Hand-written stand-ins for the generated scope interfaces.
 *
 * The real slice generates one interface per scope (38 of them) from the
 * rules; the probe writes two — country and planet — plus the universal base,
 * covering every structural effect shape: no-arg, single value, options
 * object, scope-push iterator, mixed weight/effect block (`random_list`),
 * in-game branching (`if`), loops (`while`), event fires with the FROM
 * contract, and scope navigation (`within`).
 *
 * Everything here is types; the runtime behind every method is the one
 * recorder in effect-core.ts.
 */

import type { DepositRef, StaticModifierRef } from "../../packages/sdk/src/generated/refs.ts";
import type { ScopeName } from "../../packages/sdk/src/generated/scopes.ts";
import type { CountryFlag } from "../../packages/sdk/src/generated/value-sets.ts";
import type { Trigger } from "../../packages/sdk/src/trigger-core.ts";
import type { EventRef, EventTarget, IfChain, Modifier, ScopeRef } from "./effect-core.ts";

/** The scopes the probe models. The full slice maps all 38. */
export interface ScopeMap {
  country: CountryScope;
  planet: PlanetScope;
}

export type KnownScope = keyof ScopeMap;

export type ScopeObjOf<S extends KnownScope> = ScopeMap[S];

/** One arm of a `random_list`: trigger-ish parts as data, effects as a closure. */
export interface RandomListArm<S extends KnownScope> {
  readonly weight: number;
  readonly modifiers?: readonly Modifier<S>[];
  readonly do: (scope: ScopeObjOf<S>) => void;
}

/**
 * Effects valid in every scope, plus the structural forms (`if`, `within`,
 * `randomList`, `whileLoop`) that are control flow rather than effects.
 */
export interface UniversalEffects<S extends KnownScope> {
  /** Prints a message to game.log for debugging purposes. */
  log(message: string): void;

  /**
   * Saves the current scope under the target's name. The target's declared
   * scope must match the scope being saved — reads stay safe because saves
   * are checked.
   */
  saveEventTargetAs(target: EventTarget<S>): void;

  /**
   * In-game branching: `if = { limit = { ... } ... }`. This is the in-game
   * counterpart of a TypeScript `if`, which branches at build time. Chain
   * `.elseIf(...)` and `.else(...)` before recording any further effects.
   */
  if(condition: Trigger<S>, body: (scope: ScopeObjOf<S>) => void): IfChain<S>;

  /** Opens a saved target / FROM ref as a block and records inside it. */
  within<S2 extends KnownScope>(ref: ScopeRef<S2>, body: (scope: ScopeObjOf<S2>) => void): void;

  /** Picks one arm at random, weighted; modifiers adjust weights in-game. */
  randomList(arms: ReadonlyArray<RandomListArm<S>>): void;

  /** `while = { count/limit ... }` — in-game iteration. */
  whileLoop(
    args: { count?: number; limit?: Trigger<S> },
    body: (scope: ScopeObjOf<S>) => void
  ): void;
}

export interface CountryScope extends UniversalEffects<"country"> {
  /** Adds a resource to the country's stockpile: `add_resource = { energy = 50 }`. */
  addResource(args: { resource: string; amount: number; mult?: number }): void;

  setCountryFlag(flag: CountryFlag): void;

  /**
   * Iterates the country's owned planets; the closure records planet-scoped
   * effects, and `limit` is evaluated per planet.
   */
  everyOwnedPlanet(args: { limit?: Trigger<"planet"> }, body: (planet: PlanetScope) => void): void;

  /** Fires a country event with no declared FROM. */
  countryEvent(args: { id: EventRef<"country", undefined>; days?: number; random?: number }): void;
  /**
   * Fires a country event that declared `from: F`. The `from` witness proves
   * the contract: pass `ctx.self` when this event's own scope is the FROM the
   * target expects, or another ref to emit the game's `scopes = { from = ... }`
   * override.
   */
  countryEvent<F extends ScopeName>(args: {
    id: EventRef<"country", F>;
    // NoInfer: F comes from the event ref alone; otherwise TS unions the two
    // inference sites and a wrong-scope witness still unifies.
    from: ScopeRef<NoInfer<F>>;
    days?: number;
    random?: number;
  }): void;
}

export interface PlanetScope extends UniversalEffects<"planet"> {
  /** Adds a resource deposit to the planet. */
  addDeposit(deposit: DepositRef | string): void;

  /** Destroys the colony on the planet. */
  destroyColony(): void;

  /** Adds a static modifier: `add_modifier = { modifier = x days = 360 }`. */
  addModifier(args: { modifier: StaticModifierRef | string; days?: number }): void;

  /** Fires a planet event with no declared FROM. */
  planetEvent(args: { id: EventRef<"planet", undefined>; days?: number; random?: number }): void;
  /** Fires a planet event that declared `from: F`; see CountryScope.countryEvent. */
  planetEvent<F extends ScopeName>(args: {
    id: EventRef<"planet", F>;
    from: ScopeRef<NoInfer<F>>;
    days?: number;
    random?: number;
  }): void;
}
