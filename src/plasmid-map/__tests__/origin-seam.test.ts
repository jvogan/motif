import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import { featureSegments, joinOriginSegments } from '../geometry/ranges';
import type { MapInput } from '../types';
import type { Feature } from '../../bio/types';

/**
 * A feature that crosses the origin is one stretch of DNA and draws as one band on
 * the ring. Drawn as two closed pieces, both close at 12 o'clock and stroke a seam
 * across the band (pACYC184's CmR, complement(join(3805..4245,1..219))).
 */

const LENGTH = 4245;

function feat(p: Partial<Feature> & { id: string }): Feature {
  return {
    id: p.id,
    name: p.name ?? p.id,
    type: p.type ?? 'misc_feature',
    start: p.start ?? 0,
    end: p.end ?? 0,
    strand: p.strand ?? 1,
    subRanges: p.subRanges,
    color: '#8a8a8a',
    metadata: {},
  };
}

const cmr = feat({
  id: 'cmr', name: 'CmR', start: 0, end: LENGTH, strand: -1,
  subRanges: [{ start: 0, end: 219 }, { start: 3804, end: LENGTH }],
});
const fwdWrap = feat({ id: 'fwdWrap', name: 'fwd wrap', start: 4000, end: 150, strand: 1 });
const twoExon = feat({
  id: 'twoExon', name: 'two exon', start: 1000, end: 2000, strand: 1,
  subRanges: [{ start: 1000, end: 1300 }, { start: 1700, end: 2000 }],
});

function input(mode: 'circular' | 'linear'): MapInput {
  return {
    mode,
    name: 'origin seam',
    length: LENGTH,
    topology: 'circular',
    sequenceType: 'dna',
    features: [cmr, fwdWrap, twoExon],
    restrictionSites: [],
    width: mode === 'linear' ? 1100 : 760,
    height: mode === 'linear' ? 320 : 760,
  };
}

function paths(mode: 'circular' | 'linear', id: string): readonly string[] {
  const f = computeMapLayout(input(mode)).features.find((r) => r.id === id);
  if (!f) throw new Error(`no render for ${id}`);
  return f.segmentPaths;
}

describe('a feature that crosses the origin', () => {
  it('draws as one band on the ring, on either strand', () => {
    expect(paths('circular', 'cmr')).toHaveLength(1);
    expect(paths('circular', 'fwdWrap')).toHaveLength(1);
  });

  it('keeps a split feature away from the origin in its separate pieces', () => {
    expect(paths('circular', 'twoExon')).toHaveLength(2);
  });

  it('keeps the 3-prime end where the arrow points', () => {
    const rev = joinOriginSegments(featureSegments(cmr, LENGTH, 'circular'), LENGTH);
    expect(rev).toEqual([{ start: 3804, end: LENGTH + 219, isStart: true, isEnd: true }]);
    const fwd = joinOriginSegments(featureSegments(fwdWrap, LENGTH, 'circular'), LENGTH);
    expect(fwd).toEqual([{ start: 4000, end: LENGTH + 150, isStart: true, isEnd: true }]);
  });

  it('still draws both pieces at the two ends of the line', () => {
    expect(paths('linear', 'cmr')).toHaveLength(2);
  });

  it('still selects the two pieces separately', () => {
    expect(featureSegments(cmr, LENGTH, 'circular').map((s) => [s.start, s.end])).toEqual([[0, 219], [3804, LENGTH]]);
  });
});
