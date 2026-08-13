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
 * own scope, which `eventScope` already states (SDK-116), and the location
 * reaches them as FROMFROM, which the SDK cannot name at all.
 */

import type { EnableSpecialProjectArgs } from "../../generated/effects.ts";
import type { SpecialProjectLocationScope } from "../../generated/special-project.ts";
import type { TypedRef } from "../scalar.ts";
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
     * read as `ctx.from`. `location` is required here where the generated
     * signature leaves it optional: a declared FROM that the call site never
     * passes is a FROM the callbacks read and the game does not supply.
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
        name: SpecialProjectLocationContract<L>;
        location: ScopeValue<NoInfer<L>>;
      }
    ): void;
  }
}
