/**
 * Biological range normalization for the map: subranges and origin-wrap resolved
 * into non-wrapping drawable segments. This is the single source of truth both
 * renderers and the selection sync use, so map / sequence / inspector agree.
 *
 * Convention (from the workbench plan): a circular range with `end <= start`
 * wraps the origin and splits into `start..length` + `0..end`. When a feature has
 * `subRanges`, those are authoritative (the aggregate start/end of an
 * origin-crossing join is misleading, e.g. join(2500..2578,1..100) -> start 0,
 * end 2578 spans almost the whole plasmid).
 */
import type { Feature, Topology } from '../../bio/types';
import type { MapSpan, MapFeatureSegment, FeatureSelectionRanges } from '../types';

/**
 * Split a [start, end) range into non-wrapping spans clamped to [0, length).
 * - linear: clamp to bounds; drop if empty.
 * - circular, end > start: single clamped span.
 * - circular, end <= start: origin wrap -> [start..length, 0..end].
 * - circular, end > length: modulo wrap -> [start..length, 0..(end-length)].
 */
export function normalizeSpan(
  start: number,
  end: number,
  length: number,
  topology: Topology,
): MapSpan[] {
  // Reject a non-finite/degenerate length up front — `NaN <= 0` is false, so a NaN
  // length would otherwise slip through and poison every downstream bp projection.
  if (!Number.isFinite(length) || length <= 0) return [];
  // Reject corrupt offsets outright so a NaN/Infinity can never propagate into a
  // NaN SVG path (matches the detail view dropping non-finite feature offsets).
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  if (topology === 'linear') {
    // Clamp each endpoint independently and drop if the result is empty, so an
    // out-of-bounds/reversed range (e.g. 150..-50 on a 100bp molecule) is
    // dropped rather than silently "corrected" into a full-length span.
    const s = clamp(start, 0, length);
    const e = clamp(end, 0, length);
    return e > s ? [{ start: s, end: e }] : [];
  }

  // circular — interpret [start, end) as a span of length (end - start), applying
  // the "end <= start means the span wraps the origin" convention, then normalize
  // both endpoints modulo length so negative or >= length coordinates resolve
  // correctly (e.g. -10..10 and 110..140 on a 100bp circle).
  const s = mod(start, length);
  const rawLen = end - start;
  const spanLen = rawLen < 0 ? rawLen + length : rawLen; // wrap convention for end < start
  if (spanLen <= 0) return []; // zero-length / degenerate
  if (spanLen >= length) return [{ start: 0, end: length }]; // full circle
  const e = s + spanLen;
  if (e <= length) return [{ start: s, end: e }];
  return [
    { start: s, end: length }, // tail: s..length
    { start: 0, end: e - length }, // head past the origin
  ];
}

/**
 * All drawable segments of a feature in biological/import order, honoring
 * subRanges (authoritative when present) and origin wrap. `isStart`/`isEnd` mark
 * the biologically-first/last segments (layout folds the strand point into
 * `isEnd` for forward, `isStart` for reverse, none for directionless).
 */
export function featureSegments(
  feature: Pick<Feature, 'start' | 'end' | 'subRanges'>,
  length: number,
  topology: Topology,
): MapFeatureSegment[] {
  const raw = featureSpans(feature, length, topology);
  return raw.map((span, i) => ({
    ...span,
    isStart: i === 0,
    isEnd: i === raw.length - 1,
  }));
}

/** Bare spans (no start/end flags) for a feature, biological/import order. */
export function featureSpans(
  feature: Pick<Feature, 'start' | 'end' | 'subRanges'>,
  length: number,
  topology: Topology,
): MapSpan[] {
  const sub = feature.subRanges?.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end));
  if (sub && sub.length > 0) {
    // subRanges are authoritative and kept in stored (import/biological) order.
    return sub.flatMap((r) => normalizeSpan(r.start, r.end, length, topology));
  }
  return normalizeSpan(feature.start, feature.end, length, topology);
}

/**
 * Map-owned multi-span selection for a feature. `ranges` -> focusedRanges (all
 * segments), `primary` -> selectedRange (first in biological order). Never returns
 * a wrapping range; callers pass this straight to the store setters.
 */
export function featureSelectionRanges(
  feature: Pick<Feature, 'start' | 'end' | 'subRanges'>,
  length: number,
  topology: Topology,
): FeatureSelectionRanges {
  const ranges = featureSpans(feature, length, topology);
  return { ranges, primary: ranges[0] ?? null };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Positive modulo for wrapping bp coordinates onto [0, length). */
function mod(value: number, length: number): number {
  return ((value % length) + length) % length;
}
