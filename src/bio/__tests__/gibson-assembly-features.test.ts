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

function expectBoundedFeatures(result: { sequence: string; features: Feature[] }): void {
  for (const candidate of result.features) {
    expect(candidate.start).toBeGreaterThanOrEqual(0);
    expect(candidate.end).toBeLessThanOrEqual(result.sequence.length);
    for (const range of candidate.subRanges ?? []) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(result.sequence.length);
      expect(range.end).toBeGreaterThan(range.start);
    }
  }
}

describe('Gibson assembly feature locations', () => {
  it('maps deduplicated overlap pieces and rebuilds their product envelope', () => {
    const result = gibsonAssemble([
      {
        name: 'A',
        sequence: 'AAAACCCGGGTT',
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
    ], 8, 8, 'linear');

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
      start: 4,
      end: 12,
      subRanges: [
        { start: 10, end: 12, strand: -1 },
        { start: 4, end: 6, strand: -1 },
        { start: 6, end: 9, strand: -1 },
      ],
    });
    expect(result.features.find(({ name }) => name === 'overlap-only multipart')).toMatchObject({
      start: 4,
      end: 6,
      subRanges: [{ start: 4, end: 6, strand: 1 }],
    });
    const trimmed = result.features.find(({ name }) => name === 'trimmed multipart');
    expect(trimmed).toMatchObject({ id: 'trimmed multipart-id' });
    expect(trimmed?.metadata.partial).toBeUndefined();
    expectBoundedFeatures(result);
  });

  it('maps the removed closing overlap to the retained origin seam', () => {
    const result = gibsonAssemble([
      { name: 'A', sequence: 'TTTAAAACCC' },
      {
        name: 'B',
        sequence: 'TAAAACCCGGGTTTAAAAC',
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
    ], 8, 8, 'circular');

    expect(result.success).toBe(true);
    expect(result.sequence).toBe('TTTAAAACCCGGG');
    expect(result.features.find(({ name }) => name === 'closing-tail multipart')).toMatchObject({
      start: 6,
      end: 11,
      subRanges: [
        { start: 8, end: 11, strand: -1 },
        { start: 6, end: 8, strand: -1 },
      ],
    });
    expect(result.features.find(({ name }) => name === 'closing-tail crossing')).toMatchObject({
      start: 7,
      end: 10,
    });
    expect(result.features.find(({ name }) => name === 'closing-tail only')).toMatchObject({
      start: 8,
      end: 11,
      subRanges: [{ start: 8, end: 11, strand: 1 }],
    });
    const crossing = result.features.find(({ name }) => name === 'closing-tail crossing');
    expect(crossing?.metadata.partial).toBeUndefined();
    expectBoundedFeatures(result);
  });

  it.each([1, -1] as const)('keeps full-length forward/reverse features bounded through both seams (strand %s)', (strand) => {
    const result = gibsonAssemble([
      {
        name: 'head',
        sequence: 'TTTAAAACCC',
        features: [feature('head feature', { start: 0, end: 10, strand })],
      },
      {
        name: 'tail',
        sequence: 'TAAAACCCGGGTTTAAAAC',
        features: [feature('tail feature', { start: 0, end: 9, strand })],
      },
    ], 8, 8, 'circular');

    expect(result.success).toBe(true);
    expectBoundedFeatures(result);
    expect(result.features.filter(({ name }) => name.endsWith('feature'))).toHaveLength(2);
    expect(result.features.filter(({ name }) => name.endsWith('feature')).every(({ metadata }) => (
      metadata.partial === undefined
    ))).toBe(true);
  });
});
