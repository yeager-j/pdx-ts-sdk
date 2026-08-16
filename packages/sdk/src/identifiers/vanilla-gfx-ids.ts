/**
 * The packaged vanilla ids for the mint-shaped registries: the SDK's one
 * runtime read of `@pdx-ts/stellaris-ids/gfx-ids` (SDK-121, ADR-0006).
 *
 * These registries mint a name with no id segment between the mod prefix and
 * the logical name, so a minted name shares one flat namespace with vanilla's
 * own — `GFX_${prefix}_${name}` sits beside 9,198 vanilla `GFX_` names. SDK-121
 * refuses a minted name that provably collides with one of them, and this is
 * the evidence that refusal acts on. The types those same ids ship as cannot
 * serve: the collision is decided from a prefix and a name only known at build
 * time.
 *
 * The subpath, and the reasons for it, are `identifiers/vanilla-paths.ts`'s
 * exactly — the root export of a hard dependency must stay free of eager-load
 * work, so a large runtime table lives behind its own subpath and this module
 * is the SDK's only importer of it.
 *
 * `gfx-ids.ts` carries a `VANILLA_GFX_ID_GAME_VERSION` stamp that nothing here
 * reads yet. `checkVanillaPathInventoryConsistency` is the equivalent gate for
 * the path inventory, and giving this subpath one would mean a second public
 * error class, which is outside SDK-121. Meanwhile the committed-output gate
 * regenerates the whole package and byte-compares every file, so an
 * inconsistently generated package still fails there.
 */

import { VANILLA_GFX_IDS } from "@pdx-ts/stellaris-ids/gfx-ids";

import { immutableSet } from "../compiler/freeze.ts";

const cached = new Map<string, ReadonlySet<string>>();

/**
 * Every registry the package ships ids for, each behind a thunk that builds
 * the `Set` on first call and memoizes it.
 *
 * A data table rather than a function per registry: the fold looks a registry
 * up by the name on the item it is checking, and the registries covered are the
 * generator's to decide. A registry absent from this map has no packaged
 * evidence, which is a different answer from "has evidence, and the name is not
 * in it" — so the map is the check's first question, not a detail behind one.
 *
 * `immutableSet` (`compiler/freeze.ts`) rather than `Object.freeze(new Set())`
 * for the reason spelled out in `vanilla-paths.ts`: freezing a `Set` leaves
 * `.add` working, and these values are memoized process-wide.
 */
export const PACKAGED_ID_EVIDENCE: ReadonlyMap<string, () => ReadonlySet<string>> = new Map(
  Object.keys(VANILLA_GFX_IDS).map((registry) => [
    registry,
    (): ReadonlySet<string> => {
      const memoized = cached.get(registry);
      if (memoized !== undefined) {
        return memoized;
      }
      const built = immutableSet(VANILLA_GFX_IDS[registry] ?? []);
      cached.set(registry, built);
      return built;
    },
  ])
);
