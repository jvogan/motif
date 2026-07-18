import { describe, expect, it } from 'vitest';
import {
  extractFeatureSequence,
  featureGenBankLocation,
  featureLocationLength,
  featureLocationSegments,
  isAmbiguousFeatureLocation,
  isMaterializableFeatureLocation,
  isMultipartFeature,
  remapFeatureLocation,
} from '../feature-location';
import { parseFeatures } from '../genbank-parser';
import { reverseComplement, reverseComplementFeatures } from '../reverse-complement';
import type { Feature } from '../types';

const SEQUENCE = 'ATGCCCGGGCCATTTAAA';

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feature-1',
    name: 'test feature',
    type: 'cds',
    start: 0,
    end: 12,
    strand: 1,
    color: '#888888',
    metadata: {},
    ...overrides,
  };
}

function parsedFeature(location: string): Feature {
  const result = parseFeatures([
    `     CDS             ${location}`,
    '                     /label="joined CDS"',
  ].join('\n'));
  expect(result).toHaveLength(1);
  return result[0];
}

describe('feature location semantics', () => {
  it('concatenates forward join pieces and excludes intervening bases', () => {
    const joined = parsedFeature('join(1..3,10..12)');

    expect(featureLocationSegments(joined)).toEqual([
      { start: 0, end: 3, strand: 1 },
      { start: 9, end: 12, strand: 1 },
    ]);
    expect(featureLocationLength(joined)).toBe(6);
    expect(isMultipartFeature(joined)).toBe(true);
    expect(extractFeatureSequence(SEQUENCE, joined, 'dna')).toBe('ATGCCA');
    expect(featureGenBankLocation(joined)).toBe('join(1..3,10..12)');
  });

  it('normalizes complement(join(...)) into biological order', () => {
    const reverseJoined = parsedFeature('complement(join(1..3,10..12))');

    expect(featureLocationSegments(reverseJoined)).toEqual([
      { start: 9, end: 12, strand: -1 },
      { start: 0, end: 3, strand: -1 },
    ]);
    expect(extractFeatureSequence(SEQUENCE, reverseJoined, 'dna')).toBe('TGGCAT');
    expect(featureGenBankLocation(reverseJoined)).toBe('complement(join(1..3,10..12))');
  });

  it('keeps explicit per-piece complements distinct from an outer complement', () => {
    const individuallyReversed = parsedFeature('join(complement(1..3),complement(10..12))');

    expect(featureLocationSegments(individuallyReversed)).toEqual([
      { start: 0, end: 3, strand: -1 },
      { start: 9, end: 12, strand: -1 },
    ]);
    expect(extractFeatureSequence(SEQUENCE, individuallyReversed, 'dna')).toBe('CATTGG');
    expect(featureGenBankLocation(individuallyReversed)).toBe('complement(join(10..12,1..3))');
  });

  it('preserves mixed segment orientation inside a join', () => {
    const mixed = parsedFeature('join(complement(1..3),10..12)');

    expect(mixed.strand).toBe(0);
    expect(extractFeatureSequence(SEQUENCE, mixed, 'dna')).toBe('CATCCA');
    expect(featureGenBankLocation(mixed)).toBe('join(complement(1..3),10..12)');
  });

  it('keeps an outer-complemented mixed location mixed while reversing its pieces', () => {
    const mixed = parsedFeature('complement(join(complement(1..3),10..12))');

    expect(mixed.strand).toBe(0);
    expect(featureLocationSegments(mixed)).toEqual([
      { start: 9, end: 12, strand: -1 },
      { start: 0, end: 3, strand: 1 },
    ]);
  });

  it('preserves order(...) without pretending its pieces form one sequence', () => {
    const ordered = parsedFeature('order(1..3,10..12)');

    expect(ordered.metadata.motifLocationOperator).toBe('order');
    expect(featureLocationLength(ordered)).toBe(6);
    expect(extractFeatureSequence(SEQUENCE, ordered, 'dna')).toBe('');
    expect(featureGenBankLocation(ordered)).toBe('order(1..3,10..12)');
  });

  it('fails closed for an unmarked reverse multipart checkpoint', () => {
    const ambiguous = feature({
      strand: -1,
      metadata: { motifSubRangeOrderAmbiguous: true },
      subRanges: [
        { start: 9, end: 12, strand: -1 },
        { start: 0, end: 3, strand: -1 },
      ],
    });

    expect(isAmbiguousFeatureLocation(ambiguous)).toBe(true);
    expect(isMaterializableFeatureLocation(ambiguous)).toBe(false);
    expect(extractFeatureSequence(SEQUENCE, ambiguous, 'dna')).toBe('');
    expect(featureGenBankLocation(ambiguous)).toBe('complement(order(1..3,10..12))');
  });

  it('extracts an origin-spanning circular join in stored order', () => {
    const wrapped = feature({
      start: 0,
      end: SEQUENCE.length,
      subRanges: [
        { start: 15, end: 18, strand: 1 },
        { start: 0, end: 3, strand: 1 },
      ],
    });

    expect(extractFeatureSequence(SEQUENCE, wrapped, 'dna')).toBe('AAAATG');
    expect(featureLocationLength(wrapped)).toBe(6);
    expect(featureGenBankLocation(wrapped)).toBe('join(16..18,1..3)');
  });

  it('preserves the feature product when a whole record is reverse-complemented', () => {
    const sourceFeature = parsedFeature('join(1..3,10..12)');
    const transformedSequence = reverseComplement(SEQUENCE);
    const transformedFeature = reverseComplementFeatures([sourceFeature], SEQUENCE.length)[0];

    expect(featureLocationSegments(transformedFeature)).toEqual([
      { start: 15, end: 18, strand: -1 },
      { start: 6, end: 9, strand: -1 },
    ]);
    expect(extractFeatureSequence(transformedSequence, transformedFeature, 'dna')).toBe(
      extractFeatureSequence(SEQUENCE, sourceFeature, 'dna'),
    );
  });

  it('lets legacy pieces inherit the feature strand', () => {
    const legacy = feature({
      strand: -1,
      subRanges: [{ start: 9, end: 12 }, { start: 0, end: 3 }],
    });

    expect(extractFeatureSequence(SEQUENCE, legacy, 'dna')).toBe('TGGCAT');
    expect(featureGenBankLocation(legacy)).toBe('complement(join(1..3,10..12))');
  });

  it('remaps all pieces through an origin-wrapping child sequence', () => {
    const wrapped = feature({
      start: 0,
      end: 18,
      subRanges: [
        { start: 15, end: 18, strand: 1 },
        { start: 0, end: 3, strand: 1 },
      ],
    });

    expect(remapFeatureLocation(wrapped, [
      { start: 12, end: 18, targetStart: 0 },
      { start: 0, end: 6, targetStart: 6 },
    ])).toEqual({
      start: 3,
      end: 9,
      subRanges: [
        { start: 3, end: 6, strand: 1 },
        { start: 6, end: 9, strand: 1 },
      ],
    });
  });

  it('rejects a feature when any authoritative piece crosses a cut boundary', () => {
    const joined = parsedFeature('join(1..3,10..12)');
    expect(remapFeatureLocation(joined, [{ start: 0, end: 10, targetStart: 0 }])).toBeNull();
  });

  it('never resurrects an explicit empty location from its aggregate envelope', () => {
    const empty = feature({ subRanges: [] });

    expect(featureLocationSegments(empty)).toEqual([]);
    expect(featureLocationLength(empty)).toBe(0);
    expect(extractFeatureSequence(SEQUENCE, empty, 'dna')).toBe('');
    expect(remapFeatureLocation(empty, [{ start: 0, end: SEQUENCE.length, targetStart: 0 }])).toBeNull();
    expect(() => featureGenBankLocation(empty)).toThrow(/explicit empty location/i);
  });

  it('ignores a reserved order marker on a single contiguous segment', () => {
    const contiguous = feature({ metadata: { motifLocationOperator: 'order' } });

    expect(extractFeatureSequence(SEQUENCE, contiguous, 'dna')).toBe(SEQUENCE.slice(0, 12));
    expect(featureGenBankLocation(contiguous)).toBe('1..12');
  });

  it.each(['100^101', '1.3', 'AB123:1..3', '1..3junk'])(
    'surfaces unsupported location syntax %s instead of truncating it',
    (location) => {
      expect(() => parseFeatures([
        `     CDS             ${location}`,
        '                     /label="unsupported"',
      ].join('\n'))).toThrow(/unsupported location/i);
    },
  );

  it('retains valid INSDC fuzzy bounds as guarded round-trip metadata', () => {
    const fuzzy = parsedFeature('<1..>3');

    expect(featureLocationSegments(fuzzy)).toEqual([{ start: 0, end: 3, strand: 1 }]);
    expect(fuzzy.metadata).toMatchObject({
      motifOriginalLocation: '<1..>3',
      motifLocationFuzzy: true,
    });
  });
});
