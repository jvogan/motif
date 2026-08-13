import { describe, expect, it } from 'vitest';
import {
  FeatureCollectionInputError,
  MAX_FEATURES_PER_COLLECTION,
  MAX_SUBRANGES_PER_FEATURE,
  snapshotFeatureCollection,
  validateFeatureCollection,
} from '../feature-bounds';
import {
  MAX_RESTRICTION_FEATURE_MAPPING_WORK_UNITS,
  restrictionDigestDetailed,
} from '../restriction-digest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { simulatePCRWithDiagnostics } from '../pcr';
import { reverseComplement } from '../reverse-complement';
import { remapFeatureLocation } from '../feature-location';
import { applyInsertion } from '../mutate';
import { validateGoldenGateOverhangs } from '../golden-gate';
import { buildDigestRecipe } from '../../artifacts/claude-science-digest-recipe';
import type { Feature } from '../types';

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feature-id',
    name: 'feature',
    type: 'misc_feature',
    start: 0,
    end: 20,
    strand: 1,
    color: '#888888',
    metadata: {},
    ...overrides,
  };
}

describe('shared derived-feature bounds', () => {
  it('snapshots only supported feature fields and never executes extra-key accessors', () => {
    const source = feature({
      metadata: { qualifier: { note: 'before' } },
      subRanges: [{ start: 2, end: 6 }],
    }) as Feature & { internal: unknown };
    let extraReads = 0;
    Object.defineProperty(source, 'internal', {
      configurable: true,
      enumerable: true,
      get() {
        extraReads += 1;
        throw new Error('unsupported feature key must not be read');
      },
    });

    const snapshot = snapshotFeatureCollection([source], { sequenceLength: 20 });
    source.metadata.qualifier = { note: 'after' };
    source.subRanges![0].start = 8;

    expect(extraReads).toBe(0);
    expect(snapshot[0]).not.toHaveProperty('internal');
    expect(snapshot[0]?.metadata).toEqual({ qualifier: { note: 'before' } });
    expect(snapshot[0]?.subRanges).toEqual([{ start: 2, end: 6 }]);
  });

  it('rejects an oversized feature array before inspecting dense entries', () => {
    const features = new Array(MAX_FEATURES_PER_COLLECTION + 1) as Feature[];
    Object.defineProperty(features, '0', {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error('oversized feature entry must not be read');
      },
    });
    expect(() => snapshotFeatureCollection(features, { sequenceLength: 20 })).toThrow(/feature limit/i);
  });

  it('rejects custom prototypes and accessor-backed feature fields', () => {
    const customPrototype = Object.create({ inherited: true });
    Object.assign(customPrototype, feature());
    expect(validateFeatureCollection([customPrototype], { sequenceLength: 20 }).issues[0]?.code)
      .toBe('invalid_feature');

    const accessorFeature = feature();
    Object.defineProperty(accessorFeature, 'metadata', {
      configurable: true,
      enumerable: true,
      get: () => ({}),
    });
    const validation = validateFeatureCollection([accessorFeature], { sequenceLength: 20 });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => /accessor/i.test(issue.message))).toBe(true);
  });

  it('rejects accessor-backed collection entries without invoking them', () => {
    let featureReads = 0;
    const features: Feature[] = [];
    Object.defineProperty(features, '0', {
      configurable: true,
      enumerable: true,
      get() {
        featureReads += 1;
        return feature();
      },
    });
    features.length = 1;

    const validation = validateFeatureCollection(features, { sequenceLength: 20 });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'invalid_feature' }));
    expect(featureReads).toBe(0);
  });

  it('rejects an oversized collection before inspecting feature entries', () => {
    const validation = validateFeatureCollection(new Array(MAX_FEATURES_PER_COLLECTION + 1), { sequenceLength: 20 });
    expect(validation.valid).toBe(false);
    expect(validation.complete).toBe(false);
    expect(validation.inspectedFeatureCount).toBe(0);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'feature_limit' }));
  });

  it('bounds metadata-key inspection without materializing the complete key set', () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 50_000 }, (_, index) => [`key-${index}`, index]),
    );
    const originalObjectKeys = Object.keys;
    let completeKeyEnumerationAttempted = false;
    Object.keys = ((value: object) => {
      if (value === metadata) completeKeyEnumerationAttempted = true;
      return originalObjectKeys(value);
    }) as typeof Object.keys;

    try {
      const validation = validateFeatureCollection([feature({ metadata })], { sequenceLength: 20 });
      expect(validation.valid).toBe(false);
      expect(validation.complete).toBe(false);
      expect(validation.issues).toContainEqual(expect.objectContaining({
        code: 'metadata_limit',
        message: expect.stringMatching(/metadata item limit/i),
      }));
      expect(completeKeyEnumerationAttempted).toBe(false);
    } finally {
      Object.keys = originalObjectKeys;
    }
  });

  it('rejects oversized sparse metadata arrays before enumerating their entries', () => {
    const metadata = [] as unknown[];
    metadata.length = 1_000_000;
    Object.defineProperty(metadata, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error('metadata entry must not be read');
      },
    });

    const validation = validateFeatureCollection([feature({ metadata: { values: metadata } })], { sequenceLength: 20 });
    expect(validation.valid).toBe(false);
    expect(validation.complete).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'metadata_limit',
      message: expect.stringMatching(/metadata item limit/i),
    }));
  });

  it('keeps wrapped feature subranges inside one physical side of the envelope', () => {
    const valid = validateFeatureCollection([feature({
      start: 8,
      end: 2,
      subRanges: [
        { start: 8, end: 10, strand: 1 },
        { start: 0, end: 2, strand: 1 },
      ],
    })], {
      sequenceLength: 10,
      allowCircularWrap: true,
    });
    expect(valid.valid).toBe(true);

    const invalid = validateFeatureCollection([feature({
      start: 8,
      end: 2,
      subRanges: [{ start: 3, end: 4, strand: 1 }],
    })], {
      sequenceLength: 10,
      allowCircularWrap: true,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: 'invalid_subrange' }));
    expect(invalid.issues[0]?.message).toMatch(/tail.*head/i);
  });

  it('rejects a 200,000-piece feature without traversing all subranges', () => {
    const oversized = feature({
      subRanges: new Array(200_000) as Array<{ start: number; end: number; strand?: number }>,
    });
    const validation = validateFeatureCollection([oversized], { sequenceLength: 20 });
    expect(validation.valid).toBe(false);
    expect(validation.complete).toBe(false);
    expect(validation.inspectedFeatureCount).toBe(1);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'subrange_limit' }));
    expect(MAX_SUBRANGES_PER_FEATURE).toBeLessThan(200_000);
  });

  it('maps the bounded subrange ceiling with iterative extrema', () => {
    const bounded = feature({
      subRanges: Array.from({ length: MAX_SUBRANGES_PER_FEATURE }, () => ({ start: 0, end: 1, strand: 1 })),
    });
    const remapped = remapFeatureLocation(bounded, [{ start: 0, end: 20, targetStart: 0 }]);
    expect(remapped?.start).toBe(0);
    expect(remapped?.end).toBe(1);
    expect(remapped?.subRanges).toHaveLength(MAX_SUBRANGES_PER_FEATURE);
  });

  it('refuses oversized feature propagation before PCR mapping', () => {
    const binding = 'ACGTTGCAAC';
    const template = `${binding}${'A'.repeat(20)}${binding}`;
    const hugeFeature = feature({
      start: 35,
      end: 5,
      subRanges: new Array(200_000) as Array<{ start: number; end: number; strand?: number }>,
    });
    const outcome = simulatePCRWithDiagnostics(
      template,
      binding,
      reverseComplement(binding),
      [hugeFeature],
      'circular',
      {
        forward: { start: 30, end: 40 },
        reverse: { start: 0, end: 10 },
      },
    );
    expect(outcome.result).toBeNull();
    expect(outcome.diagnostics).toContainEqual(expect.objectContaining({
      code: 'feature_input_limit',
      featureIssueCode: 'subrange_limit',
    }));
  });

  it('refuses oversized feature propagation before restriction digest mapping', () => {
    const hugeFeature = feature({
      end: 12,
      subRanges: new Array(200_000) as Array<{ start: number; end: number; strand?: number }>,
    });
    const result = restrictionDigestDetailed('GAATTCAAAAGAATTC', ['EcoRI'], 'linear', [hugeFeature]);
    expect(result.fragments).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'subrange_limit' }));
  });

  it('digest fragments retain a canonical feature snapshot after the source mutates', () => {
    const sourceFeature = feature({
      start: 0,
      end: 6,
      metadata: { note: 'before' },
    });
    const result = restrictionDigestDetailed('AAAAAAGAATTCAAAAA', ['EcoRI'], 'linear', [sourceFeature]);
    sourceFeature.metadata.note = 'after';
    sourceFeature.start = 4;

    expect(result.issues).toEqual([]);
    expect(result.fragments.flatMap((fragment) => fragment.features)).toEqual(expect.arrayContaining([
      expect.objectContaining({ start: 0, end: 6, metadata: expect.objectContaining({ note: 'before' }) }),
    ]));
  });

  it('reports digest mapping work at both sides of its boundary and propagates an over-limit receipt', () => {
    const sequence = 'GAATTC'.repeat(100);
    const makeFeatures = (count: number) => Array.from({ length: count }, (_, index) => feature({
      id: `feature-${index}`,
      start: 0,
      end: 6,
    }));
    // EcoRI yields 100 physical cuts here, so each linear digest has 101
    // fragments and one source span per fragment. The estimate includes one
    // piece-search plus one feature traversal per feature/fragment pair.
    const justBelow = restrictionDigestDetailed(sequence, ['EcoRI'], 'linear', makeFeatures(4_950));
    expect(justBelow.featureMapping).toMatchObject({ complete: true });
    expect(justBelow.featureMapping?.estimatedWorkUnits).toBeLessThanOrEqual(MAX_RESTRICTION_FEATURE_MAPPING_WORK_UNITS);
    expect(justBelow.issues).toEqual([]);

    const features = makeFeatures(4_951);
    const result = restrictionDigestDetailed(sequence, ['EcoRI'], 'linear', features);

    expect(result.fragments).toEqual([]);
    expect(result.featureMapping).toMatchObject({
      complete: false,
      maxWorkUnits: MAX_RESTRICTION_FEATURE_MAPPING_WORK_UNITS,
      estimatedWorkUnits: expect.any(Number),
    });
    expect(result.featureMapping?.estimatedWorkUnits).toBeGreaterThan(MAX_RESTRICTION_FEATURE_MAPPING_WORK_UNITS);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'feature_mapping_work_limit' }));

    const recipe = buildDigestRecipe({
      sequence,
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'EcoRI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
      features,
    });
    expect(recipe.isValid).toBe(false);
    expect(recipe.featureMapping).toMatchObject({ complete: false });
    expect(recipe.issues).toContainEqual(expect.objectContaining({ code: 'feature_mapping_work_limit' }));
  });

  it('refuses oversized feature propagation before mutation mapping', () => {
    const hugeFeature = feature({
      subRanges: new Array(200_000) as Array<{ start: number; end: number; strand?: number }>,
    });
    expect(() => applyInsertion('A'.repeat(20), [], [hugeFeature], 0, 'C'))
      .toThrow(FeatureCollectionInputError);
  });

  it('refuses oversized feature propagation before Golden Gate mapping', () => {
    const hugeFeature = feature({
      end: 100,
      subRanges: new Array(200_000) as Array<{ start: number; end: number; strand?: number }>,
    });
    const validation = validateGoldenGateOverhangs([{
      name: 'oversized',
      sequence: 'A'.repeat(100),
      features: [hugeFeature],
    }]);
    expect(validation.issues.some((issue) => /subRanges.*piece limit/i.test(issue.description))).toBe(true);
  });
});
