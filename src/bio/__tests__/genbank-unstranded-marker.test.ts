import { describe, expect, it } from 'vitest';

import { parseFeatures } from '../genbank-parser';

function feature(location: string, ...qualifiers: string[]) {
  return parseFeatures([
    `     misc_feature    ${location}`,
    '                     /label="MCS"',
    ...qualifiers.map((qualifier) => `                     ${qualifier}`),
  ].join('\n'))[0];
}

describe('GenBank unstranded marker', () => {
  it('reads a plain location marked /motif_strand="none" as unstranded', () => {
    const parsed = feature('3..12', '/motif_strand="none"');
    expect(parsed.strand).toBe(0);
    expect([parsed.start, parsed.end]).toEqual([2, 12]);
    expect(parsed.metadata.motif_strand).toBe('none');
  });

  it('marks every piece of a plain join unstranded', () => {
    const parsed = feature('join(1..4,8..12)', '/motif_strand="none"');
    expect(parsed.strand).toBe(0);
    expect(parsed.subRanges?.map((part) => part.strand)).toEqual([0, 0]);
  });

  it('keeps a plain location without the marker forward', () => {
    expect(feature('3..12').strand).toBe(1);
    expect(feature('3..12', '/motif_strand="forward"').strand).toBe(1);
    expect(feature('3..12', '/note="motif_strand none"').strand).toBe(1);
  });

  it('lets a location that states its direction win over a stale marker', () => {
    expect(feature('complement(3..12)', '/motif_strand="none"').strand).toBe(-1);
    const mixed = feature('join(1..4,complement(8..12))', '/motif_strand="none"');
    expect(mixed.subRanges?.map((part) => part.strand)).toEqual([1, -1]);
  });
});
