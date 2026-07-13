/**
 * Pure bp-window viewport math for long linear maps.
 *
 * Circular maps usually show the whole molecule; long linear maps need a stable
 * rail viewport so live pan/zoom can be transform-only and commit one bounded
 * bp window at rest.
 */
import type { MapSpan } from './types';
import type { Feature, RestrictionSite, Topology } from '../bio/types';
import { featureSpans, normalizeSpan } from './geometry/ranges';

export type LinearMapViewport = MapSpan;

export interface LinearViewportScale {
  viewport: LinearMapViewport;
  axisStartX: number;
  axisWidth: number;
  pxPerBp: number;
  bpToX(bp: number): number;
  xToBp(x: number): number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampLinearViewport(
  viewport: Partial<LinearMapViewport> | null | undefined,
  length: number,
  minSpan = 1,
): LinearMapViewport {
  const safeLength = Math.max(1, Math.floor(finiteOr(length, 1)));
  const safeMinSpan = clamp(Math.floor(finiteOr(minSpan, 1)), 1, safeLength);
  const rawStart = Math.floor(finiteOr(viewport?.start ?? 0, 0));
  const rawEnd = Math.floor(finiteOr(viewport?.end ?? safeLength, safeLength));
  let start = clamp(rawStart, 0, safeLength);
  let end = clamp(rawEnd, 0, safeLength);
  if (end < start) [start, end] = [end, start];
  if (end - start < safeMinSpan) {
    const mid = clamp((start + end) / 2, 0, safeLength);
    start = Math.floor(clamp(mid - safeMinSpan / 2, 0, safeLength - safeMinSpan));
    end = start + safeMinSpan;
  }
  return { start, end };
}

export function createLinearViewportScale(
  viewport: Partial<LinearMapViewport> | null | undefined,
  length: number,
  axisStartX: number,
  axisWidth: number,
): LinearViewportScale {
  const safeAxisStart = finiteOr(axisStartX, 0);
  const safeAxisWidth = Math.max(1, finiteOr(axisWidth, 1));
  const safeViewport = clampLinearViewport(viewport, length);
  const span = Math.max(1, safeViewport.end - safeViewport.start);
  const pxPerBp = safeAxisWidth / span;
  return {
    viewport: safeViewport,
    axisStartX: safeAxisStart,
    axisWidth: safeAxisWidth,
    pxPerBp,
    bpToX(bp: number): number {
      return safeAxisStart + (finiteOr(bp, safeViewport.start) - safeViewport.start) * pxPerBp;
    },
    xToBp(x: number): number {
      return safeViewport.start + (finiteOr(x, safeAxisStart) - safeAxisStart) / pxPerBp;
    },
  };
}

export function zoomLinearViewport(args: {
  viewport: Partial<LinearMapViewport> | null | undefined;
  length: number;
  factor: number;
  anchorBp: number;
  minSpan?: number;
}): LinearMapViewport {
  const current = clampLinearViewport(args.viewport, args.length, args.minSpan);
  const safeLength = Math.max(1, Math.floor(finiteOr(args.length, 1)));
  const minSpan = clamp(Math.floor(finiteOr(args.minSpan ?? 1, 1)), 1, safeLength);
  const factor = Math.max(0.0001, finiteOr(args.factor, 1));
  const currentSpan = current.end - current.start;
  const nextSpan = clamp(Math.round(currentSpan / factor), minSpan, safeLength);
  const anchor = clamp(finiteOr(args.anchorBp, current.start + currentSpan / 2), current.start, current.end);
  const anchorRatio = currentSpan > 0 ? (anchor - current.start) / currentSpan : 0.5;
  const start = Math.round(anchor - nextSpan * anchorRatio);
  return clampLinearViewport({ start, end: start + nextSpan }, safeLength, minSpan);
}

export function panLinearViewport(args: {
  viewport: Partial<LinearMapViewport> | null | undefined;
  length: number;
  deltaBp: number;
  minSpan?: number;
}): LinearMapViewport {
  const current = clampLinearViewport(args.viewport, args.length, args.minSpan);
  const safeLength = Math.max(1, Math.floor(finiteOr(args.length, 1)));
  const span = current.end - current.start;
  const delta = Math.round(finiteOr(args.deltaBp, 0));
  const start = clamp(current.start + delta, 0, Math.max(0, safeLength - span));
  return { start, end: start + span };
}

export function centerLinearViewport(args: {
  viewport: Partial<LinearMapViewport> | null | undefined;
  length: number;
  centerBp: number;
  minSpan?: number;
}): LinearMapViewport {
  const current = clampLinearViewport(args.viewport, args.length, args.minSpan);
  const safeLength = Math.max(1, Math.floor(finiteOr(args.length, 1)));
  const span = current.end - current.start;
  const center = clamp(finiteOr(args.centerBp, current.start + span / 2), 0, safeLength);
  const start = clamp(Math.round(center - span / 2), 0, Math.max(0, safeLength - span));
  return { start, end: start + span };
}

export function computeLinearViewportTransform(args: {
  from: Partial<LinearMapViewport> | null | undefined;
  to: Partial<LinearMapViewport> | null | undefined;
  length: number;
  axisStartX: number;
  axisWidth: number;
}): { scaleX: number; translateX: number } {
  const fromScale = createLinearViewportScale(args.from, args.length, args.axisStartX, args.axisWidth);
  const toScale = createLinearViewportScale(args.to, args.length, args.axisStartX, args.axisWidth);
  const scaleX = toScale.pxPerBp / fromScale.pxPerBp;
  const translateX = toScale.bpToX(fromScale.viewport.start) - args.axisStartX * scaleX;
  return { scaleX, translateX };
}

export function svgTransformForLinearViewport(args: {
  viewport: Partial<LinearMapViewport> | null | undefined;
  length: number;
  axisStartX: number;
  axisWidth: number;
  viewBoxX: number;
  viewBoxWidth: number;
  minSpan?: number;
}): { k: number; tx: number } {
  const safeLength = Math.max(1, Math.floor(finiteOr(args.length, 1)));
  const viewport = clampLinearViewport(args.viewport, safeLength, args.minSpan);
  if (viewport.start <= 0 && viewport.end >= safeLength) return { k: 1, tx: 0 };
  const scale = createLinearViewportScale(
    { start: 0, end: safeLength },
    safeLength,
    args.axisStartX,
    args.axisWidth,
  );
  const left = scale.bpToX(viewport.start);
  const right = scale.bpToX(viewport.end);
  const viewBoxX = finiteOr(args.viewBoxX, 0);
  const viewBoxWidth = Math.max(1, finiteOr(args.viewBoxWidth, 1));
  const spanX = Math.max(1, Math.abs(right - left));
  const k = Math.max(1, viewBoxWidth / spanX);
  return {
    k,
    tx: viewBoxX - Math.min(left, right) * k,
  };
}

export function linearViewportFromSvgTransform(args: {
  length: number;
  axisStartX: number;
  axisWidth: number;
  viewBoxX: number;
  viewBoxWidth: number;
  transform?: { k?: number; tx?: number } | null;
  minSpan?: number;
}): LinearMapViewport {
  const safeLength = Math.max(1, Math.floor(finiteOr(args.length, 1)));
  const scale = createLinearViewportScale(
    { start: 0, end: safeLength },
    safeLength,
    args.axisStartX,
    args.axisWidth,
  );
  const k = Math.max(1, finiteOr(args.transform?.k ?? 1, 1));
  const tx = finiteOr(args.transform?.tx ?? 0, 0);
  const viewBoxX = finiteOr(args.viewBoxX, 0);
  const viewBoxWidth = Math.max(1, finiteOr(args.viewBoxWidth, 1));
  const visibleLeftX = (viewBoxX - tx) / k;
  const visibleRightX = (viewBoxX + viewBoxWidth - tx) / k;
  const start = Math.floor(scale.xToBp(Math.min(visibleLeftX, visibleRightX)));
  const end = Math.ceil(scale.xToBp(Math.max(visibleLeftX, visibleRightX)));
  return clampLinearViewport({ start, end }, safeLength, args.minSpan);
}

export interface LinearOverviewMarker extends MapSpan {
  id: string;
  kind: 'feature' | 'restriction';
  weight?: number;
}

export interface LinearOverviewBin extends MapSpan {
  index: number;
  count: number;
  weight: number;
}

export function buildLinearOverviewBins(
  length: number,
  markers: readonly LinearOverviewMarker[],
  binCount: number,
): LinearOverviewBin[] {
  const safeLength = Math.max(1, Math.floor(finiteOr(length, 1)));
  const count = clamp(Math.floor(finiteOr(binCount, 1)), 1, 512);
  const bins = Array.from({ length: count }, (_, index): LinearOverviewBin => {
    const start = Math.floor((index / count) * safeLength);
    const end = index === count - 1 ? safeLength : Math.floor(((index + 1) / count) * safeLength);
    return { index, start, end: Math.max(start + 1, end), count: 0, weight: 0 };
  });
  for (const marker of markers) {
    const span = clampLinearViewport(marker, safeLength);
    const first = clamp(Math.floor((span.start / safeLength) * count), 0, count - 1);
    const last = clamp(Math.floor(((Math.max(span.end - 1, span.start)) / safeLength) * count), 0, count - 1);
    const weight = Math.max(0, finiteOr(marker.weight ?? 1, 1));
    for (let index = first; index <= last; index += 1) {
      bins[index].count += 1;
      bins[index].weight += weight;
    }
  }
  return bins;
}

export function linearOverviewPercent(span: MapSpan, length: number): { left: number; width: number } {
  const safeLength = Math.max(1, Math.floor(finiteOr(length, 1)));
  const safe = clampLinearViewport(span, safeLength);
  const left = clamp((safe.start / safeLength) * 100, 0, 100);
  const right = clamp((safe.end / safeLength) * 100, 0, 100);
  return { left, width: Math.max(0.4, right - left) };
}

export function buildLinearOverviewMarkers(args: {
  length: number;
  topology: Topology;
  features: readonly Feature[];
  restrictionSites: readonly RestrictionSite[];
  includeFeatures?: boolean;
  includeRestrictions?: boolean;
}): LinearOverviewMarker[] {
  const safeLength = Math.max(1, Math.floor(finiteOr(args.length, 1)));
  const out: LinearOverviewMarker[] = [];
  if (args.includeFeatures !== false) {
    for (const feature of args.features) {
      const spans = featureSpans(feature, safeLength, args.topology);
      spans.forEach((span, index) => {
        out.push({
          id: `feature:${feature.id}:${index}`,
          kind: 'feature',
          start: span.start,
          end: span.end,
          weight: 1,
        });
      });
    }
  }
  if (args.includeRestrictions !== false) {
    for (const site of args.restrictionSites) {
      const recLength = Math.max(1, site.recognitionSequence.length);
      const spans = normalizeSpan(site.position, site.position + recLength, safeLength, args.topology);
      spans.forEach((span, index) => {
        out.push({
          id: `restriction:${site.enzyme}@${site.position}:${index}`,
          kind: 'restriction',
          start: span.start,
          end: span.end,
          weight: 0.55,
        });
      });
    }
  }
  return out;
}
