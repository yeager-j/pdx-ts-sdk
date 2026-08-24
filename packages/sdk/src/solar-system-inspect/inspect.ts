/**
 * Layout inspection for solar-system initializers: structured diagnostics
 * plus a standalone SVG preview, computed from one shared geometry model.
 */

import type { SolarSystemInitializerItem } from "../generated/content-definers.ts";
import { diagnose, type SolarSystemDiagnostic } from "./diagnose.ts";
import { resolveSystem } from "./resolve.ts";
import { renderSvg } from "./svg.ts";

export type { SolarSystemDiagnostic, SolarSystemDiagnosticCode } from "./diagnose.ts";

/** Options for {@link inspectSolarSystem}. */
export interface InspectSolarSystemOptions {
  /**
   * Rendered width and height of the square SVG in pixels. Sets only the
   * outer `width`/`height` attributes; the drawing auto-fits through its
   * `viewBox`, so this never changes geometry or diagnostics. Must be a
   * positive integer. Default 800.
   */
  readonly svgSize?: number;
}

/** What {@link inspectSolarSystem} returns. */
export interface SolarSystemInspection {
  /**
   * Layout findings in document order. `warning` findings are visual-overlap
   * risks or unusable field values; `info` findings record idioms and
   * modeling limits. Nothing here reaches `mod.warnings` or fails a compile.
   */
  readonly diagnostics: readonly SolarSystemDiagnostic[];
  /**
   * A standalone, deterministic SVG document. It is a schematic of
   * orbit-cursor space: write it to an `.svg` file and open it in a browser,
   * where an inline script adds scroll-zoom, drag-pan, and double-click
   * reset. Embedded as an image the document stays a static picture.
   */
  readonly svg: string;
}

const DEFAULT_SVG_SIZE = 800;

/**
 * Inspects a defined solar-system initializer for layout problems and renders
 * an SVG preview of its geometry.
 *
 * The inspection understands cumulative `orbitDistance`/`orbitAngle` cursors,
 * nested planet and moon frames, `class: "none"` cursor advances, `count`
 * repetition, `{ min, max }` ranges, asteroid belts, and orbital lines.
 * Findings are advisory: the generated definition stays the canonical
 * legality model, and inspection never mutates the input.
 *
 * Distances are cursor units. The game separates bodies with size-based
 * spacing and renders sprites from entity assets, so body discs use a
 * documented approximation (`size` scaled by a constant, with assumed radii
 * for random or asset-dependent bodies); overlap findings are visual-overlap
 * risks, not exact sprite collisions. Ranged and random values resolve to
 * position sets, and script-value strings such as `"@var"` are reported as
 * unresolvable rather than guessed. Overlap checks between different nesting
 * frames apply only where both bodies have fully fixed positions; random
 * bearings are the vanilla norm, so a conservative cross-frame pass would
 * flag nearly every system.
 *
 * Throws `TypeError` when `initializer` is not a defined solar-system
 * initializer and `RangeError` for an invalid `svgSize`.
 *
 * @example
 * ```ts
 * const system = mod.solarSystemInitializer("haven", {
 *   class: "sc_g",
 *   planet: [
 *     { class: "star", size: 25 },
 *     { class: "pc_continental", orbitDistance: 45, orbitAngle: 120, size: 18 },
 *   ],
 * });
 *
 * const { diagnostics, svg } = inspectSolarSystem(system);
 * for (const finding of diagnostics) {
 *   console.log(finding.severity, finding.code, finding.message);
 * }
 * await fs.writeFile("haven.svg", svg);
 * ```
 */
export function inspectSolarSystem(
  initializer: SolarSystemInitializerItem,
  options?: InspectSolarSystemOptions
): SolarSystemInspection {
  if (
    typeof initializer !== "object" ||
    initializer === null ||
    initializer.itemKind !== "content" ||
    initializer.type !== "solar_system_initializer" ||
    typeof initializer.def !== "object"
  ) {
    throw new TypeError("inspectSolarSystem requires a defined solar-system initializer item");
  }
  const svgSize = options?.svgSize ?? DEFAULT_SVG_SIZE;
  if (!Number.isInteger(svgSize) || svgSize <= 0) {
    throw new RangeError("svgSize must be a positive integer");
  }

  const system = resolveSystem(initializer.def);
  const diagnostics = diagnose(system);
  const svg = renderSvg(system, diagnostics, svgSize);
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic))),
    svg,
  });
}
