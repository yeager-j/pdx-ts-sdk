/**
 * Canonical geometry resolver for solar-system initializers. Internal to
 * `solar-system-inspect`: diagnostics and the SVG preview both read the
 * resolved model, and nothing here is part of the public surface.
 *
 * The model follows the game's three coordinate conventions: `orbitDistance`
 * and `orbitAngle` are cursor deltas accumulated across each sibling list,
 * `orbitalLine.orbitDistanceFromParent` is absolute from the owning center,
 * and `asteroidBelt.radius` is absolute from the system center.
 */

import type { MoonInitializerFields } from "../generated/moon-initializer.ts";
import type { PlanetInitializerFields } from "../generated/planet-initializer.ts";
import type { SolarSystemInitializerDef } from "../generated/solar-system-initializer.ts";
import { refId } from "../script/scalar.ts";
import type { ScriptValue } from "../script/trigger-core.ts";
import {
  absInterval,
  addSpans,
  angleRange,
  fixedAngle,
  FULL_SPAN,
  hull,
  hullSpans,
  point,
  ZERO_INTERVAL,
  type AngleSpan,
  type Interval,
} from "./interval.ts";

/**
 * Scale from gameplay `size` to the visual disc radius, in cursor units.
 * The game renders sprites from entity assets, not from `size`, so this is an
 * approximation tuned so the shipped vanilla initializers report no definite
 * overlap. A live-game oracle run can refine it without changing the
 * diagnostic contract.
 */
const SIZE_TO_VISUAL_RADIUS = 0.25;

/** Assumed visual disc radius per body kind when `size` is absent. */
const ASSUMED_VISUAL_RADIUS = {
  star: 6,
  planet: 3,
  moon: 0.75,
  asteroid: 0.5,
} as const;

/** Half the radial width of an asteroid-belt annulus, in cursor units. */
export const BELT_HALF_WIDTH = 10;

/** Ceiling on expanded copies of one repeated template. */
const MAX_EXPANDED_COPIES = 64;

/** What a resolved entry stands for. `cursor` is a `class: "none"` advance. */
export type BodyKind = "star" | "planet" | "moon" | "asteroid" | "cursor";

/** One fixed point in the system frame, in cursor units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One body (or cursor advance) with its resolved frame-local geometry. */
export interface ResolvedBody {
  /** Document-order position across the whole system. */
  readonly ordinal: number;
  /** Stable template path, e.g. `planet[1].moon[0]`. Copies share it. */
  readonly path: string;
  /** 0-based copy index from `count` expansion. */
  readonly copy: number;
  /** Expanded copy total for the template. */
  readonly copies: number;
  readonly kind: BodyKind;
  readonly name: string | undefined;
  readonly className: string | undefined;
  /** Identity of the sibling list this entry belongs to. */
  readonly listId: number;
  /** Expanded position within the list. */
  readonly indexInList: number;
  /** Relative-geometry segment within the list; sums across segments are unknown. */
  readonly chainId: number;
  /** Frame owner, or `undefined` for the top-level list. */
  readonly parent: ResolvedBody | undefined;
  /** Cursor advance from the previous expanded sibling; `undefined` = unresolvable. */
  readonly radialDelta: Interval | undefined;
  /** Bearing advance from the previous expanded sibling. */
  readonly angleDelta: AngleSpan;
  /** False when `orbitAngle` was absent or `"random"`. */
  readonly angleAuthored: boolean;
  /** Cumulative frame-local orbit radius; `undefined` = unresolvable. */
  readonly orbitRadius: Interval | undefined;
  /** Cumulative frame-local bearing. */
  readonly angle: AngleSpan;
  /** Visual disc radius under the documented approximation. */
  readonly visualRadius: Interval;
  /** True when the visual radius is assumed rather than derived from `size`. */
  readonly visualAssumed: boolean;
  /** `possible` for copies beyond the guaranteed `count` minimum, inherited by descendants. */
  readonly exists: "definite" | "possible";
  /** Authored size for labels, e.g. `"25"` or `"10-30"`. */
  readonly sizeLabel: string | undefined;
  /** System-frame position when the whole chain is fixed (list bearings global). */
  readonly positionShared: Point | undefined;
  /** System-frame position when child-frame bearings follow the parent bearing. */
  readonly positionRotated: Point | undefined;
  /** Radial distance band from the system center; `undefined` = unresolvable. */
  readonly systemBand: Interval | undefined;
}

/** A resolved asteroid belt annulus. */
export interface ResolvedBelt {
  readonly path: string;
  readonly type: string;
  readonly radius: Interval;
}

/** A resolved orbital line, for the preview only. */
export interface ResolvedOrbitalLine {
  readonly path: string;
  /** Ordinal of the owning body, or `undefined` for the system center. */
  readonly ownerOrdinal: number | undefined;
  readonly radius: number;
}

/** A finding recorded while resolving; diagnosed later with the geometry. */
export interface ResolverNote {
  readonly code: "unusable-range" | "unresolved-geometry" | "unresolved-visual";
  readonly ordinal: number;
  readonly paths: readonly string[];
  readonly message: string;
}

/** The resolved system model shared by diagnostics and the SVG preview. */
export interface ResolvedSystem {
  readonly id: string;
  readonly starClass: string;
  readonly bodies: readonly ResolvedBody[];
  readonly belts: readonly ResolvedBelt[];
  readonly orbitalLines: readonly ResolvedOrbitalLine[];
  readonly notes: readonly ResolverNote[];
}

const RANDOM_CLASSES = new Set([
  "random",
  "random_colonizable",
  "random_non_ideal",
  "random_non_colonizable",
  "random_asteroid",
  "ideal_planet_class",
  "ideal_design_class",
]);

interface Walk {
  bodies: ResolvedBody[];
  belts: ResolvedBelt[];
  orbitalLines: ResolvedOrbitalLine[];
  notes: ResolverNote[];
  seq: number;
  nextListId: number;
}

/** Resolves the full geometry model of one initializer definition. */
export function resolveSystem(def: SolarSystemInitializerDef): ResolvedSystem {
  const walk: Walk = { bodies: [], belts: [], orbitalLines: [], notes: [], seq: 0, nextListId: 0 };

  for (const [index, belt] of (def.asteroidBelt ?? []).entries()) {
    const path = `asteroidBelt[${index}]`;
    const radius = resolveNumberOrRange(belt.radius, path, "radius", walk);
    if (radius !== undefined) {
      walk.belts.push({ path, type: refId(belt.type), radius });
    }
  }

  for (const [index, line] of (def.orbitalLine ?? []).entries()) {
    const path = `orbitalLine[${index}]`;
    if (Number.isFinite(line.orbitDistanceFromParent)) {
      walk.orbitalLines.push({
        path,
        ownerOrdinal: undefined,
        radius: line.orbitDistanceFromParent,
      });
    } else {
      note(
        walk,
        "unusable-range",
        [path],
        `${path}.orbitDistanceFromParent must be a finite number.`
      );
    }
  }

  const initialRadius = resolveDelta(def.orbitDistance, "orbitDistance", "orbitDistance", walk);
  resolveList(def.planet ?? [], "planet", false, undefined, initialRadius, walk);

  return {
    id: def.id,
    starClass: refId(def.class),
    bodies: walk.bodies,
    belts: walk.belts,
    orbitalLines: walk.orbitalLines,
    notes: walk.notes,
  };
}

interface Cursor {
  radius: Interval | undefined;
  angle: AngleSpan;
  chainId: number;
  indexInList: number;
}

function resolveList(
  entries: readonly (PlanetInitializerFields | MoonInitializerFields)[],
  listPath: string,
  isMoonList: boolean,
  parent: ResolvedBody | undefined,
  initialRadius: Interval | undefined,
  walk: Walk
): void {
  const listId = walk.nextListId++;
  // An unresolvable initial radius leaves absolute radii unknown while
  // sibling-relative geometry still holds in one chain.
  const cursor: Cursor = {
    radius: initialRadius,
    angle: fixedAngle(0),
    chainId: 0,
    indexInList: 0,
  };

  for (const [index, entry] of entries.entries()) {
    const path = `${listPath}[${index}]`;
    resolveEntry(entry, path, isMoonList, parent, listId, cursor, walk);
  }
}

function resolveEntry(
  entry: PlanetInitializerFields | MoonInitializerFields,
  path: string,
  isMoonList: boolean,
  parent: ResolvedBody | undefined,
  listId: number,
  cursor: Cursor,
  walk: Walk
): void {
  const className = entry.class === undefined ? undefined : refId(entry.class);
  const kind = bodyKind(className, isMoonList);
  const count = resolveCount(entry.count, path, walk);
  const radialDelta = resolveDelta(entry.orbitDistance, path, "orbitDistance", walk);
  const { angleDelta, angleAuthored } = resolveAngle(entry.orbitAngle, path, walk);
  const visual = resolveVisual(entry, className, kind, path, walk);
  const startRadius = cursor.radius;
  const startAngle = cursor.angle;

  for (let copy = 0; copy < count.copies; copy += 1) {
    const optional = copy >= count.guaranteed;
    let bodyRadius: Interval | undefined;
    let bodyAngle: AngleSpan;
    if (radialDelta === undefined) {
      // An unresolvable advance starts a new relative-geometry segment.
      cursor.chainId += 1;
      cursor.radius = undefined;
      bodyAngle = addSpans(cursor.angle, angleDelta);
      cursor.angle = bodyAngle;
    } else {
      // Copy k exists only when its whole prefix does, so its position uses
      // exactly k + 1 fresh advances from the template start; the maybe-fewer
      // scenarios only widen the cursor left for later siblings.
      bodyRadius =
        startRadius === undefined ? undefined : addScaled(startRadius, radialDelta, copy + 1);
      bodyAngle = spanAfter(startAngle, angleDelta, copy + 1);
    }

    const body: ResolvedBody = {
      ordinal: walk.seq++,
      path,
      copy,
      copies: count.copies,
      kind,
      name: entry.name,
      className,
      listId,
      indexInList: cursor.indexInList++,
      chainId: cursor.chainId,
      parent,
      radialDelta,
      angleDelta,
      angleAuthored,
      orbitRadius: bodyRadius,
      angle: bodyAngle,
      visualRadius: visual.radius,
      visualAssumed: visual.assumed,
      exists: optional || parent?.exists === "possible" ? "possible" : "definite",
      sizeLabel: visual.sizeLabel,
      ...positions(parent, bodyRadius, bodyAngle),
    };
    walk.bodies.push(body);

    if (copy === 0 && visual.assumed && kind !== "cursor") {
      const reason =
        visual.sizeLabel === undefined
          ? "has no usable size"
          : "has a random or asset-dependent appearance";
      note(
        walk,
        "unresolved-visual",
        [path],
        `${path} ${reason}; the preview uses an approximate visual radius of ${visual.radius.max}.`
      );
    }
    // Every spawned copy carries the nested layout.
    resolveChildren(entry, path, body, walk);
  }

  if (radialDelta !== undefined) {
    // Later siblings continue from anywhere between the guaranteed-count and
    // expanded-count positions.
    const atGuaranteed =
      startRadius === undefined ? undefined : addScaled(startRadius, radialDelta, count.guaranteed);
    const atExpanded =
      startRadius === undefined ? undefined : addScaled(startRadius, radialDelta, count.copies);
    cursor.radius =
      atGuaranteed === undefined || atExpanded === undefined
        ? undefined
        : hull(atGuaranteed, atExpanded);
    cursor.angle = hullSpans(
      spanAfter(startAngle, angleDelta, count.guaranteed),
      spanAfter(startAngle, angleDelta, count.copies)
    );
  }

  if (count.openEnded || count.truncated) {
    // Copies beyond the expansion are unmodeled: the next sibling starts a
    // new relative-geometry segment.
    cursor.chainId += 1;
    cursor.radius = undefined;
    if (count.openEnded) {
      note(
        walk,
        "unresolved-geometry",
        [path],
        `${path}.count has no upper bound; positions after this template are unresolvable.`
      );
    }
  }
}

function addScaled(base: Interval, delta: Interval, copies: number): Interval {
  return { min: base.min + delta.min * copies, max: base.max + delta.max * copies };
}

function spanAfter(base: AngleSpan, delta: AngleSpan, copies: number): AngleSpan {
  let span = base;
  for (let i = 0; i < copies; i += 1) {
    span = addSpans(span, delta);
    if (span.kind === "full") {
      return span;
    }
  }
  return span;
}

function resolveChildren(
  entry: PlanetInitializerFields | MoonInitializerFields,
  path: string,
  body: ResolvedBody,
  walk: Walk
): void {
  for (const [index, line] of (entry.orbitalLine ?? []).entries()) {
    const linePath = `${path}.orbitalLine[${index}]`;
    if (Number.isFinite(line.orbitDistanceFromParent)) {
      walk.orbitalLines.push({
        path: linePath,
        ownerOrdinal: body.ordinal,
        radius: line.orbitDistanceFromParent,
      });
    } else {
      note(
        walk,
        "unusable-range",
        [linePath],
        `${linePath}.orbitDistanceFromParent must be a finite number.`
      );
    }
  }
  if ("planet" in entry && entry.planet !== undefined) {
    resolveList(entry.planet, `${path}.planet`, false, body, ZERO_INTERVAL, walk);
  }
  if (entry.moon !== undefined) {
    resolveList(entry.moon, `${path}.moon`, true, body, ZERO_INTERVAL, walk);
  }
}

function positions(
  parent: ResolvedBody | undefined,
  radius: Interval | undefined,
  angle: AngleSpan
): Pick<ResolvedBody, "positionShared" | "positionRotated" | "systemBand"> {
  const parentShared = parent === undefined ? { x: 0, y: 0 } : parent.positionShared;
  const parentRotated = parent === undefined ? { x: 0, y: 0 } : parent.positionRotated;
  const parentBearing = parent === undefined ? 0 : bearingOf(parent);
  const parentBand = parent === undefined ? ZERO_INTERVAL : parent.systemBand;

  let positionShared: Point | undefined;
  let positionRotated: Point | undefined;
  if (radius !== undefined && radius.min === radius.max && angle.kind === "fixed") {
    if (parentShared !== undefined) {
      positionShared = polar(parentShared, radius.min, angle.deg);
    }
    if (parentRotated !== undefined && parentBearing !== undefined) {
      positionRotated = polar(parentRotated, radius.min, angle.deg + parentBearing);
    }
  }

  let systemBand: Interval | undefined;
  if (positionShared !== undefined && positionRotated !== undefined) {
    const a = Math.hypot(positionShared.x, positionShared.y);
    const b = Math.hypot(positionRotated.x, positionRotated.y);
    systemBand = { min: Math.min(a, b), max: Math.max(a, b) };
  } else if (radius !== undefined && parentBand !== undefined) {
    if (parentBand.min === 0 && parentBand.max === 0) {
      // The frame center sits at the system center, so the radial distance is
      // exactly the frame-local radius whatever the bearing.
      systemBand = absInterval(radius);
    } else {
      const reach = Math.max(Math.abs(radius.min), Math.abs(radius.max));
      systemBand = { min: Math.max(0, parentBand.min - reach), max: parentBand.max + reach };
    }
  }

  return { positionShared, positionRotated, systemBand };
}

function bearingOf(body: ResolvedBody): number | undefined {
  if (body.angle.kind !== "fixed") {
    return undefined;
  }
  const parentBearing = body.parent === undefined ? 0 : bearingOf(body.parent);
  return parentBearing === undefined ? undefined : parentBearing + body.angle.deg;
}

function polar(origin: Point, radius: number, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: origin.x + radius * Math.cos(rad), y: origin.y + radius * Math.sin(rad) };
}

function bodyKind(className: string | undefined, isMoonList: boolean): BodyKind {
  if (className === "none") {
    return "cursor";
  }
  if (className === "star") {
    return "star";
  }
  if (className !== undefined && className.includes("asteroid")) {
    return "asteroid";
  }
  return isMoonList ? "moon" : "planet";
}

interface ResolvedCount {
  readonly copies: number;
  readonly guaranteed: number;
  readonly openEnded: boolean;
  /** True when the authored count exceeds the expansion ceiling. */
  readonly truncated: boolean;
}

function resolveCount(
  value: number | { min?: number; max?: number } | undefined,
  path: string,
  walk: Walk
): ResolvedCount {
  const single: ResolvedCount = { copies: 1, guaranteed: 1, openEnded: false, truncated: false };
  if (value === undefined) {
    return single;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      note(walk, "unusable-range", [path], `${path}.count must be a nonnegative integer.`);
      return single;
    }
    return capped(value, value, false, path, walk);
  }
  const min = value.min ?? 1;
  const max = value.max;
  if (
    !Number.isInteger(min) ||
    min < 0 ||
    (max !== undefined && (!Number.isInteger(max) || max < min))
  ) {
    note(
      walk,
      "unusable-range",
      [path],
      `${path}.count must use nonnegative integers with min <= max.`
    );
    return single;
  }
  if (max === undefined) {
    return capped(min, min, true, path, walk);
  }
  return capped(max, min, false, path, walk);
}

function capped(
  copies: number,
  guaranteed: number,
  openEnded: boolean,
  path: string,
  walk: Walk
): ResolvedCount {
  if (copies <= MAX_EXPANDED_COPIES) {
    return { copies, guaranteed, openEnded, truncated: false };
  }
  note(
    walk,
    "unresolved-geometry",
    [path],
    `${path}.count exceeds ${MAX_EXPANDED_COPIES}; further copies and later sibling positions are not modeled.`
  );
  return {
    copies: MAX_EXPANDED_COPIES,
    guaranteed: Math.min(guaranteed, MAX_EXPANDED_COPIES),
    openEnded,
    truncated: true,
  };
}

function resolveNumberOrRange(
  value: number | { min: number; max: number },
  path: string,
  field: string,
  walk: Walk
): Interval | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      note(walk, "unusable-range", [path], `${path}.${field} must be a finite number.`);
      return undefined;
    }
    return point(value);
  }
  if (!Number.isFinite(value.min) || !Number.isFinite(value.max) || value.min > value.max) {
    note(walk, "unusable-range", [path], `${path}.${field} must satisfy finite min <= max.`);
    return undefined;
  }
  return { min: value.min, max: value.max };
}

function resolveDelta(
  value: ScriptValue | { min: ScriptValue; max: ScriptValue } | undefined,
  path: string,
  field: string,
  walk: Walk
): Interval | undefined {
  if (value === undefined) {
    return ZERO_INTERVAL;
  }
  const location = path === field ? field : `${path}.${field}`;
  if (typeof value === "string") {
    note(
      walk,
      "unresolved-geometry",
      [path],
      `${location} is the script value ${JSON.stringify(value)} and cannot be resolved to a number.`
    );
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      note(walk, "unusable-range", [path], `${location} must be a finite number.`);
      return ZERO_INTERVAL;
    }
    return point(value);
  }
  if (typeof value.min === "string" || typeof value.max === "string") {
    note(
      walk,
      "unresolved-geometry",
      [path],
      `${location} uses a script value bound and cannot be resolved to numbers.`
    );
    return undefined;
  }
  if (!Number.isFinite(value.min) || !Number.isFinite(value.max) || value.min > value.max) {
    note(walk, "unusable-range", [path], `${location} must satisfy finite min <= max.`);
    return ZERO_INTERVAL;
  }
  return { min: value.min, max: value.max };
}

function resolveAngle(
  value: "random" | number | { min: number; max: number } | undefined,
  path: string,
  walk: Walk
): { angleDelta: AngleSpan; angleAuthored: boolean } {
  if (value === undefined || value === "random") {
    return { angleDelta: FULL_SPAN, angleAuthored: false };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      note(walk, "unusable-range", [path], `${path}.orbitAngle must be a finite number.`);
      return { angleDelta: fixedAngle(0), angleAuthored: false };
    }
    return { angleDelta: fixedAngle(value), angleAuthored: true };
  }
  if (!Number.isFinite(value.min) || !Number.isFinite(value.max)) {
    note(walk, "unusable-range", [path], `${path}.orbitAngle must use finite bounds.`);
    return { angleDelta: fixedAngle(0), angleAuthored: false };
  }
  // `min > max` is a wrap-around arc: `{ min = 355 max = 5 }` crosses zero.
  const max = value.min > value.max ? value.max + 360 : value.max;
  return { angleDelta: angleRange(value.min, max), angleAuthored: true };
}

interface ResolvedVisual {
  readonly radius: Interval;
  readonly assumed: boolean;
  readonly sizeLabel: string | undefined;
}

function resolveVisual(
  entry: PlanetInitializerFields | MoonInitializerFields,
  className: string | undefined,
  kind: BodyKind,
  path: string,
  walk: Walk
): ResolvedVisual {
  if (kind === "cursor") {
    return { radius: ZERO_INTERVAL, assumed: false, sizeLabel: undefined };
  }
  const fallback = point(ASSUMED_VISUAL_RADIUS[kind]);
  // The generated type declares numeric sizes, but vanilla text carries
  // scripted-variable sizes (`size = @asteroid_min_size`), so the vanilla
  // calibration adapter feeds strings through here at runtime. A string is
  // unresolvable rather than unusable.
  const size = entry.size as
    number | string | { min: number | string; max: number | string } | undefined;
  let sizeInterval: Interval | undefined;
  let sizeLabel: string | undefined;
  if (typeof size === "number") {
    if (Number.isFinite(size) && size >= 0) {
      sizeInterval = point(size);
      sizeLabel = String(size);
    } else {
      note(walk, "unusable-range", [path], `${path}.size must be a finite nonnegative number.`);
    }
  } else if (typeof size === "string") {
    sizeLabel = size;
  } else if (size !== undefined) {
    if (typeof size.min !== "number" || typeof size.max !== "number") {
      sizeLabel = `${size.min}-${size.max}`;
    } else if (
      Number.isFinite(size.min) &&
      Number.isFinite(size.max) &&
      size.min >= 0 &&
      size.min <= size.max
    ) {
      sizeInterval = { min: size.min, max: size.max };
      sizeLabel = `${size.min}-${size.max}`;
    } else {
      note(walk, "unusable-range", [path], `${path}.size must satisfy finite 0 <= min <= max.`);
    }
  }

  if (sizeInterval === undefined) {
    return { radius: fallback, assumed: true, sizeLabel };
  }
  const radius = {
    min: sizeInterval.min * SIZE_TO_VISUAL_RADIUS,
    max: sizeInterval.max * SIZE_TO_VISUAL_RADIUS,
  };
  const randomClass =
    className === undefined || RANDOM_CLASSES.has(className) || className.startsWith("rl_");
  const assumed = entry.entity !== undefined || randomClass;
  return { radius, assumed, sizeLabel };
}

function note(
  walk: Walk,
  code: ResolverNote["code"],
  paths: readonly string[],
  message: string
): void {
  walk.notes.push({ code, ordinal: walk.seq++, paths, message });
}
