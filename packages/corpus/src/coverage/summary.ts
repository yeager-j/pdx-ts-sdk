/**
 * The percentages: per surface, over every registry, and overall, each
 * against two denominators.
 *
 * `declared` counts sites. `used` weights each site by its vanilla
 * occurrence count, so a site vanilla never writes weighs zero. Removed sites
 * are listed but excluded from both. The overall `used` figure mixes key
 * occurrences (script surfaces) with definition counts (registries); it is
 * printed with that caveat and never normalized.
 */

import { compareUtf8 } from "@pdx-ts/sdk/internals";

import {
  COVERAGE_CLASSES,
  EXPRESSIBLE_CLASSES,
  type CoverageClass,
  type CoverageSite,
  type CoverageSurface,
  type CoverageSurfaceId,
} from "./model.ts";

/** Site count per class. The counts sum to the surface's site count. */
export type CoverageCounts = Readonly<Record<CoverageClass, number>>;

/** One row of the report's table. */
export interface CoverageSummary {
  /** The row's printed name. */
  readonly label: string;
  /** Every site, removed ones included. */
  readonly sites: number;
  /** How many sites hold each class. */
  readonly counts: CoverageCounts;
  /** Expressible sites over non-removed sites, in [0, 1]; `null` when there are none. */
  readonly declared: number | null;
  /** The same ratio weighted by `used`; `null` when nothing is used. */
  readonly used: number | null;
}

/** One surface's row and the sites an author cannot write. */
export interface SurfaceCoverage {
  /** The surface's table row. */
  readonly summary: CoverageSummary;
  /** Sites outside the expressible classes, by `used` descending then key. */
  readonly remainder: readonly CoverageSite[];
}

/** Surfaces folded into one table row, each keeping its own remainder. */
export interface SurfaceGroup {
  /** The folded row, labelled by the group name. */
  readonly summary: CoverageSummary;
  /** The members, by label. */
  readonly surfaces: readonly SurfaceCoverage[];
}

/** The whole report, in print order. */
export interface CoverageReport {
  /** Script surfaces in fixed order, then ungrouped registries by label. */
  readonly surfaces: readonly SurfaceCoverage[];
  /** Grouped registry surfaces, by group name; printed after {@link CoverageReport.surfaces}. */
  readonly groups: readonly SurfaceGroup[];
  /** Every registry surface as one row, grouped ones included. */
  readonly registries: CoverageSummary;
  /** Every surface as one row. */
  readonly overall: CoverageSummary;
}

const SCRIPT_SURFACE_ORDER: readonly CoverageSurfaceId[] = [
  "triggers",
  "effects",
  "modifiers",
  "scope-links",
  "event-fields",
];

function isRegistry(surface: CoverageSurface): boolean {
  return surface.id.startsWith("registry:");
}

function summaryOf(label: string, sites: readonly CoverageSite[]): CoverageSummary {
  const counts = Object.fromEntries(COVERAGE_CLASSES.map((cls) => [cls, 0])) as Record<
    CoverageClass,
    number
  >;
  let declaredTotal = 0;
  let declaredCovered = 0;
  let usedTotal = 0;
  let usedCovered = 0;
  for (const site of sites) {
    counts[site.class] += 1;
    if (site.class === "removed") {
      continue;
    }
    declaredTotal += 1;
    usedTotal += site.used;
    if (EXPRESSIBLE_CLASSES.has(site.class)) {
      declaredCovered += 1;
      usedCovered += site.used;
    }
  }
  return {
    label,
    sites: sites.length,
    counts,
    declared: declaredTotal === 0 ? null : declaredCovered / declaredTotal,
    used: usedTotal === 0 ? null : usedCovered / usedTotal,
  };
}

function remainderOf(sites: readonly CoverageSite[]): CoverageSite[] {
  return sites
    .filter((site) => !EXPRESSIBLE_CLASSES.has(site.class))
    .sort((a, b) => b.used - a.used || compareUtf8(a.key, b.key));
}

/**
 * Orders the surfaces and computes every row.
 *
 * @throws {Error} When two surfaces share an id.
 */
export function summarizeCoverage(surfaces: readonly CoverageSurface[]): CoverageReport {
  const ids = new Set<string>();
  for (const surface of surfaces) {
    if (ids.has(surface.id)) {
      throw new Error(`surface ${surface.id} is given twice`);
    }
    ids.add(surface.id);
  }
  const scriptSurfaces = SCRIPT_SURFACE_ORDER.flatMap((id) =>
    surfaces.filter((surface) => surface.id === id)
  );
  const registrySurfaces = surfaces
    .filter(isRegistry)
    .sort((a, b) => compareUtf8(a.label, b.label));
  const ownRow = [...scriptSurfaces, ...registrySurfaces.filter((s) => s.group === undefined)];
  const coverageOf = (surface: CoverageSurface): SurfaceCoverage => ({
    summary: summaryOf(surface.label, surface.sites),
    remainder: remainderOf(surface.sites),
  });
  const groupNames = [
    ...new Set(registrySurfaces.flatMap((s) => (s.group === undefined ? [] : [s.group]))),
  ].sort(compareUtf8);
  return {
    surfaces: ownRow.map(coverageOf),
    groups: groupNames.map((group) => {
      const members = registrySurfaces.filter((s) => s.group === group);
      return {
        summary: summaryOf(
          group,
          members.flatMap((s) => s.sites)
        ),
        surfaces: members.map(coverageOf),
      };
    }),
    registries: summaryOf(
      "registries (all)",
      registrySurfaces.flatMap((surface) => surface.sites)
    ),
    overall: summaryOf(
      "overall",
      [...scriptSurfaces, ...registrySurfaces].flatMap((surface) => surface.sites)
    ),
  };
}
