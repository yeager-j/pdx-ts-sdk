/**
 * The declared half of the situation `target` contract.
 *
 * `links.cwt` gives the `target` link `output_scope = any`: a situation's
 * target is whatever `start_situation` passed, and the rules declare the
 * contract nowhere the SDK can read. What the corpus does show is that every
 * vanilla situation type is *consistent* about its target kind across all of
 * its start sites — so the author declares it once
 * (`targetScope: "country"` on `defineSituationType`; emits nothing) and
 * start sites are checked against the declaration. Navigation inside blocks
 * stays author-asserted (`situation.target<S>(...)` and the `target(...)`
 * trigger), since the definition object is not in scope there.
 */

import type { ScopeValue } from "./effect-core.ts";
import type { TypedRef } from "./generated/refs.ts";
import type { ScopeName } from "./generated/scopes.ts";

/** A defined situation type carrying its author-declared target scope. */
export interface SituationTargetContract<
  T extends ScopeName = ScopeName,
> extends TypedRef<"situation_type"> {
  readonly targetScope: T;
}

// The overload must merge into the interface that declares the generated
// signature — the cluster for `## scopes = { country }`, not `CountryScope`
// (a member redeclared on an extending interface must narrow, and this is an
// overload, not a narrowing). tests/codegen/events-snapshot.test.ts pins
// `startSituation` to this cluster so a clustering change fails loudly
// instead of silently detaching the overload.
declare module "./generated/effects.ts" {
  interface EffectsInCountry {
    /**
     * Starts a situation whose type declares `targetScope`, requiring a
     * matching target ref — `ctx.self`, an event target — as proof. The
     * generated string-typed signature remains for vanilla or third-party
     * situation ids.
     */
    startSituation<T extends ScopeName>(args: {
      type: SituationTargetContract<T>;
      target: ScopeValue<NoInfer<T>>;
      effect?: (scope: SituationScope) => void;
    }): void;
  }
}
