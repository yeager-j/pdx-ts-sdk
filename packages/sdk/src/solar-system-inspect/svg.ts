/**
 * Deterministic standalone SVG preview of a resolved solar system. Internal
 * to `solar-system-inspect`.
 *
 * The picture is a schematic of orbit-cursor space: distances are cursor
 * units and body discs use the documented visual-radius approximation, not
 * the game's rendered sprite bounds.
 */

import type { SolarSystemDiagnostic } from "./diagnose.ts";
import { BELT_HALF_WIDTH, type ResolvedBody, type ResolvedSystem } from "./resolve.ts";

interface Placed {
  readonly body: ResolvedBody;
  readonly x: number;
  readonly y: number;
  /** Representative frame-local orbit radius used for drawing. */
  readonly radius: number;
  /** Frame center this body's orbit is drawn around. */
  readonly cx: number;
  readonly cy: number;
  /** How certain the drawn position is; decided once while placing. */
  readonly placement: "fixed" | "ranged" | "unresolved";
}

/** Fallback fan step so unknown bearings never stack ghost markers. */
const FALLBACK_FAN_STEP_DEG = 137.5;

/** Deterministic radial step for bodies with unresolvable radii. */
const UNRESOLVED_SHELF_STEP = 20;

const STYLE = `
  .bg { fill: #0b0e1a; }
  .orbit { fill: none; stroke: #2c3654; stroke-width: var(--hair); }
  .orbit-band { fill: none; stroke: #26304b; stroke-opacity: 0.55; }
  .orbit-uncertain { fill: none; stroke: #45507a; stroke-width: var(--hair); stroke-dasharray: var(--dash); }
  .belt { fill: none; stroke: #6b5d47; stroke-opacity: 0.35; }
  .belt-edge { fill: none; stroke: #8a7a5e; stroke-width: var(--hair); stroke-dasharray: var(--dash); }
  .line { fill: none; stroke: #3d4a6e; stroke-width: var(--hair); stroke-dasharray: var(--dash); }
  .body-star { fill: #ffd27f; }
  .body-planet { fill: #cfd8ff; }
  .body-moon { fill: #9fb4c8; }
  .body-asteroid { fill: #b0a08a; }
  .ghost { fill: none; stroke: #7f8cb0; stroke-width: var(--hair); stroke-dasharray: var(--dash); }
  .maybe { opacity: 0.5; }
  .unresolved { fill: none; stroke: #7f8cb0; stroke-width: var(--hair); stroke-dasharray: var(--dot); }
  .halo-definite { fill: none; stroke: #ff5f56; stroke-width: var(--halo); }
  .halo-possible { fill: none; stroke: #ffb454; stroke-width: var(--halo); }
  text { fill: #aab4d4; font-family: ui-sans-serif, system-ui, sans-serif; }
  .leader { stroke: #4a5578; stroke-width: var(--hair); }
`;

/** Renders the standalone SVG preview. `size` sets width/height attributes. */
export function renderSvg(
  system: ResolvedSystem,
  diagnostics: readonly SolarSystemDiagnostic[],
  size: number
): string {
  const placed = place(system);
  const extent = fitExtent(system, placed);
  const u = extent / 100;
  const hair = 0.35 * u;
  const halo = 0.8 * u;
  const minMarker = 0.8 * u;
  const font = 2.6 * u;

  const highlight = highlightByPath(diagnostics);
  const parts: string[] = [];
  const view = extent * 1.08;

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${fmt(-view)} ${fmt(-view)} ${fmt(2 * view)} ${fmt(2 * view)}" role="img" aria-label="${escape(system.id)}" style="--hair:${fmt(hair)};--halo:${fmt(halo)};--dash:${fmt(4 * hair)} ${fmt(3 * hair)};--dot:${fmt(hair)} ${fmt(2 * hair)}">`
  );
  parts.push(`<title>${escape(system.id)}</title>`);
  parts.push(
    `<desc>Cursor-space schematic of ${escape(system.id)} (class ${escape(system.starClass)}): ${placed.filter((p) => p.body.kind !== "cursor").length} bodies, ${system.belts.length} belts, ${diagnostics.length} findings. Distances and disc sizes are the documented approximation, not game rendering.</desc>`
  );
  parts.push(`<style>${STYLE}</style>`);
  parts.push(
    `<rect class="bg" x="${fmt(-view)}" y="${fmt(-view)}" width="${fmt(2 * view)}" height="${fmt(2 * view)}"/>`
  );

  for (const belt of system.belts) {
    const mid = (belt.radius.min + belt.radius.max) / 2;
    const width = 2 * BELT_HALF_WIDTH + (belt.radius.max - belt.radius.min);
    parts.push(`<circle class="belt" cx="0" cy="0" r="${fmt(mid)}" stroke-width="${fmt(width)}"/>`);
    if (belt.radius.min !== belt.radius.max) {
      parts.push(
        `<circle class="belt-edge" cx="0" cy="0" r="${fmt(belt.radius.min - BELT_HALF_WIDTH)}"/>`
      );
      parts.push(
        `<circle class="belt-edge" cx="0" cy="0" r="${fmt(belt.radius.max + BELT_HALF_WIDTH)}"/>`
      );
    }
  }

  const placedByOrdinal = new Map(placed.map((p) => [p.body.ordinal, p]));
  for (const line of system.orbitalLines) {
    const owner =
      line.ownerOrdinal === undefined ? undefined : placedByOrdinal.get(line.ownerOrdinal);
    const cx = owner?.x ?? 0;
    const cy = owner?.y ?? 0;
    parts.push(
      `<circle class="line" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(Math.abs(line.radius))}"/>`
    );
  }

  for (const p of placed) {
    const r = p.body.orbitRadius;
    if (p.body.kind === "cursor" || p.placement === "unresolved" || r === undefined) {
      continue;
    }
    if (r.min === 0 && r.max === 0) {
      continue;
    }
    if (r.min !== r.max) {
      const mid = Math.abs((r.min + r.max) / 2);
      const width = Math.abs(r.max) - Math.abs(r.min);
      parts.push(
        `<circle class="orbit-band" cx="${fmt(p.cx)}" cy="${fmt(p.cy)}" r="${fmt(mid)}" stroke-width="${fmt(Math.max(Math.abs(width), hair))}"/>`
      );
    }
    parts.push(
      `<circle class="${p.placement === "fixed" ? "orbit" : "orbit-uncertain"}" cx="${fmt(p.cx)}" cy="${fmt(p.cy)}" r="${fmt(Math.abs(p.radius))}"/>`
    );
  }

  for (const p of placed) {
    const body = p.body;
    if (body.kind === "cursor") {
      continue;
    }
    const marker = Math.max(body.visualRadius.max, minMarker);
    const classes: string[] = [];
    if (body.exists === "possible") {
      classes.push("maybe");
    }
    if (p.placement === "unresolved") {
      parts.push(
        `<g${classAttr(classes)}><circle class="unresolved" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(marker)}"/><text x="${fmt(p.x)}" y="${fmt(p.y + font * 0.35)}" font-size="${fmt(font)}" text-anchor="middle">?</text></g>`
      );
    } else if (p.placement === "fixed") {
      parts.push(
        `<circle${classAttr([`body-${body.kind}`, ...classes])} cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(marker)}"/>`
      );
    } else {
      parts.push(
        `<g${classAttr(classes)}><circle class="ghost" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(marker)}"/><circle class="body-${body.kind}" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(marker * 0.45)}"/></g>`
      );
    }
    const level = highlight.get(body.path);
    if (level !== undefined) {
      parts.push(
        `<circle class="halo-${level}" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(marker + 1.6 * u)}"/>`
      );
    }
  }

  parts.push(...renderLabels(placed, extent, font, minMarker));
  parts.push(...renderLegend(view, u, font));
  parts.push("</svg>");
  return parts.join("\n");
}

function classAttr(classes: readonly string[]): string {
  return classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
}

function place(system: ResolvedSystem): Placed[] {
  const placed: Placed[] = [];
  const byOrdinal = new Map<number, Placed>();
  const listCursor = new Map<number, number>();

  for (const body of system.bodies) {
    const parent = body.parent === undefined ? undefined : byOrdinal.get(body.parent.ordinal);
    const cx = parent?.x ?? 0;
    const cy = parent?.y ?? 0;
    let radius: number;
    let unresolved = false;
    if (body.orbitRadius !== undefined) {
      radius = (body.orbitRadius.min + body.orbitRadius.max) / 2;
    } else {
      radius = (listCursor.get(body.listId) ?? 0) + UNRESOLVED_SHELF_STEP;
      unresolved = true;
    }
    listCursor.set(body.listId, Math.abs(radius));
    let deg: number;
    switch (body.angle.kind) {
      case "fixed":
        deg = body.angle.deg;
        break;
      case "range":
        deg = (body.angle.min + body.angle.max) / 2;
        break;
      case "full":
        deg = (body.indexInList * FALLBACK_FAN_STEP_DEG) % 360;
        break;
    }
    const rad = (deg * Math.PI) / 180;
    const fixed =
      body.angle.kind === "fixed" &&
      body.orbitRadius !== undefined &&
      body.orbitRadius.min === body.orbitRadius.max;
    const placement =
      unresolved || parent?.placement === "unresolved" ? "unresolved" : fixed ? "fixed" : "ranged";
    const entry: Placed = {
      body,
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
      radius,
      cx,
      cy,
      placement,
    };
    placed.push(entry);
    byOrdinal.set(body.ordinal, entry);
  }
  return placed;
}

function fitExtent(system: ResolvedSystem, placed: readonly Placed[]): number {
  let extent = 10;
  for (const p of placed) {
    const reach = Math.hypot(p.x, p.y) + Math.max(p.body.visualRadius.max, 0);
    extent = Math.max(extent, reach);
    if (p.body.systemBand !== undefined) {
      extent = Math.max(extent, p.body.systemBand.max + p.body.visualRadius.max);
    }
  }
  for (const belt of system.belts) {
    extent = Math.max(extent, belt.radius.max + BELT_HALF_WIDTH);
  }
  for (const line of system.orbitalLines) {
    const owner =
      line.ownerOrdinal === undefined
        ? undefined
        : placed.find((p) => p.body.ordinal === line.ownerOrdinal);
    extent = Math.max(extent, Math.hypot(owner?.x ?? 0, owner?.y ?? 0) + Math.abs(line.radius));
  }
  return extent;
}

function highlightByPath(
  diagnostics: readonly SolarSystemDiagnostic[]
): Map<string, "definite" | "possible"> {
  const overlapCodes = new Set([
    "body-overlap",
    "template-self-overlap",
    "parent-bound-intersection",
    "belt-body-crossing",
  ]);
  const map = new Map<string, "definite" | "possible">();
  for (const diagnostic of diagnostics) {
    if (!overlapCodes.has(diagnostic.code) || diagnostic.certainty === "unresolved") {
      continue;
    }
    for (const path of diagnostic.paths) {
      if (diagnostic.certainty === "definite" || map.get(path) === undefined) {
        map.set(path, diagnostic.certainty);
      }
    }
  }
  return map;
}

function renderLabels(
  placed: readonly Placed[],
  extent: number,
  font: number,
  minMarker: number
): string[] {
  const parts: string[] = [];
  interface Anchor {
    x: number;
    y: number;
    marker: number;
    text: string;
    ordinal: number;
  }
  const anchors: Anchor[] = [];
  for (const p of placed) {
    const body = p.body;
    if (body.kind === "cursor" || body.copy !== 0) {
      continue;
    }
    let text = body.name ?? body.className ?? body.kind;
    if (body.sizeLabel !== undefined) {
      text += ` · ${body.sizeLabel}`;
    }
    if (body.copies > 1) {
      text += ` ×${body.copies}`;
    }
    const marker = Math.max(body.visualRadius.max, minMarker);
    anchors.push({ x: p.x, y: p.y, marker, text, ordinal: body.ordinal });
  }
  anchors.sort((a, b) => a.ordinal - b.ordinal);
  const used: { x: number; y: number }[] = [];
  const threshold = extent * 0.06;
  for (const anchor of anchors) {
    const dx = anchor.marker + minMarker * 0.8;
    let dy = -(anchor.marker + minMarker * 0.8);
    let tries = 0;
    while (
      used.some((u2) => Math.hypot(anchor.x + dx - u2.x, anchor.y + dy - u2.y) < threshold) &&
      tries < 12
    ) {
      dy += font * 1.3;
      tries += 1;
    }
    const lx = anchor.x + dx;
    const ly = anchor.y + dy;
    used.push({ x: lx, y: ly });
    const start = discEdgeToward(anchor, dx, dy);
    parts.push(
      `<line class="leader" x1="${fmt(start.x)}" y1="${fmt(start.y)}" x2="${fmt(lx)}" y2="${fmt(ly)}"/>`
    );
    parts.push(
      `<text x="${fmt(lx + font * 0.3)}" y="${fmt(ly)}" font-size="${fmt(font)}">${escape(anchor.text)}</text>`
    );
  }
  return parts;
}

function discEdgeToward(
  anchor: { x: number; y: number; marker: number },
  dx: number,
  dy: number
): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  return {
    x: anchor.x + (dx / length) * anchor.marker,
    y: anchor.y + (dy / length) * anchor.marker,
  };
}

function renderLegend(view: number, u: number, font: number): string[] {
  const x = -view + 3 * u;
  let y = -view + 5 * u;
  const parts: string[] = [`<g font-size="${fmt(font)}">`];
  const rows: readonly (readonly [string, string])[] = [
    [`<circle class="body-planet" cx="${fmt(x)}" cy="0" r="${fmt(1.2 * u)}"/>`, "fixed body"],
    [
      `<circle class="ghost" cx="${fmt(x)}" cy="0" r="${fmt(1.2 * u)}"/>`,
      "range or random position",
    ],
    [
      `<circle class="unresolved" cx="${fmt(x)}" cy="0" r="${fmt(1.2 * u)}"/>`,
      "unresolvable position",
    ],
    [
      `<circle class="halo-definite" cx="${fmt(x)}" cy="0" r="${fmt(1.2 * u)}"/>`,
      "definite overlap risk",
    ],
    [
      `<circle class="halo-possible" cx="${fmt(x)}" cy="0" r="${fmt(1.2 * u)}"/>`,
      "possible overlap risk",
    ],
  ];
  for (const [marker, label] of rows) {
    parts.push(
      `<g transform="translate(0 ${fmt(y)})">${marker}<text x="${fmt(x + 3 * u)}" y="${fmt(font * 0.35)}">${label}</text></g>`
    );
    y += font * 1.5;
  }
  parts.push("</g>");
  return parts;
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmt(value: number): string {
  const rounded = Number(value.toFixed(2));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
