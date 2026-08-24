/**
 * Whole-mod layout inspection: every solar-system initializer a compiled mod
 * defines, inspected in one call.
 */

import type { PureMod } from "../compiler/model.ts";
import type { SolarSystemInitializerDef } from "../generated/solar-system-initializer.ts";
import { inspectSolarSystem, type SolarSystemInspection } from "./inspect.ts";

/**
 * Inspects every solar-system initializer in a compiled mod and returns the
 * inspections by full content id, in emission order. Pure and advisory, like
 * {@link inspectSolarSystem}; a mod with no solar systems returns an empty
 * map.
 *
 * @example
 * ```ts
 * const mod = await buildTheMod();
 * for (const [id, { diagnostics, svg }] of inspectSolarSystems(mod)) {
 *   await fs.writeFile(`previews/${id}.svg`, svg);
 *   diagnostics.forEach((finding) => console.log(id, finding.message));
 * }
 * ```
 */
export function inspectSolarSystems(mod: PureMod): ReadonlyMap<string, SolarSystemInspection> {
  const inspections = new Map<string, SolarSystemInspection>();
  for (const group of mod.definedGroups) {
    if (group.type !== "solar_system_initializer") {
      continue;
    }
    for (const defined of group.defined) {
      inspections.set(
        defined.id,
        inspectSolarSystem({
          itemKind: "content",
          type: "solar_system_initializer",
          id: defined.id,
          def: defined.def as SolarSystemInitializerDef,
        })
      );
    }
  }
  return inspections;
}
