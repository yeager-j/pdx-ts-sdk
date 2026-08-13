/**
 * The declared half of the situation `target` contract.
 *
 * `links.cwt` gives the `target` link `output_scope = any`: a situation's
 * target is whatever `start_situation` passed, and the rules declare the
 * contract nowhere the SDK can read. What the corpus does show is that every
 * vanilla situation type is *consistent* about its target kind across all of
 * its start sites — so the author declares it once
 * (`targetScope: "country"` on `defineSituationType`; emits nothing) and
 * start sites are checked against the declaration.
 *
 * Navigation inside a trigger field (the `target(...)` combinator in
 * `../triggers.ts`), and the bare-word value form on that same symbol
 * (`target()`, what a situation event's `location = target` writes), both stay
 * author-asserted, since neither has a definition object to read a declared
 * scope from. Inside a `startSituation` effect body the type is
 * already known, though — `args.type: SituationTargetContract<T>` carries it
 * — so `SituationEffectScope` below narrows `.target(...)` to that same `T`,
 * closing the one restatement this contract *can* close.
 */

import type { ScopeObjOf, SituationScope } from "../../generated/effects.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { TypedRef } from "../scalar.ts";
import type { Unambiguous } from "./contracts.ts";
import type { ScopeValue } from "./types.ts";

/** A defined situation type carrying its author-declared target scope. */
export interface SituationTargetContract<
  T extends ScopeName = ScopeName,
> extends TypedRef<"situation_type"> {
  readonly targetScope: T;
}

/**
 * A `startSituation` effect body's scope: an ordinary `SituationScope`, but
 * with `.target(...)` narrowed to the `T` the call site's `type:
 * SituationTargetContract<T>` already declared — so the body needs no second
 * `<T>` to open it, the way every other use of `.target` still does. Local to
 * this one call site; `SituationScope` itself, and every other situation
 * effect body's type, are untouched.
 *
 * `Omit` first and intersect rather than `extends`: `target`'s generic base
 * signature `<S2>(body: (scope: ScopeObjOf<S2>) => void) => void` is not a
 * valid override target for a concrete `(body: (scope: ScopeObjOf<T>) =>
 * void) => void` (TS2430 — a caller could still instantiate `S2` to
 * something other than `T`), so this drops the wide member before adding the
 * narrow one instead of trying to override it.
 */
export type SituationEffectScope<T extends ScopeName> = Omit<SituationScope, "target"> & {
  /** Opens the situation's declared target scope: `target = { ... }`. */
  target(body: (scope: ScopeObjOf<T>) => void): void;
};

// Codegen attaches this stable extension seam to whichever generated cluster
// owns start_situation. The hand-written overload therefore follows the CWT
// scope contract without naming a cluster whose identity may change.
declare module "../../generated/effects.ts" {
  interface StartSituationEffectsExtension {
    /**
     * Starts a situation whose type declares `targetScope`, requiring a
     * matching target ref — `ctx.self`, an event target — as proof, and
     * typing the effect body's scope from it. The generated signature remains
     * beneath this one for vanilla or third-party situation ids, which declare
     * no contract to check against; the overlay's
     * `EFFECT_FIELD_TYPE_OVERRIDES` row for `start_situation.type` refuses a
     * `targetScope`-bearing ref there, so a declared contract can only ever be
     * accepted by this overload — which is what keeps a mismatched target a
     * compile error rather than a fall-through.
     */
    startSituation<T extends ScopeName>(args: {
      type: Unambiguous<T, SituationTargetContract<T>>;
      target: ScopeValue<NoInfer<T>>;
      effect?: (scope: SituationEffectScope<T>) => void;
    }): void;
  }
}
