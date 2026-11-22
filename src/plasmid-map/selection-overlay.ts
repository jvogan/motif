/**
 * Selection overlay: project the current sequence selection (selectedRange /
 * focusedRanges from the store) onto the map as SVG paths — the sequence -> map
 * half of the selection sync (feature -> map is handled by selectedFeatureId).
 *
 * PURE + light: this runs on every selection change, so it must NOT recompute the
 * whole layout. It reuses the already-projected layout's geometry (center, radius,
 * width, length, mode) plus the shared bp-projection helpers. Circular selections
 * draw a wedge over the selected arc (below); linear selections draw a band on the
 * axis, plus a boundary line at each end carrying the span down to the depth the
 * coordinate gridlines reach. Origin-wrapping circular ranges split into two wedges
 * via normalizeSpan.
 *
 * The circular selection is a wedge: from a third of the ring's radius (deeper where
 * the feature lanes pack deeper, never into the centre title's clear zone) out to
 * a few px beyond the ring, under a light wash so every arrow, name, tick and
 * numeral in it stays readable. One thin radial line marks each end, capped just
 * outside the ring by a small filled triangle pointing inward. The wash is light,
 * not an opaque band confined to the ruler, which would hide the numerals under it.
 */
import type { MapLayout } from './types';
import { bpToAngle, bpToX, pointOnCircle, round } from './geometry/coordinates';
import { normalizeSpan } from './geometry/ranges';

export interface SelectionRange {
  start: number;
  end: number;
}

/** Half-height (px) of the linear selection band around the axis. */
const LINEAR_BAND_HALF = 9;

/* The narrowest a linear selection band may be drawn.

   The band is `span / length * axisWidth`, so on a 2,686 bp record in a 1,316px
   axis one base is 0.49px and a six-base restriction site is 2.9px. That was
   survivable while a 1px accent stroke outlined the band, but the stroke was
   removed because at any readable width the fill alone is clearer and the
   outline was clutter. Below about four bases there was then no fill left to
   see: selecting a single base painted nothing on the map at all, and the only
   evidence of it was the range readout in the corner.

   Measured, light, 1440x900, rasterised over the band: a 1 bp selection read
   1.12:1 against the surface - the surface itself - while a 16 bp selection
   reads 1.26:1 and is unambiguous. Three pixels is enough to paint the full
   fill, which the 0.14 tint draws at 1.22:1 (computed, light). */
const LINEAR_SELECTION_MIN_WIDTH = 3;
/** Closer than this (a linear map draws at scale 1, so this is screen px), a
 * span's two edge lines read as one heavy bar, so it draws one. */
const LINEAR_SELECTION_SINGLE_EDGE_WIDTH = 4;
/** How far past the backbone the band's outer arc reaches, so the tint shows on both
 * sides of the ring line instead of stopping exactly under it. */
const CIRCULAR_SELECTION_OUTSET = 4;
/** How far inside the innermost feature lane the wedge's inner arc starts, on a
 * record whose lanes pack deeper than the wedge's usual reach. */
const CIRCULAR_SELECTION_LANE_GAP = 3;
/** Where the wedge's inner arc sits, as a share of the ring's radius: a third of
 * the way out from the centre. The wedge then reads as a slice of the map, and
 * its two boundary lines have two thirds of the radius to fade over. */
const CIRCULAR_SELECTION_REACH_FRACTION = 1 / 3;
/** Clearance kept between the wedge and the centre title's clear disc. */
const CIRCULAR_SELECTION_CENTER_GAP = 4;
/** The boundary marker: a filled triangle this tall (layout units, about 8px on
 * screen at the ring's usual scale) whose tip touches the wedge's outer arc. */
const CIRCULAR_SELECTION_MARKER_HEIGHT = 9;
/** Half the marker's base, across the boundary line. */
const CIRCULAR_SELECTION_MARKER_HALF = 5;
/** Inner radius, as a share of the ring, for a layout that does not publish its
 * feature lanes: the band then keeps the ruler's usual depth. */
const CIRCULAR_SELECTION_FALLBACK_INNER_FRACTION = 0.88;

/**
 * The two radii a circular selection is drawn between. Exported so the band fill
 * and the radial edge lines drawn over it start and end at the same place — they
 * are separate paths, and a disagreement here shows up as an edge line floating
 * off the shape it bounds.
 */
export function circularSelectionRadii(layout: MapLayout): { inner: number; outer: number } {
  const ring = Math.max(1, layout.radius);
  const outer = ring + CIRCULAR_SELECTION_OUTSET;
  const lanes = layout.featureLaneInnerRadius ?? layout.featureLaneOuterRadius;
  const laneEdge = lanes !== undefined && Number.isFinite(lanes) && lanes > 0 && lanes < ring
    ? lanes - CIRCULAR_SELECTION_LANE_GAP
    : ring * CIRCULAR_SELECTION_FALLBACK_INNER_FRACTION;
  // Never into the centre title's clear disc, however deep the lanes pack.
  const title = layout.centerLabelRadius;
  const floor = title !== undefined && Number.isFinite(title) && title > 0
    ? title + CIRCULAR_SELECTION_CENTER_GAP
    : 0;
  // Past the lanes toward the centre, and deeper still where the lanes are.
  const reach = Math.min(laneEdge, ring * CIRCULAR_SELECTION_REACH_FRACTION);
  // At least a pixel of wedge, however tightly a crowded record packs its lanes.
  const inner = Math.min(Math.max(reach, floor), ring - 1);
  return { inner, outer };
}

function describeCircularSelectionSector(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (Math.abs(sweep) >= 360) {
    const mid = startAngle + 180;
    return [
      describeCircularSelectionSector(cx, cy, innerRadius, outerRadius, startAngle, mid),
      describeCircularSelectionSector(cx, cy, innerRadius, outerRadius, mid, endAngle),
    ].join(' ');
  }
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const outerStart = pointOnCircle(cx, cy, outerRadius, startAngle);
  const outerEnd = pointOnCircle(cx, cy, outerRadius, endAngle);
  if (innerRadius <= 0) {
    return [
      `M ${round(cx)} ${round(cy)}`,
      `L ${round(outerStart.x)} ${round(outerStart.y)}`,
      `A ${round(outerRadius)} ${round(outerRadius)} 0 ${largeArc} 1 ${round(outerEnd.x)} ${round(outerEnd.y)}`,
      'Z',
    ].join(' ');
  }
  const innerStart = pointOnCircle(cx, cy, innerRadius, startAngle);
  const innerEnd = pointOnCircle(cx, cy, innerRadius, endAngle);
  return [
    `M ${round(innerStart.x)} ${round(innerStart.y)}`,
    `L ${round(outerStart.x)} ${round(outerStart.y)}`,
    `A ${round(outerRadius)} ${round(outerRadius)} 0 ${largeArc} 1 ${round(outerEnd.x)} ${round(outerEnd.y)}`,
    `L ${round(innerEnd.x)} ${round(innerEnd.y)}`,
    `A ${round(innerRadius)} ${round(innerRadius)} 0 ${largeArc} 0 ${round(innerStart.x)} ${round(innerStart.y)}`,
    'Z',
  ].join(' ');
}

/**
 * The straight radial edge of a circular selection at one boundary base: a line
 * from the wedge's inner arc to its outer arc, then a closed triangle whose tip
 * meets the line's outer end and whose base sits just outside the ring. Drawn as
 * one path over the fill, stroked and filled in the text colour: the line has no
 * area, so the fill paints only the triangle. Stroking the whole wedge would box
 * in its two arcs as well.
 */
export function circularSelectionEdgePath(layout: MapLayout, bp: number): string {
  const { inner, outer } = circularSelectionRadii(layout);
  const angle = bpToAngle(bp, layout.length);
  const { x: cx, y: cy } = layout.center;
  const from = pointOnCircle(cx, cy, inner, angle);
  const to = pointOnCircle(cx, cy, outer, angle);
  const baseR = outer + CIRCULAR_SELECTION_MARKER_HEIGHT;
  const base = pointOnCircle(cx, cy, baseR, angle);
  // The base runs across the radius: offset along the tangent at the base point.
  const tx = (base.y - cy) / baseR;
  const ty = -(base.x - cx) / baseR;
  const h = CIRCULAR_SELECTION_MARKER_HALF;
  return [
    `M ${round(from.x)} ${round(from.y)} L ${round(to.x)} ${round(to.y)}`,
    `M ${round(to.x)} ${round(to.y)}`,
    `L ${round(base.x + tx * h)} ${round(base.y + ty * h)}`,
    `L ${round(base.x - tx * h)} ${round(base.y - ty * h)} Z`,
  ].join(' ');
}

/**
 * The vertical extent the coordinate gridlines occupy, from the ticks that carry
 * one. Returns null when no tick has a grid — a linear layout built before the
 * gridlines existed, or a circular one, where the ticks carry none.
 */
export function coordinateGridExtent(layout: MapLayout): { top: number; bottom: number } | null {
  let top = Infinity;
  let bottom = -Infinity;
  for (const coord of layout.coordinates) {
    const grid = coord.grid;
    if (!grid) continue;
    top = Math.min(top, grid.y1, grid.y2);
    bottom = Math.max(bottom, grid.y1, grid.y2);
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null;
  return { top, bottom };
}

/* The band path emitted below, read back. Anchored at both ends so a circular
   sector — which starts with the same `M x y` — cannot match. */
const LINEAR_BAND_PATH =
  /^M (-?[\d.]+) -?[\d.]+ L (-?[\d.]+) -?[\d.]+ L -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+ Z$/;

/**
 * The two boundary lines of a linear selection, each running from the top of the
 * band down to where the coordinate gridlines stop. Empty for a circular layout,
 * for a layout whose ticks carry no grid, and for any path this module did not
 * emit as a band; a caller that gets nothing back draws the band alone, which is
 * what the map draws without these lines.
 *
 * A heavier filled column would fail: with the tan Type IIS enzyme name under it
 * (#ac601c, 0.22 above its 4.5:1 floor), a 0.16 column takes it to 3.743:1 and
 * even 0.05 to 4.385. The wash is 0.06, and linearSelectionColumnPath
 * (below) draws it over these lines' extent.
 */
export function linearSelectionEdgePaths(
  layout: MapLayout,
  bandPath: string,
  /** `band` stops each line at the ruler band: a selected feature's own outline
   * already says which row it is, so the lines need not cross every lane. */
  reach: 'grid' | 'band' = 'grid',
): string[] {
  if (layout.mode !== 'linear') return [];
  const extent = coordinateGridExtent(layout);
  if (!extent) return [];
  const match = LINEAR_BAND_PATH.exec(bandPath);
  if (!match) return [];
  const x0 = Number(match[1]);
  const x1 = Number(match[2]);
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return [];
  const xs = x1 - x0 < LINEAR_SELECTION_SINGLE_EDGE_WIDTH ? [(x0 + x1) / 2] : [x0, x1];
  if (reach === 'band') {
    const bandTop = round(layout.center.y - LINEAR_BAND_HALF);
    const bandBottom = round(layout.center.y + LINEAR_BAND_HALF);
    return xs.map((x) => `M ${round(x)} ${bandTop} L ${round(x)} ${bandBottom}${linearSelectionMarker(layout, x)}`);
  }
  const top = round(Math.min(layout.center.y - LINEAR_BAND_HALF, extent.top));
  const bottom = round(extent.bottom);
  if (bottom <= round(layout.center.y + LINEAR_BAND_HALF)) return [];
  return xs.map((x) => `M ${round(x)} ${top} L ${round(x)} ${bottom}${linearSelectionMarker(layout, x)}`);
}

/**
 * A linear selection's wash as one column over the extent its boundary lines
 * span, so the selected stretch reads as the circular map's wedge does rather
 * than as two loose lines. Where the lines stop at the band, or are not drawn,
 * the column is the band itself. The x and the path shape are kept, so
 * linearSelectionEdgePaths reads the same lines back from the column.
 * The wash is 0.06 accent: every feature name and ruler label under it keeps 90%
 * or more of its contrast.
 */
export function linearSelectionColumnPath(
  layout: MapLayout,
  bandPath: string,
  reach: 'grid' | 'band' = 'grid',
): string {
  if (reach === 'band') return bandPath;
  const edges = linearSelectionEdgePaths(layout, bandPath, reach);
  const match = LINEAR_BAND_PATH.exec(bandPath);
  if (edges.length === 0 || !match) return bandPath;
  const ys = edges[0].match(/-?[\d.]+/g)!.map(Number).filter((_, index) => index % 2 === 1).slice(0, 2);
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const [x0, x1] = [match[1], match[2]];
  return `M ${x0} ${top} L ${x1} ${top} L ${x1} ${bottom} L ${x0} ${bottom} Z`;
}

/** A selection's boundary lines keep full strength at the backbone and fade to
 * this opacity at their far end; the wash eases to this share of its own. */
export const SELECTION_EDGE_FADE_END = 0.15;
export const SELECTION_WASH_FADE_END = 0.5;
/** The circular wash eases further, to the share its lines end at. Its inner arc
 * sits a third of the way out from the centre, in open canvas, and at half
 * strength the wash would stop there in a visible edge against the bare canvas:
 * 1.04:1 in Light and 1.09:1 in Dark. At this share
 * the step is 1.01:1 and 1.02:1, and the wash dissolves. */
export const CIRCULAR_SELECTION_WASH_FADE_END = 0.15;

export interface SelectionFadeStop { offset: number; opacity: number }
export type SelectionFadeGradient =
  | { kind: 'radial'; cx: number; cy: number; r: number; stops: SelectionFadeStop[] }
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number; stops: SelectionFadeStop[] };

const fadeOffset = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000;

/**
 * The user-space gradients a map selection's boundary lines and wash fade along,
 * away from the backbone. Circular: one radial gradient on the map centre, so it
 * runs along every radial end line at once, solid from the ring out (the marker
 * sits outside it). Linear: a vertical gradient from the backbone down to where
 * the lines end, solid over the band above and over the marker below. Null when
 * a linear layout draws no full-depth lines.
 */
export function selectionFadeGradients(
  layout: MapLayout,
): { edge: SelectionFadeGradient; wash: SelectionFadeGradient } | null {
  if (layout.mode === 'circular') {
    const { inner } = circularSelectionRadii(layout);
    const ring = Math.max(1, layout.radius);
    const r = round(ring + CIRCULAR_SELECTION_OUTSET + CIRCULAR_SELECTION_MARKER_HEIGHT);
    const radial = (end: number): SelectionFadeGradient => ({
      kind: 'radial', cx: round(layout.center.x), cy: round(layout.center.y), r,
      stops: [{ offset: fadeOffset(inner / r), opacity: end }, { offset: fadeOffset(ring / r), opacity: 1 }],
    });
    return { edge: radial(SELECTION_EDGE_FADE_END), wash: radial(CIRCULAR_SELECTION_WASH_FADE_END) };
  }
  const extent = coordinateGridExtent(layout);
  if (!extent) return null;
  const y1 = round(layout.center.y);
  const y2 = round(extent.bottom);
  if (y2 <= y1 + CIRCULAR_SELECTION_MARKER_HEIGHT) return null;
  const linear = (stops: SelectionFadeStop[]): SelectionFadeGradient => ({ kind: 'linear', x1: 0, y1, x2: 0, y2, stops });
  return {
    edge: linear([
      { offset: 0, opacity: 1 },
      { offset: fadeOffset(CIRCULAR_SELECTION_MARKER_HEIGHT / (y2 - y1)), opacity: 1 },
      { offset: 1, opacity: SELECTION_EDGE_FADE_END },
    ]),
    wash: linear([{ offset: 0, opacity: 1 }, { offset: 1, opacity: SELECTION_WASH_FADE_END }]),
  };
}

/** One gradient as SVG markup, for an export with no stylesheet. */
export function selectionFadeGradientSvg(gradient: SelectionFadeGradient, id: string, color: string): string {
  const stops = gradient.stops
    .map((stop) => `<stop offset="${stop.offset}" stop-color="${color}" stop-opacity="${stop.opacity}"/>`)
    .join('');
  return gradient.kind === 'radial'
    ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${gradient.cx}" cy="${gradient.cy}" r="${gradient.r}">${stops}</radialGradient>`
    : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}">${stops}</linearGradient>`;
}

/* The circular marker's triangle, where a linear boundary line crosses the
   backbone: its tip on the backbone, its base at the bottom of the band, pointing
   up at the backbone. The same 9 by 10 units as the ring's, and inside the band,
   so it adds nothing to the line's extent. Below, not above: the ruler numerals
   end 7px above the backbone (measured, 1440x900), and nothing but the 5px
   coordinate ticks sits in the 10px under it. */
function linearSelectionMarker(layout: MapLayout, x: number): string {
  const tip = round(layout.center.y);
  const base = round(layout.center.y + CIRCULAR_SELECTION_MARKER_HEIGHT);
  const h = CIRCULAR_SELECTION_MARKER_HALF;
  return ` M ${round(x)} ${tip} L ${round(x - h)} ${base} L ${round(x + h)} ${base} Z`;
}

/**
 * SVG path per drawable selection span. Circular -> a wedge from a third of the
 * ring's radius to just beyond the ring; linear -> a rect band centered on the axis. Empty
 * when there is no selection, the molecule is degenerate, or every range
 * normalizes away.
 */
export function selectionOverlayPaths(
  layout: MapLayout,
  ranges: readonly SelectionRange[],
): string[] {
  const length = layout.length;
  if (ranges.length === 0 || length <= 0) return [];
  const out: string[] = [];
  for (const r of ranges) {
    const spans = normalizeSpan(r.start, r.end, length, layout.topology);
    for (const s of spans) {
      if (layout.mode === 'circular') {
        const { inner, outer } = circularSelectionRadii(layout);
        out.push(
          describeCircularSelectionSector(
            layout.center.x,
            layout.center.y,
            inner,
            outer,
            bpToAngle(s.start, length),
            bpToAngle(s.end, length),
          ),
        );
      } else {
        const padX = layout.center.x;
        const axisWidth = Math.max(1, layout.width - 2 * padX);
        const rawX0 = bpToX(s.start, length, padX, axisWidth);
        const rawX1 = bpToX(s.end, length, padX, axisWidth);
        // Widened around its own centre, so a mark that had to grow still sits
        // where the selection is, then held inside the axis so a selection at
        // either end does not hang off the drawing.
        let x0 = rawX0;
        let x1 = rawX1;
        if (x1 - x0 < LINEAR_SELECTION_MIN_WIDTH) {
          const axisEnd = padX + axisWidth;
          const center = (rawX0 + rawX1) / 2;
          const half = LINEAR_SELECTION_MIN_WIDTH / 2;
          x0 = Math.min(Math.max(center - half, padX), Math.max(padX, axisEnd - LINEAR_SELECTION_MIN_WIDTH));
          x1 = x0 + LINEAR_SELECTION_MIN_WIDTH;
        }
        const yTop = round(layout.center.y - LINEAR_BAND_HALF);
        const yBot = round(layout.center.y + LINEAR_BAND_HALF);
        out.push(`M ${round(x0)} ${yTop} L ${round(x1)} ${yTop} L ${round(x1)} ${yBot} L ${round(x0)} ${yBot} Z`);
      }
    }
  }
  return out;
}
