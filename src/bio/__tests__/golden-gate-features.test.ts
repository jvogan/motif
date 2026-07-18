import { describe, expect, it } from 'vitest';
import {
  buildSyntheticGoldenGateVector,
  getGoldenGatePartBoundary,
  goldenGateAssemble,
} from '../golden-gate';
import type { Feature } from '../types';

function feature(name: string, overrides: Partial<Feature>): Feature {
  return {
    id: `${name}-id`,
    name,
    type: 'cds',
    start: 0,
    end: 1,
    strand: 1,
    color: '#888888',
    metadata: {},
    ...overrides,
  };
}

function requiredInsertStart(part: { name: string; sequence: string }): number {
  const boundary = getGoldenGatePartBoundary(part);
  expect(boundary.valid).toBe(true);
  if (boundary.insertStart === null) throw new Error(`Missing insert start for ${part.name}`);
  return boundary.insertStart;
}

describe('Golden Gate assembly feature locations', () => {
  it('preserves multipart order and rebuilds envelopes through digest, ligation, and circle closure', () => {
    const aBase = buildSyntheticGoldenGateVector('ATGC', 'GCTA', {
      name: 'A',
      filler: 'AACCGGTT',
    });
    const bBase = buildSyntheticGoldenGateVector('GCTA', 'ATGC', {
      name: 'B',
      filler: 'TTCCAAGG',
    });
    const aStart = requiredInsertStart(aBase);
    const bStart = requiredInsertStart(bBase);

    const result = goldenGateAssemble([
      {
        ...aBase,
        features: [
          feature('A multipart', {
            start: aStart - 2,
            end: aStart + 7,
            strand: -1,
            subRanges: [
              { start: aStart + 5, end: aStart + 7, strand: -1 },
              { start: aStart - 2, end: aStart + 2, strand: -1 },
            ],
          }),
          feature('A flank-only multipart', {
            start: aStart - 2,
            end: aStart + 7,
            subRanges: [{ start: aStart - 2, end: aStart, strand: 1 }],
          }),
        ],
      },
      {
        ...bBase,
        features: [
          feature('B multipart', {
            start: bStart,
            end: bStart + 10,
            strand: -1,
            subRanges: [
              { start: bStart + 8, end: bStart + 10, strand: -1 },
              { start: bStart, end: bStart + 2, strand: -1 },
              { start: bStart + 3, end: bStart + 6, strand: -1 },
            ],
          }),
          feature('B closing-tail crossing', {
            start: bStart + 10,
            end: bStart + 14,
            subRanges: [{ start: bStart + 10, end: bStart + 14, strand: 1 }],
          }),
          feature('B closing-tail only', {
            start: bStart + 8,
            end: bStart + 16,
            subRanges: [{ start: bStart + 12, end: bStart + 16, strand: 1 }],
          }),
        ],
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.topology).toBe('circular');
    expect(result.parts).toEqual(['A', 'B']);
    expect(result.sequence).toHaveLength(24);
    expect(result.features.find(({ name }) => name === 'A multipart')).toMatchObject({
      start: 0,
      end: 7,
      subRanges: [
        { start: 5, end: 7, strand: -1 },
        { start: 0, end: 2, strand: -1 },
      ],
    });
    expect(result.features.some(({ name }) => name === 'A flank-only multipart')).toBe(false);
    expect(result.features.find(({ name }) => name === 'B multipart')).toMatchObject({
      start: 16,
      end: 22,
      subRanges: [
        { start: 20, end: 22, strand: -1 },
        { start: 16, end: 18, strand: -1 },
      ],
    });
    expect(result.features.find(({ name }) => name === 'B closing-tail crossing')).toMatchObject({
      start: 22,
      end: 24,
      subRanges: [{ start: 22, end: 24, strand: 1 }],
    });
    expect(result.features.some(({ name }) => name === 'B closing-tail only')).toBe(false);
    expect(result.features.every(({ start, end }) => start >= 0 && end <= result.sequence.length)).toBe(true);

    const closingJunction = result.features.find((candidate) => (
      candidate.metadata.kind === 'junction_overhang' && candidate.metadata.circular === true
    ));
    expect(closingJunction).toMatchObject({ start: 0, end: 4 });
    expect(closingJunction?.subRanges).toBeUndefined();
  });
});
