import { describe, it, expect } from 'vitest';
import {
  bpToAngle,
  pointOnCircle,
  pointForBp,
  describeArcBand,
  describeArcLine,
  labelSideForAngle,
  bpToX,
  round,
} from '../geometry/coordinates';
import {
  normalizeSpan,
  featureSpans,
  featureSegments,
  featureSelectionRanges,
} from '../geometry/ranges';
import { mapModeForBlock } from '../types';

describe('coordinates: bpToAngle', () => {
  it('maps base 0 to top and quarters clockwise', () => {
    expect(bpToAngle(0, 1000)).toBe(0);
    expect(bpToAngle(250, 1000)).toBe(90);
    expect(bpToAngle(500, 1000)).toBe(180);
    expect(bpToAngle(750, 1000)).toBe(270);
    expect(bpToAngle(1000, 1000)).toBe(360);
  });
  it('is safe for zero length', () => {
    expect(bpToAngle(5, 0)).toBe(0);
  });
});

describe('coordinates: pointOnCircle', () => {
  const cx = 100;
  const cy = 100;
  const r = 50;
  it('places 0deg at 12 o clock (top)', () => {
    const p = pointOnCircle(cx, cy, r, 0);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(50, 5); // cy - r
  });
  it('places 90deg at 3 o clock (right), 180 at bottom, 270 at left', () => {
    expect(pointOnCircle(cx, cy, r, 90).x).toBeCloseTo(150, 5);
    expect(pointOnCircle(cx, cy, r, 90).y).toBeCloseTo(100, 5);
    expect(pointOnCircle(cx, cy, r, 180).y).toBeCloseTo(150, 5);
    expect(pointOnCircle(cx, cy, r, 270).x).toBeCloseTo(50, 5);
  });
  it('pointForBp agrees with bp->angle->point', () => {
    const a = pointForBp(cx, cy, r, 250, 1000);
    expect(a.x).toBeCloseTo(150, 5); // quarter -> right
    expect(a.y).toBeCloseTo(100, 5);
  });
});

describe('coordinates: arc paths', () => {
  it('describeArcBand emits a closed two-arc band', () => {
    const d = describeArcBand(100, 100, 40, 50, 0, 90);
    expect(d.startsWith('M ')).toBe(true);
    expect((d.match(/A /g) ?? []).length).toBe(2);
    expect(d.trim().endsWith('Z')).toBe(true);
  });
  it('sets the large-arc flag past 180 degrees', () => {
    const small = describeArcBand(100, 100, 40, 50, 0, 90);
    const big = describeArcBand(100, 100, 40, 50, 0, 270);
    expect(small).toContain(' 0 1 '); // largeArc=0 on outer sweep
    expect(big).toContain(' 1 1 '); // largeArc=1 on outer sweep
  });
  it('describeArcLine emits a single arc', () => {
    const d = describeArcLine(100, 100, 50, 10, 80);
    expect((d.match(/A /g) ?? []).length).toBe(1);
  });
});

describe('coordinates: labelSideForAngle + linear + round', () => {
  it('anchors right half at start, left half at end', () => {
    expect(labelSideForAngle(90)).toBe('start');
    expect(labelSideForAngle(0)).toBe('start');
    expect(labelSideForAngle(180)).toBe('start');
    expect(labelSideForAngle(181)).toBe('end');
    expect(labelSideForAngle(270)).toBe('end');
    expect(labelSideForAngle(-90)).toBe('end'); // normalizes to 270
  });
  it('bpToX spans the axis width', () => {
    expect(bpToX(0, 1000, 20, 600)).toBe(20);
    expect(bpToX(1000, 1000, 20, 600)).toBe(620);
    expect(bpToX(500, 1000, 20, 600)).toBe(320);
  });
  it('round keeps 3 decimals', () => {
    expect(round(1.23456)).toBe(1.235);
  });
});

describe('ranges: normalizeSpan linear', () => {
  it('clamps into bounds and drops empty', () => {
    expect(normalizeSpan(10, 40, 100, 'linear')).toEqual([{ start: 10, end: 40 }]);
    expect(normalizeSpan(-5, 40, 100, 'linear')).toEqual([{ start: 0, end: 40 }]);
    expect(normalizeSpan(80, 200, 100, 'linear')).toEqual([{ start: 80, end: 100 }]);
    expect(normalizeSpan(40, 40, 100, 'linear')).toEqual([]);
  });
  it('returns nothing for zero length', () => {
    expect(normalizeSpan(0, 10, 0, 'linear')).toEqual([]);
  });
});

describe('ranges: normalizeSpan crash-safety (codex2 review fixes)', () => {
  it('drops non-finite offsets instead of emitting NaN spans', () => {
    expect(normalizeSpan(NaN, 40, 100, 'linear')).toEqual([]);
    expect(normalizeSpan(10, Infinity, 100, 'linear')).toEqual([]);
    expect(normalizeSpan(NaN, NaN, 100, 'circular')).toEqual([]);
  });
  it('drops an out-of-bounds/reversed linear range rather than filling the molecule', () => {
    // 150..-50 clamps to 100..0 -> empty (NOT the whole 0..100 span).
    expect(normalizeSpan(150, -50, 100, 'linear')).toEqual([]);
    // reversed in-bounds also drops (strand is carried separately).
    expect(normalizeSpan(50, 10, 100, 'linear')).toEqual([]);
  });
});

describe('ranges: normalizeSpan circular', () => {
  it('keeps a normal non-wrapping span', () => {
    expect(normalizeSpan(10, 40, 100, 'circular')).toEqual([{ start: 10, end: 40 }]);
  });
  it('splits an origin-wrap (end <= start) into tail + head', () => {
    expect(normalizeSpan(90, 10, 100, 'circular')).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
  it('splits a modulo overflow (end > length)', () => {
    expect(normalizeSpan(90, 110, 100, 'circular')).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
});

describe('ranges: featureSpans / featureSegments', () => {
  it('uses subRanges as authoritative over misleading aggregate', () => {
    // join(2500..2578, 1..100) style origin-crossing CDS on a 2600bp circle.
    const feature = {
      start: 0,
      end: 2578,
      subRanges: [
        { start: 2499, end: 2578 },
        { start: 0, end: 100 },
      ],
    };
    expect(featureSpans(feature, 2600, 'circular')).toEqual([
      { start: 2499, end: 2578 },
      { start: 0, end: 100 },
    ]);
  });
  it('falls back to aggregate start/end when no subRanges', () => {
    expect(featureSpans({ start: 10, end: 40 }, 100, 'circular')).toEqual([
      { start: 10, end: 40 },
    ]);
  });
  it('splits an aggregate origin-wrap feature without subRanges', () => {
    expect(featureSpans({ start: 95, end: 5 }, 100, 'circular')).toEqual([
      { start: 95, end: 100 },
      { start: 0, end: 5 },
    ]);
  });
  it('marks first/last segments for arrowhead placement', () => {
    const segs = featureSegments({ start: 95, end: 5 }, 100, 'circular');
    expect(segs[0]).toMatchObject({ start: 95, end: 100, isStart: true, isEnd: false });
    expect(segs[1]).toMatchObject({ start: 0, end: 5, isStart: false, isEnd: true });
  });
  it('single-segment feature is both start and end', () => {
    const segs = featureSegments({ start: 10, end: 40 }, 100, 'linear');
    expect(segs).toEqual([{ start: 10, end: 40, isStart: true, isEnd: true }]);
  });
});

describe('ranges: featureSelectionRanges', () => {
  it('multi-span -> all ranges + first primary', () => {
    const sel = featureSelectionRanges(
      { start: 0, end: 2578, subRanges: [{ start: 2499, end: 2578 }, { start: 0, end: 100 }] },
      2600,
      'circular',
    );
    expect(sel.ranges).toEqual([{ start: 2499, end: 2578 }, { start: 0, end: 100 }]);
    expect(sel.primary).toEqual({ start: 2499, end: 2578 });
  });
  it('single span -> primary equals the span', () => {
    const sel = featureSelectionRanges({ start: 10, end: 40 }, 100, 'linear');
    expect(sel.ranges).toEqual([{ start: 10, end: 40 }]);
    expect(sel.primary).toEqual({ start: 10, end: 40 });
  });
  it('degenerate -> empty ranges, null primary', () => {
    const sel = featureSelectionRanges({ start: 40, end: 40 }, 100, 'linear');
    expect(sel.ranges).toEqual([]);
    expect(sel.primary).toBeNull();
  });
});

describe('types: mapModeForBlock', () => {
  it('protein is always linear', () => {
    expect(mapModeForBlock('circular', 'protein')).toBe('linear');
    expect(mapModeForBlock('linear', 'protein')).toBe('linear');
  });
  it('circular nucleotide -> circular; linear -> linear', () => {
    expect(mapModeForBlock('circular', 'dna')).toBe('circular');
    expect(mapModeForBlock('circular', 'rna')).toBe('circular');
    expect(mapModeForBlock('linear', 'dna')).toBe('linear');
  });
});

describe('ranges: circular normalization robustness (codex2 review fixes)', () => {
  it('wraps a negative start', () => {
    expect(normalizeSpan(-10, 10, 100, 'circular')).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
  it('treats start >= length as a normal modulo span (not a wrap)', () => {
    expect(normalizeSpan(110, 140, 100, 'circular')).toEqual([{ start: 10, end: 40 }]);
  });
  it('returns the whole ring for a full-length span', () => {
    expect(normalizeSpan(0, 100, 100, 'circular')).toEqual([{ start: 0, end: 100 }]);
  });
  it('drops a zero-length span', () => {
    expect(normalizeSpan(50, 50, 100, 'circular')).toEqual([]);
  });
});

describe('coordinates: full-circle arcs do not collapse (codex2 review fix)', () => {
  it('describeArcBand 0..360 splits into two closed bands', () => {
    const d = describeArcBand(100, 100, 40, 50, 0, 360);
    expect((d.match(/A /g) ?? []).length).toBe(4); // 2 bands x 2 arcs
    expect((d.match(/Z/g) ?? []).length).toBe(2);
  });
  it('describeArcLine 0..360 splits into two arcs', () => {
    const d = describeArcLine(100, 100, 50, 0, 360);
    expect((d.match(/A /g) ?? []).length).toBe(2);
  });
});
