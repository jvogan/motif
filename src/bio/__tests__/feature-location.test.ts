import { describe, expect, it } from 'vitest';
import {
  extractFeatureSequence,
  featureGenBankLocation,
  featureLocationLength,
  featureLocationSegments,
  isAmbiguousFeatureLocation,
  isMaterializableFeatureLocation,
  isMultipartFeature,
  isQuarantinedFeatureLocation,
  remapFeatureLocation,
} from '../feature-location';
import { parseFeatures } from '../genbank-parser';
import { reverseComplement, reverseComplementFeatures } from '../reverse-complement';
import {
  mapFeatureThroughSourceCoordinates,
  mapFeaturesThroughSourceCoordinates,
  MAX_MAPPED_FEATURE_PIECES,
  MAX_SOURCE_TO_PRODUCT_RUNS,
} from '../assembly-feature-mapping';
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

  it.each(['1.3', '1..3junk'])(
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

  it('retains valid but unprojectable INSDC locations as feature-specific quarantines', () => {
    const features = parseFeatures([
      '     misc_feature    100^101',
      '                     /label="between"',
      '     misc_feature    J00194.1:100..200',
      '                     /label="remote"',
      '     misc_feature    1..3',
      '                     /label="local"',
    ].join('\n'));

    expect(features).toHaveLength(3);
    expect(features.slice(0, 2).every(isQuarantinedFeatureLocation)).toBe(true);
    expect(features[0].metadata).toMatchObject({
      motifOriginalLocation: '100^101',
      motifLocationQuarantined: true,
      motifImportDiagnostics: [expect.objectContaining({ code: 'between_base_location', featureKey: 'misc_feature' })],
    });
    expect(features[1].metadata).toMatchObject({
      motifOriginalLocation: 'J00194.1:100..200',
      motifLocationQuarantined: true,
      motifImportDiagnostics: [expect.objectContaining({ code: 'remote_location', featureKey: 'misc_feature' })],
    });
    expect(features[2].metadata.motifLocationQuarantined).toBeUndefined();
  });

  it.each([
    'one-of(6,9)',
    'one-of(6,9)..12',
    'complement(one-of(6,9)..12)',
    'join(1..2,one-of(6,9)..12)',
  ])('quarantines valid ambiguous INSDC location %s without aborting the record', (location) => {
    const [feature] = parseFeatures([
      `     misc_feature    ${location}`,
      '                     /label="ambiguous"',
    ].join('\n'));

    expect(isQuarantinedFeatureLocation(feature)).toBe(true);
    expect(feature.metadata).toMatchObject({
      motifOriginalLocation: location,
      motifLocationQuarantined: true,
      motifLocationAmbiguous: true,
      motifImportDiagnostics: [expect.objectContaining({
        code: 'ambiguous_location',
        location,
      })],
    });
  });

  it('does not remap quarantined or non-materializable placeholders into derived records', () => {
    const [quarantined] = parseFeatures([
      '     misc_feature    J00194.1:100..200',
      '                     /label="remote"',
    ].join('\n'));
    expect(remapFeatureLocation(quarantined, [{ start: 0, end: 1, targetStart: 0 }])).toBeNull();
    expect(mapFeatureThroughSourceCoordinates(quarantined, {
      sourceLength: 1,
      productLength: 1,
      sourceToProduct: [0],
    })).toBeNull();

    const ordered = parsedFeature('order(1..3,10..12)');
    expect(remapFeatureLocation(ordered, [{ start: 0, end: 12, targetStart: 0 }])).toBeNull();
    expect(mapFeatureThroughSourceCoordinates(ordered, {
      sourceLength: 12,
      productLength: 12,
      sourceToProduct: Array.from({ length: 12 }, (_, index) => index),
    })).toBeNull();
  });

  it('maps many long features through one dense identity map without a base walk per feature', () => {
    const sourceLength = 200_000;
    const map = {
      sourceLength,
      productLength: sourceLength,
      sourceToProduct: Array.from({ length: sourceLength }, (_, index) => index),
    };
    const features = Array.from({ length: 500 }, (_, index) => feature({
      id: `long-${index}`,
      name: `long-${index}`,
      end: sourceLength,
    }));

    const result = mapFeaturesThroughSourceCoordinates(features, map);

    expect(result.status).toBe('ready');
    expect(result.complete).toBe(true);
    expect(result.features).toHaveLength(features.length);
    expect(result.estimatedWorkUnits).toBeLessThan(sourceLength + features.length * 4);
    expect(result.features[0]).toMatchObject({ start: 0, end: sourceLength });
  });

  it('refuses an alternating coordinate map before materializing unbounded pieces', () => {
    const sourceLength = MAX_SOURCE_TO_PRODUCT_RUNS * 2 + 1;
    const map = {
      sourceLength,
      productLength: sourceLength,
      sourceToProduct: Array.from({ length: sourceLength }, (_, index) => index % 2),
    };

    const result = mapFeaturesThroughSourceCoordinates([feature({ end: sourceLength })], map);

    expect(result.status).toBe('work_limit');
    expect(result.complete).toBe(false);
    expect(result.features).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'map_work_limit' }));
  });

  it('uses bounded run intersections for many late multipart ranges', () => {
    const sourceLength = 40_000;
    const map = {
      sourceLength,
      productLength: 1,
      sourceToProduct: Array.from({ length: sourceLength }, () => 0),
    };
    const subRanges = Array.from({ length: 512 }, (_, index) => ({
      start: sourceLength - 512 + index,
      end: sourceLength - 511 + index,
      strand: 1 as const,
    }));
    const result = mapFeaturesThroughSourceCoordinates([feature({ end: sourceLength, subRanges })], map, {
      maxWorkUnits: 50_000,
    });

    expect(result.status).toBe('ready');
    expect(result.estimatedWorkUnits).toBeLessThan(50_000);
    expect(result.estimatedWorkUnits).toBeGreaterThan(48_000);
    expect(result.features[0]?.subRanges).toHaveLength(subRanges.length);
  });

  it('caps total mapped pieces across all ranges of one feature', () => {
    const rangeLength = 6_000;
    const sourceLength = rangeLength * 2;
    const map = {
      sourceLength,
      productLength: 1,
      sourceToProduct: Array.from({ length: sourceLength }, () => 0),
    };
    const result = mapFeaturesThroughSourceCoordinates([feature({
      end: sourceLength,
      subRanges: [
        { start: 0, end: rangeLength, strand: 1 },
        { start: rangeLength, end: sourceLength, strand: 1 },
      ],
    })], map);

    expect(result.status).toBe('work_limit');
    expect(result.features).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'mapped_piece_limit',
    }));
    expect(rangeLength * 2).toBeGreaterThan(MAX_MAPPED_FEATURE_PIECES);
  });

  it('rejects sparse and accessor-backed coordinate maps without invoking accessors', () => {
    const sparse = [0, 1, 3] as Array<number | null>;
    sparse.length = 4;
    const sparseResult = mapFeaturesThroughSourceCoordinates([feature({ end: 4 })], {
      sourceLength: 4,
      productLength: 4,
      sourceToProduct: sparse,
    });
    expect(sparseResult.status).toBe('invalid_input');
    expect(sparseResult.issues).toContainEqual(expect.objectContaining({ code: 'invalid_map' }));

    let getterReads = 0;
    const accessorMap = {} as Record<string, unknown>;
    Object.defineProperty(accessorMap, 'sourceLength', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterReads += 1;
        return 4;
      },
    });
    Object.defineProperty(accessorMap, 'productLength', { value: 4, enumerable: true });
    Object.defineProperty(accessorMap, 'sourceToProduct', { value: [0, 1, 2, 3], enumerable: true });
    const accessorResult = mapFeaturesThroughSourceCoordinates([feature({ end: 4 })], accessorMap as never);
    expect(accessorResult.status).toBe('invalid_input');
    expect(getterReads).toBe(0);
  });

  it('preserves repeated qualifier order, multiline values, and escaped quotes', () => {
    const [feature] = parseFeatures([
      '     misc_feature    1..3',
      '                     /note="first line',
      '                     second ""quoted"" line"',
      '                     /note="second"',
      '                     /pseudo',
    ].join('\n'));

    expect(feature.metadata.note).toBe('second');
    expect(feature.metadata.motifQualifiers).toEqual([
      { key: 'note', value: 'first line second "quoted" line' },
      { key: 'note', value: 'second' },
      { key: 'pseudo', value: true },
    ]);
  });
});
