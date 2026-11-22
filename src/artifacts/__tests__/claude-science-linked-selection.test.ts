import { describe, expect, it } from 'vitest';
import type { Feature } from '../../bio/types';
import { buildArtifactGelPreview } from '../claude-science-gel-preview';
import {
  decadeRangeAt,
  gelBandFragmentIndexes,
  lineRangeAt,
  nextGelBandFragment,
  primerMarkSegmentsForLine,
  primerSiteRange,
  restoreRecordSelection,
  selectedGelBandFragment,
  smallestFeatureAt,
  type RememberedRecordSelection,
} from '../claude-science-linked-selection';

type Target = { start: number; end: number; label: string };

const SEQUENCE = 'ACGT'.repeat(50);
const record = (sequence = SEQUENCE, featureIds: string[] = ['f1', 'f2']) => ({
  sequence,
  features: featureIds.map((id) => ({ id })),
});

function remembered(overrides: Partial<RememberedRecordSelection<Target>>): RememberedRecordSelection<Target> {
  return { sequence: SEQUENCE, selection: null, caret: null, lockedTranslateTarget: null, ...overrides };
}

describe('restoreRecordSelection', () => {
  it('brings back nothing for a record that was never left with a selection', () => {
    expect(restoreRecordSelection<Target>(undefined, record())).toEqual({ selection: null, caret: null, lockedTranslateTarget: null });
    expect(restoreRecordSelection(remembered({ caret: 4 }), null)).toEqual({ selection: null, caret: null, lockedTranslateTarget: null });
  });

  it('brings back a feature, a restriction site, the caret and a locked target unchanged', () => {
    const site = { kind: 'restriction' as const, clusterId: 'c1', tickIds: ['EcoRI:10'], enzyme: 'EcoRI' };
    const target = { start: 9, end: 30, label: '10-30' };
    expect(restoreRecordSelection(remembered({ selection: { kind: 'feature', id: 'f2' } }), record()).selection)
      .toEqual({ kind: 'feature', id: 'f2' });
    expect(restoreRecordSelection(remembered({ selection: site }), record()).selection).toBe(site);
    expect(restoreRecordSelection(remembered({ caret: 41 }), record()).caret).toBe(41);
    expect(restoreRecordSelection(remembered({ caret: SEQUENCE.length }), record()).caret).toBe(SEQUENCE.length);
    expect(restoreRecordSelection(remembered({ lockedTranslateTarget: target }), record()).lockedTranslateTarget).toBe(target);
  });

  it('drops a feature the record no longer has', () => {
    expect(restoreRecordSelection(remembered({ selection: { kind: 'feature', id: 'gone' } }), record()).selection).toBeNull();
  });

  it('keeps only a surviving feature when the sequence changed while the record was away', () => {
    const changed = `${SEQUENCE}AAAA`;
    expect(restoreRecordSelection(remembered({ selection: { kind: 'feature', id: 'f1' } }), record(changed)).selection)
      .toEqual({ kind: 'feature', id: 'f1' });
    const site = { kind: 'restriction' as const, clusterId: 'c1', tickIds: ['t'] };
    expect(restoreRecordSelection(remembered({ selection: site, caret: 3 }), record(changed)))
      .toEqual({ selection: null, caret: null, lockedTranslateTarget: null });
    expect(restoreRecordSelection(remembered({ lockedTranslateTarget: { start: 1, end: 4, label: '' } }), record(changed)).lockedTranslateTarget)
      .toBeNull();
  });

  it('drops a caret outside the sequence', () => {
    expect(restoreRecordSelection(remembered({ caret: SEQUENCE.length + 1 }), record()).caret).toBeNull();
    expect(restoreRecordSelection(remembered({ caret: -1 }), record()).caret).toBeNull();
  });
});

describe('decadeRangeAt and lineRangeAt', () => {
  it('selects the 10-base group under the pointer, cut at the sequence end', () => {
    expect(decadeRangeAt(0, 200)).toEqual({ start: 0, end: 10 });
    expect(decadeRangeAt(19, 200)).toEqual({ start: 10, end: 20 });
    expect(decadeRangeAt(20, 200)).toEqual({ start: 20, end: 30 });
    expect(decadeRangeAt(203, 205)).toEqual({ start: 200, end: 205 });
    expect(decadeRangeAt(205, 205)).toBeNull();
    expect(decadeRangeAt(-1, 205)).toBeNull();
  });

  it('selects the displayed line, including a short last line', () => {
    expect(lineRangeAt(64, 65, 200)).toEqual({ start: 0, end: 65 });
    expect(lineRangeAt(65, 65, 200)).toEqual({ start: 65, end: 130 });
    expect(lineRangeAt(199, 65, 200)).toEqual({ start: 195, end: 200 });
    expect(lineRangeAt(10, 0, 200)).toBeNull();
  });
});

describe('smallestFeatureAt', () => {
  const feature = (id: string, start: number, end: number, extra: Partial<Feature> = {}): Feature => ({
    id, name: id, type: 'cds', start, end, strand: 1, color: '#000000', metadata: {}, ...extra,
  });

  it('picks the feature covering the fewest bases among those over the base', () => {
    const features = [feature('outer', 0, 150), feature('inner', 20, 60), feature('elsewhere', 100, 110)];
    expect(smallestFeatureAt(features, 30, 200, 'linear')?.id).toBe('inner');
    expect(smallestFeatureAt(features, 10, 200, 'linear')?.id).toBe('outer');
    expect(smallestFeatureAt(features, 160, 200, 'linear')).toBeNull();
  });

  it('counts a joined feature by its spans and ignores its intron', () => {
    const joined = feature('joined', 10, 100, { subRanges: [{ start: 10, end: 20 }, { start: 90, end: 100 }] });
    const plain = feature('plain', 0, 60);
    expect(smallestFeatureAt([plain, joined], 15, 200, 'linear')?.id).toBe('joined');
    expect(smallestFeatureAt([plain, joined], 50, 200, 'linear')?.id).toBe('plain');
  });

  it('finds a feature across the origin of a circular record', () => {
    const wrap = feature('wrap', 190, 10);
    expect(smallestFeatureAt([wrap], 5, 200, 'circular')?.id).toBe('wrap');
    expect(smallestFeatureAt([wrap], 195, 200, 'circular')?.id).toBe('wrap');
    expect(smallestFeatureAt([wrap], 100, 200, 'circular')).toBeNull();
  });

  it('breaks a tie by the earlier start', () => {
    expect(smallestFeatureAt([feature('later', 25, 35), feature('earlier', 20, 30)], 27, 200, 'linear')?.id).toBe('earlier');
  });
});

describe('gel bands and their fragments', () => {
  const preview = (fragmentLengthsBp: number[]) => buildArtifactGelPreview({
    workflowResultId: 'gel-1',
    workflowName: 'Gel',
    createdAt: '2026-01-01T00:00:00.000Z',
    ladderPreset: '1kb',
    agarosePercent: 1,
    lanes: [{
      id: 'digest:d1',
      label: 'Digest',
      sourceKind: 'digest',
      recordId: 'r1',
      sequenceType: 'dna',
      sourceTopology: 'linear',
      sourceLengthBp: fragmentLengthsBp.reduce((sum, length) => sum + length, 0),
      fragmentLengthsBp,
      digestWorkflowResultId: 'd1',
    }],
    provenance: { source: 'test' } as never,
  });

  it('maps each band of a real preview to the fragments it stands for', () => {
    const lengths = [2635, 30, 21];
    const lane = preview(lengths).lanes.find((candidate) => candidate.sourceKind === 'digest')!;
    const byBand = gelBandFragmentIndexes(lengths, lane.bands);
    const bandFor = (size: number) => lane.bands.find((band) => band.fragmentSizesBp.includes(size))!;
    expect(byBand.get(bandFor(2635).bandIndex)).toEqual([0]);
    expect(byBand.get(bandFor(30).bandIndex)).toContain(1);
    expect(byBand.get(bandFor(21).bandIndex)).toContain(2);
  });

  it('puts fragments of the same length in one band, in fragment order', () => {
    const lengths = [400, 1200, 400];
    const lane = preview(lengths).lanes.find((candidate) => candidate.sourceKind === 'digest')!;
    const shared = lane.bands.find((band) => band.fragmentCount === 2)!;
    expect(shared.coMigrating).toBe(true);
    expect(gelBandFragmentIndexes(lengths, lane.bands).get(shared.bandIndex)).toEqual([0, 2]);
  });

  it('selects the first fragment, then the next on each activation, wrapping', () => {
    const ranges = [{ start: 0, end: 400 }, { start: 400, end: 1600 }, { start: 1600, end: 2000 }];
    const indexes = [0, 2];
    expect(nextGelBandFragment(indexes, ranges, null)).toBe(0);
    expect(nextGelBandFragment(indexes, ranges, { start: 400, end: 1600 })).toBe(0);
    expect(nextGelBandFragment(indexes, ranges, { start: 0, end: 400 })).toBe(2);
    expect(nextGelBandFragment(indexes, ranges, { start: 1600, end: 2000 })).toBe(0);
    expect(nextGelBandFragment([], ranges, null)).toBeNull();
    expect(selectedGelBandFragment(indexes, ranges, { start: 1600, end: 2000 })).toBe(1);
    expect(selectedGelBandFragment(indexes, ranges, { start: 1600, end: 1999 })).toBe(-1);
  });
});

describe('primerMarkSegmentsForLine', () => {
  it('draws a forward site with its arrowhead on the piece holding the 3′ end', () => {
    const marks = [{ strand: 1 as const, start: 55, end: 75 }];
    expect(primerMarkSegmentsForLine(marks, 0, 60, 200, 'linear')).toEqual([{ strand: 1, left: 55, width: 5, head: false }]);
    expect(primerMarkSegmentsForLine(marks, 60, 120, 200, 'linear')).toEqual([{ strand: 1, left: 0, width: 15, head: true }]);
  });

  it('draws a reverse site with its arrowhead on the piece holding its left end', () => {
    const marks = [{ strand: -1 as const, start: 55, end: 75 }];
    expect(primerMarkSegmentsForLine(marks, 0, 60, 200, 'linear')).toEqual([{ strand: -1, left: 55, width: 5, head: true }]);
    expect(primerMarkSegmentsForLine(marks, 60, 120, 200, 'linear')).toEqual([{ strand: -1, left: 0, width: 15, head: false }]);
  });

  it('splits a site across the origin of a circular record', () => {
    const forward = [{ strand: 1 as const, start: 190, end: 205 }];
    expect(primerMarkSegmentsForLine(forward, 180, 200, 200, 'circular')).toEqual([{ strand: 1, left: 10, width: 10, head: false }]);
    expect(primerMarkSegmentsForLine(forward, 0, 60, 200, 'circular')).toEqual([{ strand: 1, left: 0, width: 5, head: true }]);
    const reverse = [{ strand: -1 as const, start: 190, end: 205 }];
    expect(primerMarkSegmentsForLine(reverse, 180, 200, 200, 'circular')[0].head).toBe(true);
    expect(primerMarkSegmentsForLine(reverse, 0, 60, 200, 'circular')[0].head).toBe(false);
  });

  it('draws nothing on a line the site does not reach', () => {
    expect(primerMarkSegmentsForLine([{ strand: 1, start: 10, end: 30 }], 60, 120, 200, 'linear')).toEqual([]);
  });
});

describe('primerSiteRange', () => {
  it('selects a site on a linear record as it is, and nothing outside the record', () => {
    expect(primerSiteRange({ start: 142, end: 162 }, 2686, 'linear')).toEqual({ start: 142, end: 162 });
    expect(primerSiteRange({ start: 2680, end: 2700 }, 2686, 'linear')).toBeNull();
    expect(primerSiteRange({ start: 20, end: 10 }, 2686, 'linear')).toBeNull();
    expect(primerSiteRange({ start: 10, end: 10 }, 2686, 'linear')).toBeNull();
  });

  it('selects a site across the origin of a circular record with its end past the record length', () => {
    // Written unwrapped, as PCR binding sites are: 2,681–2,686 then 1–14.
    expect(primerSiteRange({ start: 2680, end: 2700 }, 2686, 'circular')).toEqual({ start: 2680, end: 2700 });
    // Written with the end before the start: the same 20 bases.
    expect(primerSiteRange({ start: 2680, end: 14 }, 2686, 'circular')).toEqual({ start: 2680, end: 2700 });
    // A start past the origin comes back into the record.
    expect(primerSiteRange({ start: 2690, end: 2710 }, 2686, 'circular')).toEqual({ start: 4, end: 24 });
  });

  it('refuses an empty site, one longer than the record and positions that are not whole bases', () => {
    expect(primerSiteRange({ start: 5, end: 5 }, 100, 'circular')).toBeNull();
    expect(primerSiteRange({ start: 0, end: 101 }, 100, 'circular')).toBeNull();
    expect(primerSiteRange({ start: 0.5, end: 20 }, 100, 'circular')).toBeNull();
    expect(primerSiteRange({ start: 0, end: 20 }, 0, 'circular')).toBeNull();
  });
});
