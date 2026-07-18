import { describe, expect, it } from 'vitest';
import { gibsonAssemble } from '../gibson-assembly';
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

describe('Gibson assembly feature locations', () => {
  it('clips authoritative multipart pieces and rebuilds their product envelope', () => {
    const result = gibsonAssemble([
      {
        name: 'A',
        sequence: 'AAAACCC',
        features: [feature('first multipart', {
          start: 0,
          end: 7,
          strand: -1,
          subRanges: [
            { start: 4, end: 6, strand: -1 },
            { start: 1, end: 2, strand: -1 },
          ],
        })],
      },
      {
        name: 'B',
        sequence: 'CCCGGGTTT',
        features: [
          feature('trimmed multipart', {
            start: 0,
            end: 8,
            strand: -1,
            subRanges: [
              { start: 6, end: 8, strand: -1 },
              { start: 0, end: 2, strand: -1 },
              { start: 2, end: 5, strand: -1 },
            ],
          }),
          feature('overlap-only multipart', {
            start: 0,
            end: 8,
            subRanges: [{ start: 0, end: 2, strand: 1 }],
          }),
        ],
      },
    ], 3, 3, 'linear');

    expect(result.success).toBe(true);
    expect(result.sequence).toBe('AAAACCCGGGTTT');
    expect(result.features.find(({ name }) => name === 'first multipart')).toMatchObject({
      start: 1,
      end: 6,
      subRanges: [
        { start: 4, end: 6, strand: -1 },
        { start: 1, end: 2, strand: -1 },
      ],
    });
    expect(result.features.find(({ name }) => name === 'trimmed multipart')).toMatchObject({
      start: 7,
      end: 12,
      subRanges: [
        { start: 10, end: 12, strand: -1 },
        { start: 7, end: 9, strand: -1 },
      ],
    });
    expect(result.features.some(({ name }) => name === 'overlap-only multipart')).toBe(false);
  });

  it('clips features after removing the duplicate closing overlap', () => {
    const result = gibsonAssemble([
      { name: 'A', sequence: 'TTTAAAACCC' },
      {
        name: 'B',
        sequence: 'CCCGGGTTT',
        features: [
          feature('closing-tail multipart', {
            start: 4,
            end: 9,
            strand: -1,
            subRanges: [
              { start: 6, end: 9, strand: -1 },
              { start: 4, end: 6, strand: -1 },
            ],
          }),
          feature('closing-tail crossing', { start: 5, end: 8 }),
          feature('closing-tail only', {
            start: 4,
            end: 9,
            subRanges: [{ start: 6, end: 9, strand: 1 }],
          }),
        ],
      },
    ], 3, 3, 'circular');

    expect(result.success).toBe(true);
    expect(result.sequence).toBe('TTTAAAACCCGGG');
    expect(result.features.find(({ name }) => name === 'closing-tail multipart')).toMatchObject({
      start: 11,
      end: 13,
      subRanges: [{ start: 11, end: 13, strand: -1 }],
    });
    expect(result.features.find(({ name }) => name === 'closing-tail crossing')).toMatchObject({
      start: 12,
      end: 13,
    });
    expect(result.features.some(({ name }) => name === 'closing-tail only')).toBe(false);
    expect(result.features.every(({ start, end }) => start >= 0 && end <= result.sequence.length)).toBe(true);
  });
});
