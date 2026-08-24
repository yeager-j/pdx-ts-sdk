/**
 * The declared half of the special-project location contract.
 *
 * A special project's success callbacks run with FROM = the `location` handed
 * to `enable_special_project`, and nothing on the definition decides which
 * scope that is: `effects.cwt` types the argument `scope_group[spatial_object]`
 * — fourteen scopes — and vanilla's own call sites pass planets, ships, fleets,
 * stars, starbases and ambient objects. The definition declares the one it is
 * written for (`locationScope: "planet"`, emits nothing) and the SDK holds both
 * ends to it: `ctx.from` in `onSuccess`, `onProgress25/50/75` and `onStart` is
 * that scope, and the `enableSpecialProject` calls below must pass a matching
 * location.
 *
 * The four country-scoped callbacks are unaffected. Their FROM is the project's
 * own scope, which `eventScope` already states (SDK-116). The generated
 * special-project overlay has not yet exposed the documented FROMFROM slot.
 */

import type { EnableSpecialProjectArgs } from "../../generated/effects.ts";
import type { SpecialProjectLocationScope } from "../../generated/special-project.ts";
import type { TypedRef } from "../scalar.ts";
import type { Unambiguous } from "./contracts.ts";
import type { ScopeValue } from "./types.ts";

/** A defined special project carrying its author-declared location scope. */
export interface SpecialProjectLocationContract<
  L extends SpecialProjectLocationScope = SpecialProjectLocationScope,
> extends TypedRef<"special_project"> {
  readonly locationScope: L;
}

// Codegen attaches this stable extension seam to whichever generated cluster
// owns enable_special_project, so the overload follows the CWT scope contract
// without naming a cluster whose identity may change.
declare module "../../generated/effects.ts" {
  interface EnableSpecialProjectEffectsExtension {
    /**
     * Enables a special project that declares `locationScope`, requiring a
     * location of the declared scope — the scope its success callbacks then
     * read as `ctx.from`.
     *
     * `location` is required here where the generated signature leaves it
     * optional, and that is a deliberate restriction rather than a reading of
     * the rules: an omitted `location` defaults to the calling scope
     * (`effects.log`: "ideally THIS (that is default)", and vanilla's
     * `from.planet.orbit = { enable_special_project = { name =
     * SHIELD_PRIMITIVE_PLANET_PROJECT } }` relies on it), which this seam
     * cannot see — `enable_special_project` is valid in every scope, so the
     * interface carrying this overload knows nothing about where the call
     * stands. Writing the location out is what makes the declaration checkable
     * at all. A project enabled the defaulting way declares no
     * `locationScope` and keeps the generated signature.
     *
     * A value that could be more than one project — the two arms of a ternary,
     * say — carries the union of their declarations and no single fact to
     * check, so `Unambiguous` rejects it here rather than accepting the arm
     * that happens to match the location passed.
     *
     * The generated signature remains beneath this one for vanilla or
     * third-party project ids and for projects that declare no location, none
     * of which carry a contract to check. The overlay's
     * `EFFECT_FIELD_TYPE_OVERRIDES` row for `enable_special_project.name`
     * refuses a `locationScope`-bearing ref there, so a declaration can only
     * ever be accepted by this overload — which is what keeps a contradicted
     * location a compile error rather than a fall-through.
     */
    enableSpecialProject<L extends SpecialProjectLocationScope>(
      args: Omit<EnableSpecialProjectArgs, "name" | "location"> & {
        name: Unambiguous<L, SpecialProjectLocationContract<L>>;
        location: ScopeValue<NoInfer<L>>;
      }
    ): void;
  }
}
