/**
 * Label geometry for the sequence map: inline-vs-outside decision, deterministic
 * de-collision along a single axis (a vertical column for circular, the horizontal
 * ruler for linear), leader polylines, and text-width estimation.
 *
 * PURE + deterministic: text is measured with a FIXED average glyph advance (no DOM
 * measurement, no canvas), sorts are stable with explicit tie-breakers, and there is
 * no Date.now()/Math.random(). Identical input -> identical output, so layout.ts and
 * its tests can assert exact numbers.
 *
 * Imports only the pure Pt type. layout.ts wires these helpers into the projection.
 */
import type { MapDisplayOptions, Pt } from '../types';

const DEG2RAD = Math.PI / 180;

/** Nominal label font size (px). */
export const LABEL_FONT_PX = 11;
/**
 * Fixed average glyph advance at LABEL_FONT_PX. ~6.2px/char is a deliberate
 * over-estimate for the proportional UI font so an "inline" label never overflows
 * its segment. Scales linearly with font size in approxTextWidth.
 */
export const LABEL_CHAR_WIDTH_PX = 6.2;
/** Monospace labels in high contrast need a conservative advance to avoid HC-only collisions. */
export const LABEL_MONO_CHAR_EM = 0.68;
/** Minimum center-to-center spacing between stacked outside labels (~one line). */
export const LABEL_LINE_HEIGHT_PX = 14;
/** Conservative vertical glyph extent used for radial inline-band clearance. */
export const LABEL_CAP_HEIGHT_PX = 9;
/** Total slack subtracted from a segment's extent before an inline label is allowed. */
export const INLINE_PADDING_PX = 14;

export type LabelFontMode = NonNullable<MapDisplayOptions['labelFontMode']>;

function labelAdvancePx(fontPx: number, mode: LabelFontMode): number {
  return mode === 'monospace' ? fontPx * LABEL_MONO_CHAR_EM : LABEL_CHAR_WIDTH_PX * (fontPx / LABEL_FONT_PX);
}

function inlinePaddingPx(fontPx: number): number {
  return INLINE_PADDING_PX * (fontPx / LABEL_FONT_PX);
}

/** Deterministic text-width estimate. No DOM — fixed advance, linear in font size. */
export function approxTextWidth(
  text: string,
  fontPx: number = LABEL_FONT_PX,
  mode: LabelFontMode = 'proportional',
): number {
  if (!text) return 0;
  return text.length * labelAdvancePx(fontPx, mode);
}

/** Arc length (px) subtended by an angular span (deg) at a given radius. */
export function arcExtentPx(radius: number, angleSpanDeg: number): number {
  return Math.abs(radius) * Math.abs(angleSpanDeg) * DEG2RAD;
}

/**
 * A label is drawn INLINE when its estimated width fits inside the feature's drawn
 * extent (arc length for circular, rect width for linear), minus enough slack for
 * visible end clearance. Otherwise the caller routes it OUTSIDE with a leader.
 */
export function fitsInline(
  text: string,
  extentPx: number,
  fontPx: number = LABEL_FONT_PX,
  mode: LabelFontMode = 'proportional',
  bandThicknessPx: number = Infinity,
): boolean {
  const scaledCapHeight = LABEL_CAP_HEIGHT_PX * (fontPx / LABEL_FONT_PX);
  const radialPad = 3 * (fontPx / LABEL_FONT_PX);
  return (
    approxTextWidth(text, fontPx, mode) + inlinePaddingPx(fontPx) <= extentPx &&
    bandThicknessPx >= scaledCapHeight + radialPad
  );
}

/** One label competing for space along the packing axis. */
export interface AxisLabelItem {
  /** stable identity (feature id / cluster id) for mapping the result back. */
  key: string;
  /** ideal coordinate along the packing axis (y for circular, x for linear). */
  primary: number;
  /** higher priority survives culling; ties broken by key for determinism. */
  priority: number;
}

/** Resolved placement for one AxisLabelItem. */
export interface AxisPlacement {
  /** final coordinate along the packing axis after de-collision. */
  primary: number;
  /** true when culled (not enough room in the band). */
  hidden: boolean;
}

/**
 * Push a set of labels apart to `spacing` along one axis, confined to
 * [band.min, band.max]. When more labels are supplied than physically fit, the
 * LOWEST-priority ones are culled (marked hidden). Selection/hover priority is not
 * known at layout time, so culling is deterministic: priority desc, then key asc.
 *
 * Kept labels are packed with a greedy forward pass from their ideal coordinate,
 * then — if that overflowed the far edge — pulled back inside the band. Because we
 * cull down to the number that fits first, the pull-back always converges.
 *
 * Axis-agnostic: `primary` is a y for the circular column and an x for the linear
 * ruler; the caller supplies the right band + spacing.
 */
export function deCollideAlongAxis(
  items: readonly AxisLabelItem[],
  band: { min: number; max: number },
  spacing: number = LABEL_LINE_HEIGHT_PX,
): Map<string, AxisPlacement> {
  const out = new Map<string, AxisPlacement>();
  if (items.length === 0) return out;

  // Inverted band = zero capacity: hide everything rather than emit out-of-band ys.
  if (band.max < band.min) {
    for (const it of items) out.set(it.key, { primary: it.primary, hidden: true });
    return out;
  }

  const step = spacing > 0 ? spacing : LABEL_LINE_HEIGHT_PX;
  const span = band.max - band.min;
  const maxFit = span <= 0 ? 1 : Math.floor(span / step) + 1;

  let kept: AxisLabelItem[] = items.slice();
  if (items.length > maxFit) {
    const ranked = items
      .slice()
      .sort((a, b) => b.priority - a.priority || cmpKey(a.key, b.key));
    const keepKeys = new Set(ranked.slice(0, Math.max(1, maxFit)).map((i) => i.key));
    for (const it of items) {
      if (!keepKeys.has(it.key)) out.set(it.key, { primary: it.primary, hidden: true });
    }
    kept = items.filter((it) => keepKeys.has(it.key));
  }

  const sorted = kept
    .slice()
    .sort((a, b) => a.primary - b.primary || cmpKey(a.key, b.key));

  const pos: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const ideal = sorted[i].primary;
    pos.push(i === 0 ? Math.max(ideal, band.min) : Math.max(ideal, pos[i - 1] + step));
  }

  // Forward pass may have overflowed the far edge; pull the stack back up.
  const last = pos.length - 1;
  if (last >= 0 && pos[last] > band.max) {
    pos[last] = band.max;
    for (let i = last - 1; i >= 0; i -= 1) pos[i] = Math.min(pos[i], pos[i + 1] - step);
    if (pos[0] < band.min) {
      pos[0] = band.min;
      for (let i = 1; i <= last; i += 1) pos[i] = Math.max(pos[i], pos[i - 1] + step);
    }
  }

  for (let i = 0; i < sorted.length; i += 1) {
    out.set(sorted[i].key, { primary: pos[i], hidden: false });
  }
  return out;
}

/**
 * Leader polyline from an anchor on the ring/axis to a label position. A short
 * horizontal final run of length `stub` into the text reads more cleanly than a
 * bare diagonal; `stub <= 0` (or a degenerate elbow) collapses to a 2-point line.
 */
export function buildLeaderPolyline(anchor: Pt, label: Pt, stub: number = 0): Pt[] {
  if (stub <= 0) return [anchor, label];
  const dir = label.x >= anchor.x ? -1 : 1; // approach text from its leading edge
  const elbow = { x: label.x + dir * stub, y: label.y };
  // Guard against a backwards kink when the anchor already sits past the elbow.
  if ((dir === -1 && elbow.x <= anchor.x) || (dir === 1 && elbow.x >= anchor.x)) {
    return [anchor, label];
  }
  return [anchor, elbow, label];
}

/** Stable string comparator (locale-independent for deterministic output). */
export function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
