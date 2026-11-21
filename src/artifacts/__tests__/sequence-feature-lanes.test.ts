import { describe, expect, it } from 'vitest';
import type { Feature } from '../../bio/types';
import { featureLanesForLine } from '../motif-artifact';

function feature(id: string, name: string, start: number, end: number, overrides: Partial<Feature> = {}): Feature {
  return { id, name, type: 'cds', start, end, strand: 1, color: '#336699', metadata: {}, ...overrides };
}

describe('feature lanes on a sequence line', () => {
  it('does not draw a whole-record source feature', () => {
    const features = [
      feature('src', 'source', 0, 60, { type: 'custom', metadata: { motifOriginalFeatureKey: 'source' } }),
      feature('plain', 'source', 0, 60, { type: 'custom' }),
      feature('gene', 'gfp', 10, 40),
    ];
    const { lanes, hidden } = featureLanesForLine(features, 0, 60, 60, 'linear');
    expect(lanes.flat().map((block) => block.feature.name)).toEqual(['gfp']);
    expect(hidden).toEqual([]);
  });

  it('keeps a feature named source that covers only part of a record', () => {
    const { lanes } = featureLanesForLine([feature('part', 'source', 5, 20, { type: 'custom' })], 0, 60, 60, 'linear');
    expect(lanes.flat().map((block) => block.feature.name)).toEqual(['source']);
  });

  it('collapses features beyond four lanes into a counted list instead of dropping them', () => {
    const features = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => feature(name, `feat_${name}`, 0, 50 + index));
    const { lanes, hidden } = featureLanesForLine(features, 0, 60, 60, 'linear');
    expect(lanes).toHaveLength(4);
    expect(hidden.map((entry) => entry.name)).toHaveLength(2);
    expect(lanes.flat().length + hidden.length).toBe(6);
  });
});
