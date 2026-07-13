import { describe, expect, it } from 'vitest';

import {
  buildLinearOverviewBins,
  buildLinearOverviewMarkers,
  centerLinearViewport,
  clampLinearViewport,
  computeLinearViewportTransform,
  createLinearViewportScale,
  linearViewportFromSvgTransform,
  linearOverviewPercent,
  panLinearViewport,
  svgTransformForLinearViewport,
  zoomLinearViewport,
} from '../viewport';
import type { Feature, RestrictionSite } from '../../bio/types';

describe('linear map viewport math', () => {
  it('clamps non-finite and undersized windows into a valid bp range', () => {
    expect(clampLinearViewport({ start: Number.NaN, end: Infinity }, 1000, 50)).toEqual({ start: 0, end: 1000 });
    expect(clampLinearViewport({ start: 200, end: 210 }, 1000, 50)).toEqual({ start: 180, end: 230 });
    expect(clampLinearViewport({ start: 900, end: 100 }, 1000, 50)).toEqual({ start: 100, end: 900 });
  });

  it('maps bp to x and x back to bp for a visible linear window', () => {
    const scale = createLinearViewportScale({ start: 1000, end: 2000 }, 10_000, 20, 500);
    expect(scale.pxPerBp).toBeCloseTo(0.5);
    expect(scale.bpToX(1000)).toBeCloseTo(20);
    expect(scale.bpToX(1500)).toBeCloseTo(270);
    expect(scale.xToBp(270)).toBeCloseTo(1500);
  });

  it('keeps the zoom anchor stable in screen space', () => {
    const before = createLinearViewportScale({ start: 0, end: 1000 }, 10_000, 0, 1000);
    const next = zoomLinearViewport({
      viewport: before.viewport,
      length: 10_000,
      factor: 2,
      anchorBp: 250,
      minSpan: 100,
    });
    const after = createLinearViewportScale(next, 10_000, 0, 1000);
    expect(next).toEqual({ start: 125, end: 625 });
    expect(after.bpToX(250)).toBeCloseTo(before.bpToX(250));
  });

  it('pans by bp and clamps at molecule ends', () => {
    expect(panLinearViewport({ viewport: { start: 100, end: 300 }, length: 1000, deltaBp: 50 })).toEqual({ start: 150, end: 350 });
    expect(panLinearViewport({ viewport: { start: 850, end: 1000 }, length: 1000, deltaBp: 500 })).toEqual({ start: 850, end: 1000 });
    expect(panLinearViewport({ viewport: { start: 0, end: 150 }, length: 1000, deltaBp: -500 })).toEqual({ start: 0, end: 150 });
  });

  it('centers a current linear viewport around a requested coordinate', () => {
    expect(centerLinearViewport({
      viewport: { start: 100, end: 300 },
      length: 1000,
      centerBp: 600,
    })).toEqual({ start: 500, end: 700 });

    expect(centerLinearViewport({
      viewport: { start: 100, end: 300 },
      length: 1000,
      centerBp: 980,
    })).toEqual({ start: 800, end: 1000 });
  });

  it('computes a transform that maps committed viewport geometry into the live viewport', () => {
    const transform = computeLinearViewportTransform({
      from: { start: 0, end: 1000 },
      to: { start: 100, end: 600 },
      length: 10_000,
      axisStartX: 20,
      axisWidth: 500,
    });
    const fromScale = createLinearViewportScale({ start: 0, end: 1000 }, 10_000, 20, 500);
    const toScale = createLinearViewportScale({ start: 100, end: 600 }, 10_000, 20, 500);
    for (const bp of [100, 250, 600]) {
      expect(fromScale.bpToX(bp) * transform.scaleX + transform.translateX).toBeCloseTo(toScale.bpToX(bp));
    }
  });

  it('derives the visible bp window from the live SVG transform', () => {
    expect(linearViewportFromSvgTransform({
      length: 10_000,
      axisStartX: 20,
      axisWidth: 500,
      viewBoxX: 0,
      viewBoxWidth: 540,
      transform: { k: 1, tx: 0 },
    })).toEqual({ start: 0, end: 10000 });

    expect(linearViewportFromSvgTransform({
      length: 10_000,
      axisStartX: 20,
      axisWidth: 500,
      viewBoxX: 0,
      viewBoxWidth: 540,
      transform: { k: 2, tx: 0 },
    })).toEqual({ start: 0, end: 5000 });

    expect(linearViewportFromSvgTransform({
      length: 10_000,
      axisStartX: 20,
      axisWidth: 500,
      viewBoxX: 0,
      viewBoxWidth: 540,
      transform: { k: 2, tx: -250 },
    })).toEqual({ start: 2100, end: 7500 });
  });

  it('turns a desired linear viewport back into a live SVG transform', () => {
    const transform = svgTransformForLinearViewport({
      viewport: { start: 2500, end: 7500 },
      length: 10_000,
      axisStartX: 20,
      axisWidth: 500,
      viewBoxX: 0,
      viewBoxWidth: 540,
    });

    expect(transform.k).toBeCloseTo(2.16);
    expect(linearViewportFromSvgTransform({
      length: 10_000,
      axisStartX: 20,
      axisWidth: 500,
      viewBoxX: 0,
      viewBoxWidth: 540,
      transform,
    })).toEqual({ start: 2500, end: 7500 });

    expect(svgTransformForLinearViewport({
      viewport: { start: 0, end: 10_000 },
      length: 10_000,
      axisStartX: 20,
      axisWidth: 500,
      viewBoxX: 0,
      viewBoxWidth: 540,
    })).toEqual({ k: 1, tx: 0 });
  });

  it('clamps corrupt live SVG transform inputs into a finite visible bp window', () => {
    const viewport = linearViewportFromSvgTransform({
      length: Number.NaN,
      axisStartX: Number.NaN,
      axisWidth: 0,
      viewBoxX: Number.NaN,
      viewBoxWidth: Number.NaN,
      transform: { k: Number.NaN, tx: Infinity },
    });

    expect(viewport).toEqual({ start: 0, end: 1 });
    expect(Object.values(viewport).every(Number.isFinite)).toBe(true);
  });
});

describe('linear overview bins', () => {
  it('turns dense map markers into deterministic minimap bins', () => {
    const bins = buildLinearOverviewBins(1000, [
      { id: 'feature-a', kind: 'feature', start: 100, end: 250 },
      { id: 'site-a', kind: 'restriction', start: 240, end: 241, weight: 2 },
      { id: 'feature-b', kind: 'feature', start: 800, end: 950 },
    ], 10);

    expect(bins).toHaveLength(10);
    expect(bins[1]).toMatchObject({ start: 100, end: 200, count: 1, weight: 1 });
    expect(bins[2]).toMatchObject({ start: 200, end: 300, count: 2, weight: 3 });
    expect(bins[8]).toMatchObject({ start: 800, end: 900, count: 1, weight: 1 });
  });

  it('keeps exact bin-boundary spans out of the next bin', () => {
    const bins = buildLinearOverviewBins(1000, [
      { id: 'feature-boundary', kind: 'feature', start: 100, end: 200 },
    ], 10);

    expect(bins[1]).toMatchObject({ start: 100, end: 200, count: 1, weight: 1 });
    expect(bins[2]).toMatchObject({ start: 200, end: 300, count: 0, weight: 0 });
  });

  it('clamps corrupt overview inputs without emitting non-finite bin geometry', () => {
    const bins = buildLinearOverviewBins(Number.NaN, [
      { id: 'corrupt', kind: 'feature', start: Number.NaN, end: Infinity, weight: Number.NaN },
    ], Infinity);

    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ index: 0, start: 0, end: 1, count: 1, weight: 1 });
    expect(Object.values(bins[0]).every((value) => typeof value !== 'number' || Number.isFinite(value))).toBe(true);
  });

  it('builds overview markers from feature spans and restriction windows', () => {
    const features: Feature[] = [{
      id: 'joined',
      name: 'joined',
      type: 'cds',
      start: 0,
      end: 1000,
      strand: 1,
      color: '#888888',
      metadata: {},
      subRanges: [{ start: 100, end: 180 }, { start: 500, end: 580 }],
    }];
    const restrictionSites: RestrictionSite[] = [{
      enzyme: 'EcoRI',
      position: 900,
      cutPosition: 901,
      recognitionSequence: 'GAATTC',
      overhang: 'blunt',
    }];

    expect(buildLinearOverviewMarkers({
      length: 1000,
      topology: 'linear',
      features,
      restrictionSites,
    })).toEqual([
      { id: 'feature:joined:0', kind: 'feature', start: 100, end: 180, weight: 1 },
      { id: 'feature:joined:1', kind: 'feature', start: 500, end: 580, weight: 1 },
      { id: 'restriction:EcoRI@900:0', kind: 'restriction', start: 900, end: 906, weight: 0.55 },
    ]);
  });

  it('splits circular restriction windows that wrap around the origin', () => {
    const restrictionSites: RestrictionSite[] = [{
      enzyme: 'WrapI',
      position: 98,
      cutPosition: 99,
      recognitionSequence: 'GAATTC',
      overhang: 'blunt',
    }];

    expect(buildLinearOverviewMarkers({
      length: 100,
      topology: 'circular',
      features: [],
      restrictionSites,
    })).toEqual([
      { id: 'restriction:WrapI@98:0', kind: 'restriction', start: 98, end: 100, weight: 0.55 },
      { id: 'restriction:WrapI@98:1', kind: 'restriction', start: 0, end: 4, weight: 0.55 },
    ]);
  });

  it('respects feature and restriction include flags independently', () => {
    const features: Feature[] = [featureFixture('feat', 10, 30)];
    const restrictionSites: RestrictionSite[] = [{
      enzyme: 'EcoRI',
      position: 50,
      cutPosition: 51,
      recognitionSequence: 'GAATTC',
      overhang: 'blunt',
    }];

    expect(buildLinearOverviewMarkers({
      length: 100,
      topology: 'linear',
      features,
      restrictionSites,
      includeFeatures: false,
    }).map((marker) => marker.kind)).toEqual(['restriction']);

    expect(buildLinearOverviewMarkers({
      length: 100,
      topology: 'linear',
      features,
      restrictionSites,
      includeRestrictions: false,
    }).map((marker) => marker.kind)).toEqual(['feature']);
  });

  it('returns clamped percentages for overlay ranges', () => {
    expect(linearOverviewPercent({ start: 100, end: 300 }, 1000)).toEqual({ left: 10, width: 20 });
    expect(linearOverviewPercent({ start: 10, end: 11 }, 1000)).toEqual({ left: 1, width: 0.4 });
  });
});

function featureFixture(id: string, start: number, end: number): Feature {
  return {
    id,
    name: id,
    type: 'cds',
    start,
    end,
    strand: 1,
    color: '#888888',
    metadata: {},
  };
}
