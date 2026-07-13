/**
 * Selection overlay: project the current sequence selection (selectedRange /
 * focusedRanges from the store) onto the map as SVG paths — the sequence -> map
 * half of the selection sync (feature -> map is handled by selectedFeatureId).
 *
 * PURE + light: this runs on every selection change, so it must NOT recompute the
 * whole layout. It reuses the already-projected layout's geometry (center, radius,
 * width, length, mode) plus the shared bp-projection helpers. Circular selections
 * draw a calm radial sector from the map center out to the selected arc; linear
 * selections draw a band on the axis. Origin-wrapping circular ranges split into
 * two sectors via normalizeSpan.
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
const CIRCULAR_SELECTION_OUTSET = 7;

function describeCircularSelectionSector(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (Math.abs(sweep) >= 360) {
    const mid = startAngle + 180;
    return `${describeCircularSelectionSector(cx, cy, radius, startAngle, mid)} ${describeCircularSelectionSector(cx, cy, radius, mid, endAngle)}`;
  }
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const outerStart = pointOnCircle(cx, cy, radius, startAngle);
  const outerEnd = pointOnCircle(cx, cy, radius, endAngle);
  return [
    `M ${round(cx)} ${round(cy)}`,
    `L ${round(outerStart.x)} ${round(outerStart.y)}`,
    `A ${round(radius)} ${round(radius)} 0 ${largeArc} 1 ${round(outerEnd.x)} ${round(outerEnd.y)}`,
    'Z',
  ].join(' ');
}

/**
 * SVG path per drawable selection span. Circular -> radial sector behind the map;
 * linear -> a rounded-ish rect band centered on the axis. Empty when there is no
 * selection, the molecule is degenerate, or every range normalizes away.
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
        const radius = Math.max(1, layout.radius + CIRCULAR_SELECTION_OUTSET);
        out.push(
          describeCircularSelectionSector(
            layout.center.x,
            layout.center.y,
            radius,
            bpToAngle(s.start, length),
            bpToAngle(s.end, length),
          ),
        );
      } else {
        const padX = layout.center.x;
        const axisWidth = Math.max(1, layout.width - 2 * padX);
        const x0 = bpToX(s.start, length, padX, axisWidth);
        const x1 = bpToX(s.end, length, padX, axisWidth);
        const yTop = round(layout.center.y - LINEAR_BAND_HALF);
        const yBot = round(layout.center.y + LINEAR_BAND_HALF);
        out.push(`M ${round(x0)} ${yTop} L ${round(x1)} ${yTop} L ${round(x1)} ${yBot} L ${round(x0)} ${yBot} Z`);
      }
    }
  }
  return out;
}
