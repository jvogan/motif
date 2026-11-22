/**
 * Where to write the name of a selected feature that the circular map draws without
 * one. The map names only a budget of features; a reader who picks one of the others
 * on the ring would get a halo and a wedge and no name beside them, so its name is
 * placed beside it.
 *
 * Pure geometry in one screen space (CSS px, y down). The caller measures the drawing
 * and hands over what the name may not cover; this module never touches the DOM and
 * never moves anything else on the map. The name is placed whole or not at all.
 */
import type { Pt } from './types';

export interface CalloutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectedNameCalloutInput {
  /** The ring's centre. */
  center: Pt;
  /** Direction from the centre to the middle of the feature, in radians. */
  angle: number;
  /** Nearest and farthest the feature's outline comes to the centre. */
  innerRadius: number;
  outerRadius: number;
  /** The ring line. An inside name stays within it; an outside name starts past it. */
  ringRadius: number;
  /** The plate: the whole name plus its padding. */
  width: number;
  height: number;
  /** The selected feature's outline, sampled closer together than the plate is tall. */
  feature: readonly Pt[];
  /** Lines the plate may not cross (the selection's edges, other names' leaders), sampled the same way. */
  lines: readonly Pt[];
  /** Boxes the plate may not touch: every other name and the centre title. */
  names: readonly CalloutBox[];
  /** The visible drawing. The plate lies wholly inside it or is not drawn. */
  bounds: CalloutBox;
}

export interface SelectedNameCallout {
  box: CalloutBox;
  /** From the plate's edge to the feature, when the plate sits more than LEADER_MIN_PX away. */
  leader: readonly [Pt, Pt] | null;
  side: 'inside' | 'outside';
}

/** Space between the feature and a plate set right against it. */
export const CALLOUT_GAP_PX = 3;
/** Space kept between the plate and anything it may not cover. */
export const CALLOUT_CLEARANCE_PX = 2;
/** A plate farther than this from its feature gets a leader to it. */
export const LEADER_MIN_PX = 12;
/** A plate farther than this does not read as the feature's own name. */
export const CALLOUT_MAX_REACH_PX = 72;
const STEP_PX = 3;

interface Candidate {
  offset: number;
  depth: number;
}

/** Offsets along the angle and depths away from the ring, nearest first. */
const CANDIDATES: readonly Candidate[] = (() => {
  const steps = Math.floor(CALLOUT_MAX_REACH_PX / STEP_PX);
  const out: Candidate[] = [];
  for (let d = 0; d <= steps; d += 1) {
    for (let o = 0; o <= steps; o += 1) {
      out.push({ offset: o * STEP_PX, depth: d * STEP_PX });
      if (o > 0) out.push({ offset: -o * STEP_PX, depth: d * STEP_PX });
    }
  }
  // Stable: at equal reach the spot straight in from the feature, then the smaller
  // shift along the angle, comes first.
  return out.sort((a, b) => Math.hypot(a.offset, a.depth) - Math.hypot(b.offset, b.depth));
})();

function boxesTouch(a: CalloutBox, b: CalloutBox, pad: number): boolean {
  return a.x - pad < b.x + b.width
    && b.x < a.x + a.width + pad
    && a.y - pad < b.y + b.height
    && b.y < a.y + a.height + pad;
}

function pointInBox(p: Pt, box: CalloutBox, pad: number): boolean {
  return p.x > box.x - pad && p.x < box.x + box.width + pad && p.y > box.y - pad && p.y < box.y + box.height + pad;
}

function clampToBox(p: Pt, box: CalloutBox): Pt {
  return {
    x: Math.min(Math.max(p.x, box.x), box.x + box.width),
    y: Math.min(Math.max(p.y, box.y), box.y + box.height),
  };
}

function cornerDistances(box: CalloutBox, center: Pt): { near: number; far: number } {
  const xs = [box.x, box.x + box.width];
  const ys = [box.y, box.y + box.height];
  let far = 0;
  for (const x of xs) for (const y of ys) far = Math.max(far, Math.hypot(x - center.x, y - center.y));
  const nearest = clampToBox(center, box);
  return { near: Math.hypot(nearest.x - center.x, nearest.y - center.y), far };
}

function nearestFeaturePoint(box: CalloutBox, feature: readonly Pt[]): { point: Pt; distance: number } {
  let best = feature[0];
  let bestDistance = Infinity;
  for (const p of feature) {
    const q = clampToBox(p, box);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return { point: best, distance: bestDistance };
}

function insideBounds(box: CalloutBox, bounds: CalloutBox): boolean {
  return box.x >= bounds.x
    && box.y >= bounds.y
    && box.x + box.width <= bounds.x + bounds.width
    && box.y + box.height <= bounds.y + bounds.height;
}

function segmentHitsNames(a: Pt, b: Pt, names: readonly CalloutBox[]): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(length / 1.5));
  for (let i = 0; i <= n; i += 1) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    if (names.some((name) => pointInBox(p, name, 1))) return true;
  }
  return false;
}

function placeOnSide(input: SelectedNameCalloutInput, side: 'inside' | 'outside'): SelectedNameCallout | null {
  const { center, angle, width, height } = input;
  const anchorRadius = side === 'inside'
    ? input.innerRadius - CALLOUT_GAP_PX
    : Math.max(input.outerRadius, input.ringRadius) + CALLOUT_GAP_PX;
  if (!(anchorRadius > 0)) return null;
  for (const candidate of CANDIDATES) {
    const radius = side === 'inside' ? anchorRadius - candidate.depth : anchorRadius + candidate.depth;
    if (radius <= 0) continue;
    const theta = angle + candidate.offset / anchorRadius;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    // Where the spoke through the plate's middle leaves the plate: that point sits on
    // `radius`, so the plate faces the feature across the gap. A corner that still
    // reaches the feature is caught below, and the next candidate sits deeper.
    const exit = Math.min(
      Math.abs(ux) > 1e-9 ? width / 2 / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-9 ? height / 2 / Math.abs(uy) : Infinity,
    );
    const reach = side === 'inside' ? radius - exit : radius + exit;
    if (side === 'inside' && reach < 0) continue;
    const anchor = { x: center.x + ux * radius, y: center.y + uy * radius };
    for (const box of plateBoxes(anchor, { x: center.x + ux * reach, y: center.y + uy * reach }, ux, uy, width, height, side)) {
      const placed = check(input, box, side);
      if (placed) return placed;
    }
  }
  return null;
}

/**
 * Plates for one spot on the spoke: centred on the spoke with its edge on the spot
 * first, then hung from the spot by a corner or an edge midpoint, so a long name can
 * lie along the ring's inside instead of only across the spoke. Only plates on the
 * near side of the spot (toward the centre inside the ring, away from it outside).
 */
function plateBoxes(
  anchor: Pt,
  centred: Pt,
  ux: number,
  uy: number,
  width: number,
  height: number,
  side: 'inside' | 'outside',
): CalloutBox[] {
  const boxes: CalloutBox[] = [{ x: centred.x - width / 2, y: centred.y - height / 2, width, height }];
  const hung: { box: CalloutBox; off: number }[] = [];
  for (const x of [anchor.x - width / 2, anchor.x - width, anchor.x]) {
    for (const y of [anchor.y - height / 2, anchor.y - height, anchor.y]) {
      const mx = x + width / 2 - anchor.x;
      const my = y + height / 2 - anchor.y;
      const along = mx * ux + my * uy;
      if (side === 'inside' ? along >= 0 : along <= 0) continue;
      hung.push({ box: { x, y, width, height }, off: Math.abs(mx * uy - my * ux) });
    }
  }
  hung.sort((a, b) => a.off - b.off);
  return boxes.concat(hung.map((entry) => entry.box));
}

function check(input: SelectedNameCalloutInput, box: CalloutBox, side: 'inside' | 'outside'): SelectedNameCallout | null {
  const { center } = input;
  if (!insideBounds(box, input.bounds)) return null;
  const corners = cornerDistances(box, center);
  if (side === 'inside' && corners.far >= input.ringRadius - CALLOUT_CLEARANCE_PX) return null;
  if (side === 'outside' && corners.near <= input.ringRadius + CALLOUT_CLEARANCE_PX) return null;
  if (input.names.some((name) => boxesTouch(box, name, CALLOUT_CLEARANCE_PX))) return null;
  if (input.feature.some((p) => pointInBox(p, box, CALLOUT_CLEARANCE_PX))) return null;
  if (input.lines.some((p) => pointInBox(p, box, CALLOUT_CLEARANCE_PX))) return null;
  const nearest = nearestFeaturePoint(box, input.feature);
  if (nearest.distance > CALLOUT_MAX_REACH_PX) return null;
  let leader: readonly [Pt, Pt] | null = null;
  if (nearest.distance > LEADER_MIN_PX) {
    const start = clampToBox(nearest.point, box);
    if (segmentHitsNames(start, nearest.point, input.names)) return null;
    leader = [start, nearest.point];
  }
  return { box, leader, side };
}

/**
 * Inside the ring first, toward the centre at the feature's mid-angle, then shifted
 * along the angle either way and further in; then just outside the ring the same way.
 * Null when no spot is clean: the status line under the map names the selection.
 */
export function placeSelectedNameCallout(input: SelectedNameCalloutInput): SelectedNameCallout | null {
  if (!(input.width > 0 && input.height > 0) || input.feature.length === 0) return null;
  if (![input.angle, input.innerRadius, input.outerRadius, input.ringRadius].every(Number.isFinite)) return null;
  return placeOnSide(input, 'inside') ?? placeOnSide(input, 'outside');
}
