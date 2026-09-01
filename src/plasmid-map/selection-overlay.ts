/**
 * Selection overlay: project the current sequence selection (selectedRange /
 * focusedRanges from the store) onto the map as SVG paths — the sequence -> map
 * half of the selection sync (feature -> map is handled by selectedFeatureId).
 *
 * PURE + light: this runs on every selection change, so it must NOT recompute the
 * whole layout. It reuses the already-projected layout's geometry (center, radius,
 * width, length, mode) plus the shared bp-projection helpers. Circular selections
 * draw a calm annular sector over the selected arc; linear selections draw a band
 * on the axis, plus a boundary line at each end carrying the span down to the
 * depth the coordinate gridlines reach. Origin-wrapping circular ranges split into
 * two sectors via normalizeSpan.
 *
 * The circular sector is annular, not a pie slice. A slice drawn from r=0 covers
 * the map's center content — the molecule's name, its length, and the overflow
 * chips — which is exactly what a reader needs to keep reading while dragging a
 * selection across the map. It starts outside `layout.centerLabelRadius` instead.
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

   The band is `span / length * axisWidth`, so on a 2,578 bp record in a 1,316px
   axis one base is 0.51px and a six-base restriction site is 3.1px. That was
   survivable while a 1px accent stroke outlined the band, but the stroke was
   removed because at any readable width the fill alone is clearer and the
   outline was clutter. Below about four bases there was then no fill left to
   see: selecting a single base painted nothing on the map at all, and the only
   evidence of it was the range readout in the corner.

   Measured, light, 1440x900, rasterised over the band: a 1 bp selection read
   1.12:1 against the surface - the surface itself - while a 16 bp selection
   reads 1.26:1 and is unambiguous. Three pixels is enough to paint the full
   1.26:1 fill. */
const LINEAR_SELECTION_MIN_WIDTH = 3;
/** How far past the backbone the sector's outer arc reaches. */
const CIRCULAR_SELECTION_OUTSET = 7;
/** Breathing room between the center content and the sector's inner arc. */
const CIRCULAR_SELECTION_CENTER_GAP = 8;
/**
 * Inner-radius bounds as a share of the outer radius. The floor keeps a visible
 * inner arc when the molecule's name is short enough to need almost no clearance,
 * so the shape stays a band rather than tapering to a point at the center. The cap
 * keeps it a band in the other direction, when a long name pushes the clearance out.
 */
const CIRCULAR_SELECTION_MIN_INNER_FRACTION = 0.2;
const CIRCULAR_SELECTION_MAX_INNER_FRACTION = 0.62;

/**
 * The two radii a circular selection is drawn between. Exported so the sector fill
 * and the radial edge lines drawn over it start and end at the same place — they
 * are separate paths, and a disagreement here shows up as an edge line floating
 * off the shape it bounds.
 */
export function circularSelectionRadii(layout: MapLayout): { inner: number; outer: number } {
  const outer = Math.max(1, layout.radius + CIRCULAR_SELECTION_OUTSET);
  const clearance = (layout.centerLabelRadius ?? 0) + CIRCULAR_SELECTION_CENTER_GAP;
  const inner = Math.min(
    Math.max(clearance, outer * CIRCULAR_SELECTION_MIN_INNER_FRACTION),
    outer * CIRCULAR_SELECTION_MAX_INNER_FRACTION,
  );
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
 * The straight radial edge of a circular selection at one boundary base, as a line
 * from the sector's inner arc to its outer arc. Drawn as its own stroked path over
 * the fill: the fill alone is translucent enough that where a span starts and ends
 * is guesswork, and stroking the whole sector would box in the two arcs as well.
 */
export function circularSelectionEdgePath(layout: MapLayout, bp: number): string {
  const { inner, outer } = circularSelectionRadii(layout);
  const angle = bpToAngle(bp, layout.length);
  const from = pointOnCircle(layout.center.x, layout.center.y, inner, angle);
  const to = pointOnCircle(layout.center.x, layout.center.y, outer, angle);
  return `M ${round(from.x)} ${round(from.y)} L ${round(to.x)} ${round(to.y)}`;
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
 * what the map drew before these lines existed.
 *
 * They are lines and not a filled column on purpose. Everything below the axis —
 * the enzyme names, the feature labels — is text, and a translucent column
 * darkens the ground under all of it. Measured on the built artifact at
 * 1440x900, light, with a 0.16 accent column over a 537 bp selection on pUC19:
 * 12 of the 15 labels in range lost contrast, and the Type IIS enzyme name went
 * 4.725:1 -> 3.743:1, under the 4.5:1 floor that map-typography-contrast pins
 * for it. Thinning the column did not rescue it — 0.10 gave 4.090, 0.05 gave
 * 4.385 — because #ac601c starts 0.22 above the floor and any wash spends that.
 * Two strokes change no text's ground at all, and the span still reads as a
 * column because its edges say where it starts and stops.
 */
export function linearSelectionEdgePaths(layout: MapLayout, bandPath: string): string[] {
  if (layout.mode !== 'linear') return [];
  const extent = coordinateGridExtent(layout);
  if (!extent) return [];
  const match = LINEAR_BAND_PATH.exec(bandPath);
  if (!match) return [];
  const x0 = Number(match[1]);
  const x1 = Number(match[2]);
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return [];
  const top = round(Math.min(layout.center.y - LINEAR_BAND_HALF, extent.top));
  const bottom = round(extent.bottom);
  if (bottom <= round(layout.center.y + LINEAR_BAND_HALF)) return [];
  return [
    `M ${round(x0)} ${top} L ${round(x0)} ${bottom}`,
    `M ${round(x1)} ${top} L ${round(x1)} ${bottom}`,
  ];
}

/**
 * SVG path per drawable selection span. Circular -> annular sector clear of the
 * center content; linear -> a rounded-ish rect band centered on the axis. Empty
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
