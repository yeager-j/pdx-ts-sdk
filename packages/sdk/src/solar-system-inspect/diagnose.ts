/**
 * Layout diagnostics over the resolved geometry model. Internal except for
 * the diagnostic value types, which `inspectSolarSystem` re-exports.
 */

import {
  absInterval,
  addSpans,
  circularAbs,
  correlatedDistance,
  hullSpans,
  independentDistance,
  intervalGap,
  negateSpan,
  point,
  type AngleSpan,
  type DistanceBounds,
  type Interval,
} from "./interval.ts";
import { BELT_HALF_WIDTH, type ResolvedBody, type ResolvedSystem } from "./resolve.ts";

/** Stable identity of one layout finding. */
export type SolarSystemDiagnosticCode =
  /** Two bodies' visual discs can meet. */
  | "body-overlap"
  /** Copies of one `count` template can meet each other. */
  | "template-self-overlap"
  /** A child's orbit sits inside its parent's visual disc. */
  | "parent-bound-intersection"
  /** A body's disc can cross an asteroid-belt annulus. */
  | "belt-body-crossing"
  /** A cumulative orbit radius dips below zero (a shipped vanilla idiom). */
  | "negative-orbit-radius"
  /** A field value is invalid: inverted range, non-finite number, bad count. */
  | "unusable-range"
  /** Bodies share one cursor point; the game separates them with spacing. */
  | "zero-advance-stack"
  /** A position cannot be computed: script-value field or open-ended count. */
  | "unresolved-geometry"
  /** A body's visual radius is assumed: random class, entity, or no size. */
  | "unresolved-visual";

/**
 * One structured layout finding. `warning` findings describe visual-overlap
 * risks or unusable inputs; `info` findings describe idioms and modeling
 * limits. `certainty` is about the authored ranges: `definite` holds for
 * every admissible value, `possible` for some, and `unresolved` marks
 * geometry the resolver cannot compute faithfully.
 */
export interface SolarSystemDiagnostic {
  /** Stable machine-readable identity, safe to match on across versions. */
  readonly code: SolarSystemDiagnosticCode;
  /** `warning` for overlap risks and unusable values; `info` for idioms and limits. */
  readonly severity: "warning" | "info";
  /**
   * How the finding relates to authored ranges: `definite` holds for every
   * admissible value, `possible` for some, `unresolved` marks geometry that
   * cannot be computed faithfully.
   */
  readonly certainty: "definite" | "possible" | "unresolved";
  /** Stable source paths, e.g. `planet[1].moon[0]`. */
  readonly paths: readonly string[];
  /** Human-readable description with the measured values. */
  readonly message: string;
}

interface Finding extends SolarSystemDiagnostic {
  readonly ordinal: number;
}

/** Runs every diagnostic pass and returns the deterministically ordered list. */
export function diagnose(system: ResolvedSystem): SolarSystemDiagnostic[] {
  const findings: Finding[] = [];

  for (const noted of system.notes) {
    const unusable = noted.code === "unusable-range";
    findings.push({
      code: noted.code,
      severity: unusable ? "warning" : "info",
      certainty: unusable ? "definite" : "unresolved",
      paths: noted.paths,
      message: noted.message,
      ordinal: noted.ordinal,
    });
  }

  const lists = new Map<number, ResolvedBody[]>();
  const frames = new Map<number, ResolvedBody[]>();
  for (const body of system.bodies) {
    appendTo(lists, body.listId, body);
    if (body.kind !== "cursor") {
      appendTo(frames, body.parent?.ordinal ?? -1, body);
      checkParentBound(body, findings);
      checkNegativeRadius(body, findings);
      checkBelts(body, system, findings);
    }
  }

  for (const list of lists.values()) {
    checkSiblingPairs(list, findings);
  }
  for (const frame of frames.values()) {
    checkCrossListPairs(frame, findings);
  }
  checkCrossFramePairs(system.bodies, findings);

  findings.sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code));
  return findings.map(({ ordinal: _ordinal, ...diagnostic }) => diagnostic);
}

function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket === undefined) {
    map.set(key, [value]);
  } else {
    bucket.push(value);
  }
}

interface Connection {
  readonly delta: Interval;
  readonly angleDiff: AngleSpan;
  readonly anyAngleAuthored: boolean;
}

function connect(list: readonly ResolvedBody[], from: number, to: number): Connection | undefined {
  const target = list[to]!;
  let delta: Interval = { min: 0, max: 0 };
  let angleDiff: AngleSpan = { kind: "fixed", deg: 0 };
  let anyAngleAuthored = false;
  for (let k = from + 1; k <= to; k += 1) {
    const step = list[k]!;
    if (step.radialDelta === undefined) {
      return undefined;
    }
    // An optional copy of another template may not spawn, so its advance is
    // hulled with zero. Optional copies of the target's own template are a
    // prefix of the target and spawn whenever it does.
    const conditional = step.exists === "possible" && step.path !== target.path;
    const stepDelta = conditional
      ? { min: Math.min(step.radialDelta.min, 0), max: Math.max(step.radialDelta.max, 0) }
      : step.radialDelta;
    const stepAngle = conditional
      ? hullSpans(step.angleDelta, { kind: "fixed", deg: 0 })
      : step.angleDelta;
    delta = { min: delta.min + stepDelta.min, max: delta.max + stepDelta.max };
    angleDiff = addSpans(angleDiff, stepAngle);
    anyAngleAuthored = anyAngleAuthored || step.angleAuthored;
  }
  return { delta, angleDiff, anyAngleAuthored };
}

function checkSiblingPairs(list: readonly ResolvedBody[], findings: Finding[]): void {
  const stackParents = new Map<ResolvedBody, ResolvedBody>();
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i]!;
    if (a.kind === "cursor") {
      continue;
    }
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j]!;
      if (b.kind === "cursor" || b.chainId !== a.chainId) {
        continue;
      }
      const connection = connect(list, i, j);
      if (connection === undefined) {
        continue;
      }
      const stacked =
        connection.delta.min === 0 &&
        connection.delta.max === 0 &&
        connection.angleDiff.kind === "full" &&
        !connection.anyAngleAuthored;
      if (stacked) {
        union(stackParents, a, b);
        continue;
      }
      const bounds = pairBounds(a, connection);
      if (bounds === undefined) {
        continue;
      }
      // Exact cursor coincidence for every admissible value is the game's
      // stack-then-space idiom (vanilla fans asteroids at one point with
      // repeated angles), not a collision claim.
      if (bounds.max === 0) {
        union(stackParents, a, b);
        continue;
      }
      reportOverlap(a, b, bounds, findings);
    }
  }
  emitStacks(stackParents, findings);
}

function pairBounds(a: ResolvedBody, connection: Connection): DistanceBounds | undefined {
  if (a.orbitRadius !== undefined) {
    return correlatedDistance(a.orbitRadius, connection.delta, connection.angleDiff);
  }
  // Absolute radii are unknown, but at zero bearing separation the distance
  // equals the radial advance whatever the base radius is.
  if (circularAbs(connection.angleDiff).min === 0) {
    return { min: intervalGap(connection.delta, point(0)), max: undefined };
  }
  return undefined;
}

function checkCrossListPairs(frame: readonly ResolvedBody[], findings: Finding[]): void {
  for (let i = 0; i < frame.length; i += 1) {
    const a = frame[i]!;
    if (a.orbitRadius === undefined) {
      continue;
    }
    for (let j = i + 1; j < frame.length; j += 1) {
      const b = frame[j]!;
      if (b.listId === a.listId || b.orbitRadius === undefined) {
        continue;
      }
      const angleDiff = addSpans(b.angle, negateSpan(a.angle));
      const bounds = independentDistance(a.orbitRadius, b.orbitRadius, angleDiff);
      if (bounds.max === 0) {
        // Exact coincidence across two child lists is the same stack-then-space
        // idiom the sibling pass groups, so it informs rather than warns.
        findings.push({
          code: "zero-advance-stack",
          severity: "info",
          certainty: "possible",
          paths: [a.path, b.path],
          message: `${label(a)} and ${label(b)} share one position in their parent's frame; the game separates them with size-based spacing that has no author-facing formula.`,
          ordinal: Math.min(a.ordinal, b.ordinal),
        });
        continue;
      }
      reportOverlap(a, b, bounds, findings);
    }
  }
}

function checkCrossFramePairs(bodies: readonly ResolvedBody[], findings: Finding[]): void {
  const fixed = bodies.flatMap((body) =>
    body.kind !== "cursor" &&
    body.positionShared !== undefined &&
    body.positionRotated !== undefined
      ? [{ body, shared: body.positionShared, rotated: body.positionRotated }]
      : []
  );
  for (let i = 0; i < fixed.length; i += 1) {
    const a = fixed[i]!;
    for (let j = i + 1; j < fixed.length; j += 1) {
      const b = fixed[j]!;
      const sameFrame = (a.body.parent?.ordinal ?? -1) === (b.body.parent?.ordinal ?? -1);
      if (sameFrame || a.body.parent === b.body || b.body.parent === a.body) {
        continue;
      }
      const shared = distance(a.shared, b.shared);
      const rotated = distance(a.rotated, b.rotated);
      // The bearing origin of a nested frame is a modeled unknown, so the
      // nearer of the two conventions bounds the claim at `possible`.
      const bounds: DistanceBounds = { min: Math.min(shared, rotated), max: undefined };
      reportOverlap(a.body, b.body, bounds, findings);
    }
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function reportOverlap(
  a: ResolvedBody,
  b: ResolvedBody,
  bounds: DistanceBounds,
  findings: Finding[]
): void {
  const sumMin = a.visualRadius.min + b.visualRadius.min;
  const sumMax = a.visualRadius.max + b.visualRadius.max;
  const caps =
    a.exists === "possible" || b.exists === "possible" || a.visualAssumed || b.visualAssumed;
  const definite = bounds.max !== undefined && bounds.max < sumMin && !caps;
  const possible = bounds.min < sumMax;
  if (!possible || bounds.max === 0) {
    return;
  }
  const selfPair = a.path === b.path;
  const certainty = definite ? "definite" : "possible";
  const subject = selfPair ? `Copies of ${label(a)}` : `${label(a)} and ${label(b)}`;
  const verb = definite ? "stay within" : "can come within";
  findings.push({
    code: selfPair ? "template-self-overlap" : "body-overlap",
    severity: "warning",
    certainty,
    paths: selfPair ? [a.path] : [a.path, b.path],
    message: `${subject} ${verb} ${fmt(bounds.min)} of each other while their visual radii total ${fmt(sumMax)}; visual-overlap risk.`,
    ordinal: Math.min(a.ordinal, b.ordinal),
  });
}

function checkParentBound(body: ResolvedBody, findings: Finding[]): void {
  const parent = body.parent;
  if (parent === undefined || parent.kind === "cursor" || body.orbitRadius === undefined) {
    return;
  }
  const reach = absInterval(body.orbitRadius);
  if (body.orbitRadius.min === 0 && body.orbitRadius.max === 0) {
    // A zero orbit is the game's stack-then-space idiom, not a collision.
    return;
  }
  const sumMax = parent.visualRadius.max + body.visualRadius.max;
  if (reach.min >= sumMax) {
    return;
  }
  findings.push({
    code: "parent-bound-intersection",
    severity: "warning",
    // Vanilla ships moons this close (the game applies size-based spacing
    // between a parent and its satellites), so this is never definite.
    certainty: "possible",
    paths: [body.path, parent.path],
    message: `${label(body)} orbits ${label(parent)} at ${fmtInterval(reach)} while their visual radii total ${fmt(sumMax)}; the orbit sits inside the parent's disc. Visual-overlap risk.`,
    ordinal: body.ordinal,
  });
}

function checkBelts(body: ResolvedBody, system: ResolvedSystem, findings: Finding[]): void {
  if (body.kind === "asteroid" || body.systemBand === undefined) {
    return;
  }
  for (const belt of system.belts) {
    const gap = intervalGap(body.systemBand, belt.radius);
    if (gap >= BELT_HALF_WIDTH + body.visualRadius.max) {
      continue;
    }
    findings.push({
      code: "belt-body-crossing",
      severity: "warning",
      // The annulus half-width is itself an approximation constant, so a
      // belt crossing is never claimed as definite.
      certainty: "possible",
      paths: [body.path, belt.path],
      message: `${label(body)} can cross the ${belt.type} at radius ${fmtInterval(belt.radius)} (assumed annulus half-width ${fmt(BELT_HALF_WIDTH)}); visual-overlap risk.`,
      ordinal: body.ordinal,
    });
  }
}

function checkNegativeRadius(body: ResolvedBody, findings: Finding[]): void {
  if (body.orbitRadius === undefined || body.orbitRadius.min >= 0) {
    return;
  }
  const definite = body.orbitRadius.max < 0 && body.exists === "definite";
  findings.push({
    code: "negative-orbit-radius",
    // A shipped idiom (several vanilla sol neighbors dip below zero), so this
    // informs rather than warns; the preview mirrors the position across the
    // frame center.
    severity: "info",
    certainty: definite ? "definite" : "possible",
    paths: [body.path],
    message: `${label(body)} reaches a negative cumulative orbit radius (${fmtInterval(body.orbitRadius)}); the accumulated orbitDistance values overshoot the frame center.`,
    ordinal: body.ordinal,
  });
}

function union(parents: Map<ResolvedBody, ResolvedBody>, a: ResolvedBody, b: ResolvedBody): void {
  const rootA = find(parents, a);
  const rootB = find(parents, b);
  if (rootA !== rootB) {
    parents.set(rootB, rootA);
  }
}

function find(parents: Map<ResolvedBody, ResolvedBody>, body: ResolvedBody): ResolvedBody {
  let current = body;
  while (true) {
    const parent = parents.get(current);
    if (parent === undefined || parent === current) {
      return current;
    }
    current = parent;
  }
}

function emitStacks(parents: Map<ResolvedBody, ResolvedBody>, findings: Finding[]): void {
  const groups = new Map<ResolvedBody, ResolvedBody[]>();
  const members = new Set<ResolvedBody>();
  for (const [child, parent] of parents) {
    members.add(child);
    members.add(parent);
  }
  for (const member of members) {
    appendTo(groups, find(parents, member), member);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.ordinal - b.ordinal);
    const paths = [...new Set(group.map((body) => body.path))];
    findings.push({
      code: "zero-advance-stack",
      severity: "info",
      certainty: "possible",
      paths,
      message: `${group.length} bodies at ${paths.join(", ")} share one orbit radius with no authored advance; the game separates them with size-based spacing that has no author-facing formula.`,
      ordinal: group[0]!.ordinal,
    });
  }
}

function label(body: ResolvedBody): string {
  return body.copies > 1 ? `${body.path} (copy ${body.copy + 1} of ${body.copies})` : body.path;
}

function fmt(value: number): string {
  return String(Number(value.toFixed(2)));
}

function fmtInterval(interval: Interval): string {
  return interval.min === interval.max
    ? fmt(interval.min)
    : `${fmt(interval.min)}..${fmt(interval.max)}`;
}
