import { describe, expect, it } from 'vitest';
import { restrictionDigest } from '../restriction-digest';
import type { Feature } from '../types';

describe('restriction digest feature propagation', () => {
  it('carries a complete origin-spanning multipart feature onto the wrapping fragment', () => {
    const sequence = 'GAATTCAAAAGAATTC';
    const feature: Feature = {
      id: 'origin-feature',
      name: 'origin join',
      type: 'cds',
      start: 0,
      end: 15,
      strand: 1,
      color: '#888888',
      metadata: {},
      subRanges: [
        { start: 12, end: 15, strand: 1 },
        { start: 0, end: 1, strand: 1 },
      ],
    };

    const fragments = restrictionDigest(sequence, ['EcoRI'], 'circular', [feature]);
    const wrapping = fragments.find((fragment) => fragment.endInOriginal > sequence.length);

    expect(wrapping).toBeDefined();
    expect(wrapping?.features).toHaveLength(1);
    expect(wrapping?.features[0]).toMatchObject({
      name: 'origin join',
      start: 1,
      end: 6,
      subRanges: [
        { start: 1, end: 4, strand: 1 },
        { start: 5, end: 6, strand: 1 },
      ],
    });
  });

  it('expands aggregate origin wraps before mapping and preserves reverse order', () => {
    const sequence = 'GAATTCAAAAGAATTC';
    const features: Feature[] = [
      {
        id: 'forward-wrap',
        name: 'forward wrap',
        type: 'cds',
        start: 12,
        end: 1,
        strand: 1,
        color: '#888888',
        metadata: { source: 'aggregate' },
      },
      {
        id: 'reverse-wrap',
        name: 'reverse wrap',
        type: 'cds',
        start: 12,
        end: 1,
        strand: -1,
        color: '#777777',
        metadata: { source: 'aggregate' },
      },
    ];

    const wrapping = restrictionDigest(sequence, ['EcoRI'], 'circular', features)
      .find((fragment) => fragment.endInOriginal > sequence.length);

    expect(wrapping?.features).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        name: 'forward wrap',
        start: 1,
        end: 6,
        strand: 1,
        subRanges: [
          { start: 1, end: 5, strand: 1 },
          { start: 5, end: 6, strand: 1 },
        ],
        metadata: { source: 'aggregate' },
      }),
      expect.objectContaining({
        id: expect.any(String),
        name: 'reverse wrap',
        start: 1,
        end: 6,
        strand: -1,
        subRanges: [
          { start: 5, end: 6, strand: -1 },
          { start: 1, end: 5, strand: -1 },
        ],
        metadata: { source: 'aggregate' },
      }),
    ]);
  });

  it('maps an aggregate wrap on an uncut circular whole fragment', () => {
    const feature: Feature = {
      id: 'whole-wrap',
      name: 'whole wrap',
      type: 'misc_feature',
      start: 3,
      end: 1,
      strand: 1,
      color: '#666666',
      metadata: { source: 'aggregate' },
    };

    const [fragment] = restrictionDigest('AAAA', ['EcoRI'], 'circular', [feature]);

    expect(fragment.features).toMatchObject([{
      name: 'whole wrap',
      start: 0,
      end: 4,
      subRanges: [
        { start: 3, end: 4, strand: 1 },
        { start: 0, end: 1, strand: 1 },
      ],
      metadata: { source: 'aggregate' },
    }]);
  });
});
