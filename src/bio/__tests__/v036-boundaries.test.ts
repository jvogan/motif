import { describe, expect, it } from 'vitest';
import {
  buildSyntheticGoldenGateVector,
  getGoldenGatePartBoundary,
  goldenGateAssemble,
  MAX_GOLDEN_GATE_CHAIN_WORK_UNITS,
  MAX_GOLDEN_GATE_PART_LENGTH,
  MAX_GOLDEN_GATE_PARTS,
  MAX_GOLDEN_GATE_SUBRANGES_PER_FEATURE,
  scanGoldenGateSites,
  validateGoldenGateParts,
  validateGoldenGateOverhangs,
} from '../golden-gate';
import { formatMSA, type LegacyMSAResult } from '../msa';
import { applySubstitution } from '../mutate';

describe('v0.3.6 adversarial boundaries', () => {
  it('fails closed for accessor-backed parts and arrays without invoking them', () => {
    let nameAccessed = false;
    const accessorPart = { sequence: 'ACGT' } as Record<string, unknown>;
    Object.defineProperty(accessorPart, 'name', {
      get() {
        nameAccessed = true;
        throw new Error('unexpected accessor execution');
      },
      enumerable: true,
    });
    const validation = validateGoldenGateParts([accessorPart]);
    expect(validation.valid).toBe(false);
    expect(nameAccessed).toBe(false);
    expect(() => getGoldenGatePartBoundary(accessorPart as never)).not.toThrow();

    const throwingArray = new Proxy([{ name: 'part', sequence: 'ACGT' }], {
      getOwnPropertyDescriptor() {
        throw new Error('unexpected array access');
      },
    });
    expect(validateGoldenGateParts(throwingArray)).toMatchObject({ valid: false });
    expect(validateGoldenGateOverhangs(throwingArray as never, 'BsaI')).toMatchObject({ valid: false });
  });

  it('caps Golden Gate part collections before digest or result expansion', () => {
    const parts = Array.from({ length: MAX_GOLDEN_GATE_PARTS + 1 }, (_, index) => ({
      name: `part-${index}`,
      sequence: 'A',
    }));

    const result = goldenGateAssemble(parts);

    expect(result.success).toBe(false);
    expect(result.status).toBe('work_limit');
    expect(result.errors.join(' ')).toMatch(/at most .* parts/i);
    expect(result.parts).toHaveLength(MAX_GOLDEN_GATE_PARTS + 1);
  });

  it('rejects a feature with too many authoritative subranges before mapping', () => {
    const vector = buildSyntheticGoldenGateVector('ATGC', 'GCTA', { name: 'bounded-feature' });
    const start = 0;
    const end = vector.sequence.length;
    const feature = {
      id: 'feature-id',
      name: 'many-ranges',
      type: 'cds' as const,
      start,
      end,
      strand: 1 as const,
      color: '#888888',
      metadata: {},
      subRanges: Array.from({ length: MAX_GOLDEN_GATE_SUBRANGES_PER_FEATURE + 1 }, () => ({
        start: 0,
        end: 1,
        strand: 1,
      })),
    };

    const result = goldenGateAssemble([
      { ...vector, features: [feature] },
      buildSyntheticGoldenGateVector('GCTA', 'ATGC', { name: 'second' }),
    ]);

    expect(result.success).toBe(false);
    expect(result.status).toBe('work_limit');
    expect(result.errors.join(' ')).toMatch(/subRanges.*limit/i);
  });

  it('rejects per-part and aggregate sequence lengths before site scanning', () => {
    const tooLong = goldenGateAssemble([
      { name: 'too-long', sequence: 'A'.repeat(MAX_GOLDEN_GATE_PART_LENGTH + 1) },
      { name: 'other', sequence: 'A' },
    ]);
    expect(tooLong.status).toBe('work_limit');
    expect(tooLong.errors.join(' ')).toMatch(/exceeds .* bp/i);

    const tooMuchTotal = goldenGateAssemble([
      { name: 'one', sequence: 'A'.repeat(400_001) },
      { name: 'two', sequence: 'A'.repeat(400_001) },
      { name: 'three', sequence: 'A'.repeat(400_001) },
    ]);
    expect(tooMuchTotal.status).toBe('work_limit');
    expect(tooMuchTotal.errors.join(' ')).toMatch(/total/i);
  });

  it('rejects metadata collections that exceed the shared validation work limit', () => {
    const vector = buildSyntheticGoldenGateVector('ATGC', 'GCTA', { name: 'metadata-bounded' });
    const metadata = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key-${index}`, index]));
    const result = goldenGateAssemble([
      {
        ...vector,
        features: [{
          id: 'metadata-feature',
          name: 'metadata-heavy',
          type: 'misc_feature',
          start: 0,
          end: vector.sequence.length,
          strand: 1,
          color: '#888888',
          metadata,
        }],
      },
      buildSyntheticGoldenGateVector('GCTA', 'ATGC', { name: 'second' }),
    ]);

    expect(result.status).toBe('work_limit');
    expect(result.errors.join(' ')).toMatch(/metadata/i);
  });

  it('applies one aggregate feature-work budget across all Golden Gate parts', () => {
    const subRanges = Array.from({ length: MAX_GOLDEN_GATE_SUBRANGES_PER_FEATURE }, () => ({
      start: 0,
      end: 1,
      strand: 1 as const,
    }));
    const feature = {
      id: 'shared-feature',
      name: 'bounded-work',
      type: 'misc_feature' as const,
      start: 0,
      end: 1,
      strand: 1 as const,
      color: '#888888',
      metadata: {},
      subRanges,
    };
    const parts = Array.from({ length: MAX_GOLDEN_GATE_PARTS }, (_, index) => ({
      name: `part-${index}`,
      sequence: 'A',
      features: [feature, feature],
    }));

    const validation = validateGoldenGateParts(parts);

    expect(validation.valid).toBe(false);
    expect(validation.status).toBe('work_limit');
    expect(validation.errors.join(' ')).toMatch(/across all parts|feature validation.*limit/i);
  });

  it('caps detected Golden Gate sites and reports an incomplete scan', () => {
    const scan = scanGoldenGateSites(
      'GGTCTC'.repeat(11_000),
      'BsaI',
      { includeOutOfBounds: true },
    );

    expect(scan.complete).toBe(false);
    expect(scan.sites.length).toBeLessThanOrEqual(10_000);
    expect(scan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'site_limit' }),
    ]));
  });

  it('stops compatible-part chain enumeration with an explicit work result', () => {
    const parts = Array.from({ length: 8 }, (_, index) => buildSyntheticGoldenGateVector('ATGC', 'ATGC', {
      name: `self-compatible-${index}`,
    }));

    const result = goldenGateAssemble(parts);

    expect(result.success).toBe(false);
    expect(result.status).toBe('work_limit');
    expect(result.errors.join(' ')).toMatch(new RegExp(`${MAX_GOLDEN_GATE_CHAIN_WORK_UNITS.toLocaleString()}-unit|chain enumeration`, 'i'));
  });

  it('rejects legacy MSA output whose repeated names would exceed the byte/line budget', () => {
    const alignmentLength = 20_000;
    const rows = 100;
    const sequences = Array.from({ length: rows }, (_, index) => ({
      name: `${String(index).padStart(3, '0')}${'x'.repeat(253)}`,
      aligned: 'A'.repeat(alignmentLength),
      original: 'A',
    }));
    const result: LegacyMSAResult = {
      sequences,
      consensusSequence: 'A'.repeat(alignmentLength),
      conservationScores: Array.from({ length: alignmentLength }, () => 1),
      identity: 100,
      gaps: 0,
      alignmentLength,
      conservedColumns: alignmentLength,
    };

    expect(() => formatMSA(result, { width: 1 })).toThrow(/bytes|lines/i);
  });

  it('rejects control characters in legacy MSA labels and aligned rows', () => {
    const base: LegacyMSAResult = {
      sequences: [
        { name: 'alpha', aligned: 'AA', original: 'AA' },
        { name: 'beta', aligned: 'AA', original: 'AA' },
      ],
      consensusSequence: 'AA',
      conservationScores: [1, 1],
      identity: 100,
      gaps: 0,
      alignmentLength: 2,
      conservedColumns: 2,
    };

    expect(() => formatMSA({ ...base, sequences: [{ ...base.sequences[0], name: 'bad\nname' }, base.sequences[1]] })).toThrow(/control/i);
    expect(() => formatMSA({ ...base, sequences: [{ ...base.sequences[0], aligned: 'A\t' }, base.sequences[1]] })).toThrow(/control/i);
  });

  it('canonicalizes lowercase substitution residues for each molecule type', () => {
    expect(applySubstitution('AAAA', [], [], 0, 'c', 'dna').raw).toBe('CAAA');
    expect(applySubstitution('AAAA', [], [], 0, 'u', 'rna').raw).toBe('UAAA');
    expect(applySubstitution('MKW', [], [], 1, 'r', 'protein').raw).toBe('MRW');
  });
});
