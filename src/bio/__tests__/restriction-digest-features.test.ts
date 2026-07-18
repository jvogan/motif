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
});
