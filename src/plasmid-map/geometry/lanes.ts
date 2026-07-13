/**
 * Lane packing — assign overlapping features to concentric lanes (circular) or
 * stacked rows (linear). Works entirely in bp-interval space, so ONE packer
 * serves both projections: a feature's already-normalized (non-wrapping) spans
 * define its occupancy, and two features conflict iff any of their spans overlap.
 *
 * Greedy first-fit by start position -> deterministic, O(n * lanes) which is fine
 * for the practical feature counts a map shows (culling handles the extreme tail).
 * Lane 0 is the outermost ring (circular) / topmost row (linear).
 */
import type { MapSpan } from '../types';

export interface LaneItem {
  id: string;
  spans: readonly MapSpan[];
}

export interface LanePacking {
  /** feature id -> lane index (0 = outermost / topmost). */
  laneById: ReadonlyMap<string, number>;
  /** total number of lanes used. */
  laneCount: number;
}

/** Overlap test for two half-open intervals [a,b) and [c,d). */
function overlaps(a: MapSpan, b: MapSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function conflicts(occupied: readonly MapSpan[], spans: readonly MapSpan[]): boolean {
  for (const o of occupied) {
    for (const s of spans) {
      if (overlaps(o, s)) return true;
    }
  }
  return false;
}

function minStart(item: LaneItem): number {
  let m = Infinity;
  for (const s of item.spans) m = Math.min(m, s.start);
  return m === Infinity ? 0 : m;
}

function maxEnd(item: LaneItem): number {
  let m = -Infinity;
  for (const s of item.spans) m = Math.max(m, s.end);
  return m === -Infinity ? 0 : m;
}

function totalSpanLength(item: LaneItem): number {
  return item.spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0);
}

/**
 * Pack items into lanes. Sorted by start asc, longer total span first, then end
 * asc and id for a stable deterministic layout (important for geometry unit tests
 * and export determinism). Longer parents get the outer/top lane before nested
 * children, matching the reference feature stack behavior.
 * Items with no drawable spans are skipped (not assigned a lane).
 */
export function packLanes(items: readonly LaneItem[]): LanePacking {
  const drawable = items.filter((it) => it.spans.length > 0);
  const sorted = [...drawable].sort(
    (a, b) =>
      minStart(a) - minStart(b) ||
      totalSpanLength(b) - totalSpanLength(a) ||
      maxEnd(a) - maxEnd(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const laneOccupancy: MapSpan[][] = [];
  const laneById = new Map<string, number>();

  for (const item of sorted) {
    let lane = 0;
    while (lane < laneOccupancy.length && conflicts(laneOccupancy[lane], item.spans)) {
      lane += 1;
    }
    if (!laneOccupancy[lane]) laneOccupancy[lane] = [];
    laneOccupancy[lane].push(...item.spans);
    laneById.set(item.id, lane);
  }

  return { laneById, laneCount: laneOccupancy.length };
}
