/**
 * Closed numeric interval arithmetic and polar sector distance bounds for the
 * solar-system geometry resolver. Internal to `solar-system-inspect`.
 */

/** A closed interval with `min <= max`. A point value has `min === max`. */
export interface Interval {
  readonly min: number;
  readonly max: number;
}

/** The point interval `[0, 0]`. */
export const ZERO_INTERVAL: Interval = { min: 0, max: 0 };

/** Creates the point interval `[value, value]`. */
export function point(value: number): Interval {
  return { min: value, max: value };
}

/** Interval sum. */
export function add(a: Interval, b: Interval): Interval {
  return { min: a.min + b.min, max: a.max + b.max };
}

/** True when `value` lies inside the closed interval. */
export function contains(interval: Interval, value: number): boolean {
  return interval.min <= value && value <= interval.max;
}

/** Clamps `value` into the closed interval. */
export function clamp(interval: Interval, value: number): number {
  return Math.min(interval.max, Math.max(interval.min, value));
}

/**
 * A set of possible bearings in degrees. `fixed` is one bearing; `range` is a
 * closed arc strictly narrower than a full turn; `full` is the whole circle.
 */
export type AngleSpan =
  | { readonly kind: "fixed"; readonly deg: number }
  | { readonly kind: "range"; readonly min: number; readonly max: number }
  | { readonly kind: "full" };

/** The whole-circle span. */
export const FULL_SPAN: AngleSpan = { kind: "full" };

/** Creates the single-bearing span. */
export function fixedAngle(deg: number): AngleSpan {
  return { kind: "fixed", deg };
}

/** Creates an arc span, saturating to `full` at a whole turn or wider. */
export function angleRange(min: number, max: number): AngleSpan {
  if (max - min >= 360) {
    return FULL_SPAN;
  }
  return min === max ? fixedAngle(min) : { kind: "range", min, max };
}

/** Sum of two bearing sets: every pairwise sum, saturating to `full`. */
export function addSpans(a: AngleSpan, b: AngleSpan): AngleSpan {
  if (a.kind === "full" || b.kind === "full") {
    return FULL_SPAN;
  }
  const aMin = a.kind === "fixed" ? a.deg : a.min;
  const aMax = a.kind === "fixed" ? a.deg : a.max;
  const bMin = b.kind === "fixed" ? b.deg : b.min;
  const bMax = b.kind === "fixed" ? b.deg : b.max;
  return angleRange(aMin + bMin, aMax + bMax);
}

/** Smallest interval containing both inputs. */
export function hull(a: Interval, b: Interval): Interval {
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

/** Smallest span containing both bearing sets. */
export function hullSpans(a: AngleSpan, b: AngleSpan): AngleSpan {
  if (a.kind === "full" || b.kind === "full") {
    return FULL_SPAN;
  }
  const aMin = a.kind === "fixed" ? a.deg : a.min;
  const aMax = a.kind === "fixed" ? a.deg : a.max;
  const bMin = b.kind === "fixed" ? b.deg : b.min;
  const bMax = b.kind === "fixed" ? b.deg : b.max;
  return angleRange(Math.min(aMin, bMin), Math.max(aMax, bMax));
}

/** Negation of a bearing set: `{-x : x in span}`. */
export function negateSpan(span: AngleSpan): AngleSpan {
  if (span.kind === "full") {
    return FULL_SPAN;
  }
  if (span.kind === "fixed") {
    return fixedAngle(-span.deg);
  }
  return angleRange(-span.max, -span.min);
}

function wrapToSignedHalfTurn(deg: number): number {
  return deg - Math.floor((deg + 180) / 360) * 360;
}

/**
 * The circular absolute separations a bearing set reaches, as a closed
 * subinterval of `[0, 180]` degrees. `full` reaches every separation.
 */
export function circularAbs(span: AngleSpan): Interval {
  if (span.kind === "full") {
    return { min: 0, max: 180 };
  }
  const lo = span.kind === "fixed" ? span.deg : span.min;
  const width = span.kind === "fixed" ? 0 : span.max - span.min;
  // With the start wrapped into [-180, 180) and width < 360, the arc crosses
  // at most one of the separation extremes 0 (also as 360) and 180.
  const start = wrapToSignedHalfTurn(lo);
  const end = start + width;
  const separation = (deg: number): number => Math.abs(wrapToSignedHalfTurn(deg));
  let min = Math.min(separation(start), separation(end));
  let max = Math.max(separation(start), separation(end));
  if ((start <= 0 && end >= 0) || end >= 360) {
    min = 0;
  }
  if ((start <= -180 && end >= -180) || (start <= 180 && end >= 180)) {
    max = 180;
  }
  return { min, max };
}

/** Distance bounds between two position sets about a shared center. */
export interface DistanceBounds {
  /** Smallest reachable center-to-center distance. Exact. */
  readonly min: number;
  /**
   * Largest reachable center-to-center distance, or `undefined` when a radius
   * set reaches below zero and the bound would be unsound.
   */
  readonly max: number | undefined;
}

function squaredDistance(r1: number, r2: number, separationDeg: number): number {
  const c = 2 * (1 - Math.cos((separationDeg * Math.PI) / 180));
  return (r1 - r2) * (r1 - r2) + r1 * r2 * c;
}

function boundsFromCandidates(
  radiusPairs: readonly (readonly [number, number])[],
  separation: Interval,
  soundMax: boolean
): DistanceBounds {
  let minSq = Infinity;
  let maxSq = 0;
  for (const [r1, r2] of radiusPairs) {
    // With a negative radius product the distance shrinks as separation
    // grows, so both separation endpoints are candidates for either bound.
    for (const deg of [separation.min, separation.max]) {
      const sq = squaredDistance(r1, r2, deg);
      minSq = Math.min(minSq, sq);
      maxSq = Math.max(maxSq, sq);
    }
  }
  return {
    min: Math.sqrt(Math.max(0, minSq)),
    max: soundMax ? Math.sqrt(Math.max(0, maxSq)) : undefined,
  };
}

/**
 * Distance bounds between a body at radius `r1` and a sibling at radius
 * `r1 + delta`, where `delta` is the accumulated cursor advance between them.
 * The correlation matters: a fixed nonzero advance keeps the radial gap exact
 * even when `r1` itself is a range. `angleDiff` is the accumulated bearing
 * advance between the two bodies.
 */
export function correlatedDistance(
  r1: Interval,
  delta: Interval,
  angleDiff: AngleSpan
): DistanceBounds {
  const separation = circularAbs(angleDiff);
  // d^2 = delta^2 + c * r1 * (r1 + delta) is jointly convex in (r1, delta) at
  // each separation, so the exact minimum lies at a corner or a clamped
  // stationary point; both separation endpoints supply stationary candidates.
  const r1Candidates = new Set([r1.min, r1.max]);
  const deltaCandidates = new Set([delta.min, delta.max]);
  if (contains(delta, 0)) {
    deltaCandidates.add(0);
  }
  for (const d of [delta.min, delta.max]) {
    r1Candidates.add(clamp(r1, -d / 2));
  }
  for (const deg of [separation.min, separation.max]) {
    const c = 2 * (1 - Math.cos((deg * Math.PI) / 180));
    for (const r of [r1.min, r1.max]) {
      deltaCandidates.add(clamp(delta, (-c * r) / 2));
    }
  }
  r1Candidates.add(clamp(r1, 0));
  const pairs: (readonly [number, number])[] = [];
  for (const r of r1Candidates) {
    for (const d of deltaCandidates) {
      pairs.push([r, r + d]);
    }
  }
  const soundMax = r1.min >= 0 && r1.min + delta.min >= 0;
  return boundsFromCandidates(pairs, separation, soundMax);
}

/**
 * Distance bounds between two independent position sets about a shared
 * center: radii `r1` and `r2` vary freely, and `angleDiff` is the set of
 * bearing differences between them.
 */
export function independentDistance(
  r1: Interval,
  r2: Interval,
  angleDiff: AngleSpan
): DistanceBounds {
  const separation = circularAbs(angleDiff);
  // d^2 = r1^2 + r2^2 - 2 r1 r2 cos(sep) is jointly convex at each
  // separation, so corners plus the clamped projections r2 = r1 cos(sep)
  // cover the exact minimum on the box; both separation endpoints supply
  // projection candidates.
  const pairs: (readonly [number, number])[] = [];
  for (const a of [r1.min, r1.max]) {
    for (const b of [r2.min, r2.max]) {
      pairs.push([a, b]);
    }
  }
  for (const deg of [separation.min, separation.max]) {
    const cos = Math.cos((deg * Math.PI) / 180);
    for (const a of [r1.min, r1.max]) {
      pairs.push([a, clamp(r2, a * cos)]);
    }
    for (const b of [r2.min, r2.max]) {
      pairs.push([clamp(r1, b * cos), b]);
    }
  }
  const soundMax = r1.min >= 0 && r2.min >= 0;
  return boundsFromCandidates(pairs, separation, soundMax);
}

/** The absolute values an interval reaches. */
export function absInterval(a: Interval): Interval {
  if (contains(a, 0)) {
    return { min: 0, max: Math.max(-a.min, a.max) };
  }
  return a.min > 0 ? a : { min: -a.max, max: -a.min };
}

/** Smallest absolute difference between values of two intervals. */
export function intervalGap(a: Interval, b: Interval): number {
  return Math.max(0, a.min - b.max, b.min - a.max);
}
