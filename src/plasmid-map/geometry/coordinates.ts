/**
 * Coordinate helpers for both map projections.
 *
 * Circular convention (matches Benchling / SeqViz): base 0 sits at 12 o'clock
 * (top) and increasing bp runs CLOCKWISE. Angles are measured in degrees
 * clockwise from top. SVG y grows downward, so the standard trig below produces a
 * clockwise sweep without any sign flips beyond the -90deg "top" shift.
 *
 * Pure functions, reimplemented from SeqViz's MIT geometry (findCoor / genArc /
 * rotateCoor) against Motif's own model — no code copied.
 */

export interface Point {
  x: number;
  y: number;
}

const DEG2RAD = Math.PI / 180;

/** bp -> degrees clockwise from 12 o'clock. base 0 -> 0deg, length/4 -> 90deg. */
export function bpToAngle(bp: number, length: number): number {
  if (length <= 0) return 0;
  return (bp / length) * 360;
}

/**
 * Point on a circle at `angleDeg` measured clockwise from the top (12 o'clock).
 * angle 0 -> (cx, cy-r) top; 90 -> (cx+r, cy) right (3 o'clock); 180 -> bottom.
 */
export function pointOnCircle(cx: number, cy: number, r: number, angleDeg: number): Point {
  const rad = (angleDeg - 90) * DEG2RAD;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Convenience: point on the circle directly from a bp position. */
export function pointForBp(
  cx: number,
  cy: number,
  r: number,
  bp: number,
  length: number,
): Point {
  return pointOnCircle(cx, cy, r, bpToAngle(bp, length));
}

/**
 * SVG path for an annular arc band (a feature arc) between innerR and outerR,
 * sweeping CLOCKWISE from startAngle to endAngle (both degrees-from-top).
 * The outer edge is drawn clockwise, the inner edge back counter-clockwise.
 */
export function describeArcBand(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  // A full (or over) sweep collapses to nothing with a single SVG arc because the
  // start and end points coincide. Split into two closed half-bands so a
  // whole-plasmid feature (or a path-drawn backbone) still renders as a ring.
  if (Math.abs(sweep) >= 360) {
    const mid = startAngle + 180;
    return `${describeArcBand(cx, cy, innerR, outerR, startAngle, mid)} ${describeArcBand(cx, cy, innerR, outerR, mid, endAngle)}`;
  }
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const outerStart = pointOnCircle(cx, cy, outerR, startAngle);
  const outerEnd = pointOnCircle(cx, cy, outerR, endAngle);
  const innerEnd = pointOnCircle(cx, cy, innerR, endAngle);
  const innerStart = pointOnCircle(cx, cy, innerR, startAngle);
  return [
    `M ${round(outerStart.x)} ${round(outerStart.y)}`,
    `A ${round(outerR)} ${round(outerR)} 0 ${largeArc} 1 ${round(outerEnd.x)} ${round(outerEnd.y)}`,
    `L ${round(innerEnd.x)} ${round(innerEnd.y)}`,
    `A ${round(innerR)} ${round(innerR)} 0 ${largeArc} 0 ${round(innerStart.x)} ${round(innerStart.y)}`,
    'Z',
  ].join(' ');
}

/**
 * SVG path for a directional feature's terminal annular segment. The 3' end is
 * folded into the same closed band path as a tapered point: forward features
 * point at endAngle+tipDeltaDeg, reverse features at startAngle+tipDeltaDeg.
 */
export function describeCircularFeatureArrowBand(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
  tipDeltaDeg: number,
  direction: 1 | -1,
): string {
  const sweep = endAngle - startAngle;
  const outerSweep = sweep >= 0 ? 1 : 0;
  const innerSweep = sweep >= 0 ? 0 : 1;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const midAngle = startAngle + sweep / 2;
  const fullSweep = Math.abs(sweep) >= 360;
  const outerStart = pointOnCircle(cx, cy, outerR, startAngle);
  const outerEnd = pointOnCircle(cx, cy, outerR, endAngle);
  const innerEnd = pointOnCircle(cx, cy, innerR, endAngle);
  const innerStart = pointOnCircle(cx, cy, innerR, startAngle);
  const outerMid = pointOnCircle(cx, cy, outerR, midAngle);
  const innerMid = pointOnCircle(cx, cy, innerR, midAngle);
  const baseAngle = direction === 1 ? endAngle : startAngle;
  const tip = pointOnCircle(cx, cy, (innerR + outerR) / 2, baseAngle + tipDeltaDeg);

  const outerArcCommands = fullSweep
    ? [
        `A ${round(outerR)} ${round(outerR)} 0 0 ${outerSweep} ${round(outerMid.x)} ${round(outerMid.y)}`,
        `A ${round(outerR)} ${round(outerR)} 0 0 ${outerSweep} ${round(outerEnd.x)} ${round(outerEnd.y)}`,
      ]
    : [`A ${round(outerR)} ${round(outerR)} 0 ${largeArc} ${outerSweep} ${round(outerEnd.x)} ${round(outerEnd.y)}`];
  const innerArcCommands = fullSweep
    ? [
        `A ${round(innerR)} ${round(innerR)} 0 0 ${innerSweep} ${round(innerMid.x)} ${round(innerMid.y)}`,
        `A ${round(innerR)} ${round(innerR)} 0 0 ${innerSweep} ${round(innerStart.x)} ${round(innerStart.y)}`,
      ]
    : [`A ${round(innerR)} ${round(innerR)} 0 ${largeArc} ${innerSweep} ${round(innerStart.x)} ${round(innerStart.y)}`];

  if (direction === 1) {
    return [
      `M ${round(outerStart.x)} ${round(outerStart.y)}`,
      ...outerArcCommands,
      `L ${round(tip.x)} ${round(tip.y)}`,
      `L ${round(innerEnd.x)} ${round(innerEnd.y)}`,
      ...innerArcCommands,
      'Z',
    ].join(' ');
  }

  return [
    `M ${round(outerStart.x)} ${round(outerStart.y)}`,
    ...outerArcCommands,
    `L ${round(innerEnd.x)} ${round(innerEnd.y)}`,
    ...innerArcCommands,
    `L ${round(tip.x)} ${round(tip.y)}`,
    'Z',
  ].join(' ');
}

/**
 * SVG path for a directional feature's terminal linear segment. The 3' end is a
 * point in the same closed path; the 5' end keeps the usual rounded corners.
 */
export function describeLinearFeatureArrowPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  direction: 1 | -1,
  arrowLenPx: number,
): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const tipLen = Math.max(0, arrowLenPx);
  if (direction === 1) {
    const baseX = x + w;
    const tipX = baseX + tipLen;
    return [
      `M ${round(x + rr)} ${round(y)}`,
      `H ${round(baseX)}`,
      `L ${round(tipX)} ${round(y + h / 2)}`,
      `L ${round(baseX)} ${round(y + h)}`,
      `H ${round(x + rr)}`,
      `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x)} ${round(y + h - rr)}`,
      `V ${round(y + rr)}`,
      `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x + rr)} ${round(y)}`,
      'Z',
    ].join(' ');
  }

  const baseX = x;
  const tipX = baseX - tipLen;
  return [
    `M ${round(baseX)} ${round(y)}`,
    `H ${round(x + w - rr)}`,
    `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x + w)} ${round(y + rr)}`,
    `V ${round(y + h - rr)}`,
    `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x + w - rr)} ${round(y + h)}`,
    `H ${round(baseX)}`,
    `L ${round(tipX)} ${round(y + h / 2)}`,
    'Z',
  ].join(' ');
}

/**
 * SVG path for a single arc line (a coordinate ring or a thin tick track) at a
 * fixed radius, sweeping clockwise from startAngle to endAngle.
 */
export function describeArcLine(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  // Full circle: two half-arcs so a 0..360 ring (backbone) does not collapse.
  if (Math.abs(sweep) >= 360) {
    const mid = startAngle + 180;
    return `${describeArcLine(cx, cy, r, startAngle, mid)} ${describeArcLine(cx, cy, r, mid, endAngle)}`;
  }
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const start = pointOnCircle(cx, cy, r, startAngle);
  const end = pointOnCircle(cx, cy, r, endAngle);
  return `M ${round(start.x)} ${round(start.y)} A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${round(end.x)} ${round(end.y)}`;
}

/**
 * Text anchor + upright hint for an outside label at a given angle, so labels on
 * the right half read start-anchored and the left half end-anchored (leaders point
 * inward). Matches Benchling's outside-label behaviour.
 */
export function labelSideForAngle(angleDeg: number): 'start' | 'end' {
  const a = ((angleDeg % 360) + 360) % 360;
  // Right half (top through bottom, 0..180) anchors text at its start.
  return a <= 180 ? 'start' : 'end';
}

// ----- Linear projection -----

/** bp -> x coordinate along a horizontal axis spanning [x0, x0+width]. */
export function bpToX(bp: number, length: number, x0: number, width: number): number {
  if (length <= 0) return x0;
  return x0 + (bp / length) * width;
}

/** Round to 3 decimals to keep SVG paths compact and layout output deterministic. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
