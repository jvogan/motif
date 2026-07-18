import { describe, expect, it } from 'vitest';
import { extractFeatureSequence, isMultipartFeature } from '../feature-location';
import { applyDeletion, applyInsertion } from '../mutate';
import type { Feature } from '../types';

function joinedFeature(): Feature {
  return {
    id: 'joined-feature',
    name: 'joined feature',
    type: 'cds',
    start: 0,
    end: 12,
    strand: 1,
    subRanges: [
      { start: 0, end: 3, strand: 1 },
      { start: 9, end: 12, strand: 1 },
    ],
    color: '#888888',
    metadata: {},
  };
}

describe('mutation feature-location integrity', () => {
  it('uses half-open feature affinity at insertion boundaries', () => {
    const feature: Feature = {
      id: 'feature',
      name: 'feature',
      type: 'misc_feature',
      start: 2,
      end: 5,
      strand: 1,
      color: '#888888',
      metadata: {},
    };

    expect(applyInsertion('AACCGGTT', [], [feature], 1, 'AA').features[0])
      .toMatchObject({ start: 4, end: 7 });
    expect(applyInsertion('AACCGGTT', [], [feature], 2, 'AA').features[0])
      .toMatchObject({ start: 2, end: 7 });
    expect(applyInsertion('AACCGGTT', [], [feature], 4, 'AA').features[0])
      .toMatchObject({ start: 2, end: 5 });
  });

  it('shifts authoritative pieces and recomputes their envelope after insertion', () => {
    const result = applyInsertion('ATGCCCGGGCCA', [], [joinedFeature()], 5, 'AA');

    expect(result.features[0]).toMatchObject({
      start: 0,
      end: 14,
      subRanges: [
        { start: 0, end: 3, strand: 1 },
        { start: 11, end: 14, strand: 1 },
      ],
    });
    expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('ATGCCA');
  });

  it('drops a deleted piece and derives the envelope from the surviving piece', () => {
    const result = applyDeletion('ATGCCCGGGCCA', [], [joinedFeature()], 0, 3);

    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({
      start: 6,
      end: 9,
      subRanges: [{ start: 6, end: 9, strand: 1 }],
    });
    expect(isMultipartFeature(result.features[0])).toBe(false);
  });

  it('removes an inter-segment gap without changing the assembled product', () => {
    const result = applyDeletion('ATGCCCGGGCCA', [], [joinedFeature()], 3, 6);

    expect(result.raw).toBe('ATGCCA');
    expect(result.features[0]).toMatchObject({
      start: 0,
      end: 6,
      subRanges: [
        { start: 0, end: 3, strand: 1 },
        { start: 3, end: 6, strand: 1 },
      ],
    });
    expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('ATGCCA');
  });

  it('removes a multipart feature when every authoritative piece is deleted', () => {
    const result = applyDeletion('ATGCCCGGGCCA', [], [joinedFeature()], 0, 12);

    expect(result.features).toEqual([]);
  });
});
