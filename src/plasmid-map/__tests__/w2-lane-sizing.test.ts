/**
 * W2 — adaptive circular lane sizing (fitLaneStack + laneBand). Proves the
 * lane-collapse bug is gone: deep overlapping lanes get DISTINCT descending radii
 * instead of clamping onto a shared floor, thickness/gap compress before any lane
 * is dropped, and genuine overflow is arc-less + counted (never silently overdrawn).
 */
import { describe, it, expect } from 'vitest';
import { computeMapLayout, fitLaneStack } from '../layout';
import type { MapInput } from '../types';
import type { Feature } from '../../bio/types';

const feat = (id: string, start: number, end: number, strand: 1 | -1 | 0 = 1): Feature =>
  ({ id, name: id, type: 'cds', start, end, strand, color: '#8a8a8a', metadata: {} } as Feature);

// N features all spanning the SAME locus => N mutually-overlapping lanes.
const stackedFeatures = (n: number, start = 100, end = 2500): Feature[] =>
  Array.from({ length: n }, (_, i) => feat(`f${i}`, start, end, 1));

const circular = (over: Partial<MapInput>): MapInput => ({
  mode: 'circular', name: 'w2', length: 3000, topology: 'circular', sequenceType: 'dna',
  features: [], restrictionSites: [], width: 600, height: 600, ...over,
});

/** Outer radius baked into a describeArcBand path: the first `A rx ry ...`. */
function outerRadiusOf(path: string): number | null {
  const m = path.match(/A\s+([\d.]+)\s/);
  return m ? Number(m[1]) : null;
}

describe('fitLaneStack (pure helper)', () => {
  it('a single lane contributes no gap and sits at the target size', () => {
    const m = fitLaneStack(1, 100, 12, 3, 4, 1);
    expect(m).toMatchObject({ visibleCount: 1, hiddenCount: 0, size: 12, gap: 0, pitch: 12 });
  });

  it('fits every lane uncompressed when the depth is generous', () => {
    const m = fitLaneStack(3, 1000, 12, 3, 4, 1);
    expect(m).toMatchObject({ visibleCount: 3, size: 12, gap: 3, pitch: 15, hiddenCount: 0 });
  });

  it('compresses size+gap (never below floor) so all lanes stay visible + distinct', () => {
    const m = fitLaneStack(11, 60, 12, 3, 4, 1); // wants 11*15=165, only 60 available
    expect(m.visibleCount).toBe(11);
    expect(m.hiddenCount).toBe(0);
    expect(m.size).toBeGreaterThanOrEqual(4);
    expect(m.gap).toBeGreaterThanOrEqual(1);
    expect(m.pitch).toBeGreaterThan(0);
    expect(11 * m.size + 10 * m.gap).toBeLessThanOrEqual(60 + 1e-9); // fits within depth
  });

  it('caps visibleCount + reports overflow when even the floor stack cannot fit', () => {
    const m = fitLaneStack(40, 30, 12, 3, 4, 1); // floor 40*4+39*1=199 >> 30
    expect(m.visibleCount).toBeGreaterThanOrEqual(1);
    expect(m.visibleCount).toBeLessThan(40);
    expect(m.hiddenCount).toBe(40 - m.visibleCount);
    expect(m.size).toBe(4);
    expect(m.pitch).toBeGreaterThan(0);
  });

  it('keeps pitch>0 (distinct, descending radii) across every scale', () => {
    for (const [count, depth] of [[2, 5], [8, 47], [11, 60], [20, 40], [3, 1000]] as const) {
      const m = fitLaneStack(count, depth, 12, 3, 4, 1);
      expect(m.pitch).toBeGreaterThan(0);
      const radii = Array.from({ length: m.visibleCount }, (_, l) => 400 - l * m.pitch);
      expect(new Set(radii.map((r) => r.toFixed(6))).size).toBe(m.visibleCount); // strictly distinct
      for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]); // descending
    }
  });

  it('sanitizes non-finite / degenerate inputs (no NaN leaks, pitch stays positive)', () => {
    for (const m of [
      fitLaneStack(NaN, 100, 12, 3, 4, 1),
      fitLaneStack(5, NaN, 12, 3, 4, 1),
      fitLaneStack(Infinity, 100, 12, 3, 4, 1),
      fitLaneStack(3, -50, 12, 3, 4, 1),
      fitLaneStack(0, 100, 12, 3, 4, 1),
    ]) {
      expect(Number.isFinite(m.size) && Number.isFinite(m.gap) && Number.isFinite(m.pitch)).toBe(true);
      expect(m.pitch).toBeGreaterThan(0);
      expect(m.visibleCount).toBeGreaterThanOrEqual(0);
      expect(m.hiddenCount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('circular lane geometry (integration)', () => {
  it('draws 11 same-locus lanes at DISTINCT descending radii (no collapse)', () => {
    const layout = computeMapLayout(circular({ features: stackedFeatures(11), width: 520, height: 520 }));
    expect(layout.budgets.laneCount).toBe(11);
    expect(layout.budgets.overflowFeatureCount).toBe(0); // 520px fits all 11 compressed
    // Order by LANE (feature render array follows input order; packLanes assigns
    // lanes by string-sorted id, so array order != radius order).
    const drawn = layout.features.filter((f) => f.segmentPaths.length > 0).slice().sort((a, b) => a.lane - b.lane);
    expect(drawn).toHaveLength(11);
    const radii = drawn.map((f) => outerRadiusOf(f.segmentPaths[0])).filter((r): r is number => r != null);
    expect(radii).toHaveLength(11);
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBe(11); // NO shared radius (the bug)
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]); // descending
    for (const f of layout.features) for (const d of f.segmentPaths) expect(d).not.toContain('NaN');
  });

  it('accounts for every feature: drawn + overflow == total, overflow retained + counted', () => {
    const n = 40;
    const layout = computeMapLayout(circular({ features: stackedFeatures(n), width: 200, height: 200 }));
    const drawn = layout.features.filter((f) => f.segmentPaths.length > 0).length;
    const overflow = layout.features.filter((f) => f.segmentPaths.length === 0).length;
    expect(drawn + overflow).toBe(n);
    expect(drawn).toBeGreaterThanOrEqual(1); // outermost still drawn at any size
    expect(overflow).toBeGreaterThan(0); // 40 lanes can't fit a 200px ring
    expect(layout.budgets.overflowFeatureCount).toBe(overflow);
    for (const f of layout.features) {
      if (f.segmentPaths.length === 0) expect(typeof f.title).toBe('string'); // hover-discoverable
    }
  });

  it('stays finite on a degenerate 1x1 viewport', () => {
    const layout = computeMapLayout(circular({ features: stackedFeatures(6), width: 1, height: 1 }));
    expect(/NaN|Infinity/.test(JSON.stringify(layout))).toBe(false);
    expect(layout.viewBox.split(' ').map(Number).every(Number.isFinite)).toBe(true);
  });

  it('is deterministic per feature id under input shuffle', () => {
    const feats = stackedFeatures(9);
    const a = computeMapLayout(circular({ features: feats, width: 320, height: 320 }));
    const shuffled = [feats[3], feats[7], feats[0], feats[8], feats[1], feats[5], feats[2], feats[6], feats[4]];
    const b = computeMapLayout(circular({ features: shuffled, width: 320, height: 320 }));
    const geoById = (l: typeof a) =>
      new Map(l.features.map((f) => [f.id, JSON.stringify({ p: f.segmentPaths, lane: f.lane, label: f.label })]));
    const ma = geoById(a);
    const mb = geoById(b);
    expect(mb.size).toBe(ma.size);
    for (const [id, g] of ma) expect(mb.get(id)).toBe(g); // identical geometry per id
  });
});
