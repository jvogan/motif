import { describe, expect, it } from 'vitest';
import {
  analyzeOverlap,
  findOverlap,
  GibsonInputError,
  gibsonAssemble,
  MAX_GIBSON_FRAGMENTS,
  MAX_GIBSON_TOTAL_INPUT_LENGTH,
  validateGibsonFragments,
  validateOverlaps,
  validateOverlapsWithDiagnostics,
} from '../gibson-assembly';

describe('Gibson overlap analysis', () => {
  it('does not certify IUPAC ambiguity symbols as exact homology', () => {
    const ambiguous = 'ACGTACGN';
    const analysis = analyzeOverlap(`TTTT${ambiguous}`, `${ambiguous}GGGG`, 8, 8);
    expect(analysis.selected).toBeNull();
    expect(analysis.reason).toBe('ambiguous_symbols');
    expect(analysis.ambiguous).toBe(true);
    expect(findOverlap(`TTTT${ambiguous}`, `${ambiguous}GGGG`, 8, 8)).toBeNull();
    expect(analyzeOverlap(`TTTT${ambiguous}`, `${ambiguous}GGGG`, 8, 8).reason).toBe('ambiguous_symbols');

    const result = gibsonAssemble([
      { name: 'left', sequence: `TTTT${ambiguous}` },
      { name: 'right', sequence: `${ambiguous}GGGG` },
    ], 8, 8, 'linear');
    expect(result.success).toBe(false);
    expect(result.errors.some((message) => /ambiguity symbols/i.test(message))).toBe(true);
    expect(result.overlapSearches?.[0]).toMatchObject({ reason: 'ambiguous_symbols', unique: false });
  });

  it('enumerates alternate exact lengths and discloses non-uniqueness', () => {
    const analysis = analyzeOverlap('TTTTACGTACGTACGT', 'ACGTACGTACGTAAAA', 8, 12);
    expect(analysis.candidates.map((candidate) => candidate.length)).toEqual([12, 8]);
    expect(analysis.maximalCandidates.map((candidate) => candidate.length)).toEqual([12]);
    expect(analysis.selected?.length).toBe(12);
    expect(analysis.unique).toBe(false);
    expect(analysis.reason).toBe('multiple_exact');
  });

  it('keeps the longest exact overlap for safe legacy assembly while exposing alternatives', () => {
    const result = gibsonAssemble([
      { name: 'left', sequence: 'TTTTACGTACGTACGT' },
      { name: 'right', sequence: 'ACGTACGTACGTAAAA' },
    ], 8, 12, 'linear');
    expect(result.success).toBe(true);
    expect(result.overlaps[0].length).toBe(12);
    expect(result.warnings.some((message) => /alternate exact lengths/i.test(message))).toBe(true);
    expect(result.overlapSearches?.[0].unique).toBe(false);
  });

  it('fails closed when a circular closing overlap consumes the whole product', () => {
    const sequence = 'ACGTACGTACGTACG';
    const result = gibsonAssemble([
      { name: 'duplicate A', sequence },
      { name: 'duplicate B', sequence },
    ], sequence.length, sequence.length, 'circular');

    expect(result.success).toBe(false);
    expect(result.sequence).toBe('');
    expect(result.errors).toContain('Circular Gibson assembly closing overlap consumes the entire assembled product; at least one non-overlap base is required.');
  });

  it('rejects nonfinite, fractional, and out-of-range overlap controls before scanning', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 7, 201, 8.5]) {
      expect(analyzeOverlap('A'.repeat(20), 'A'.repeat(20), value, 20).reason).toBe('invalid_input');
      expect(findOverlap('A'.repeat(20), 'A'.repeat(20), 8, value)).toBeNull();
      expect(gibsonAssemble([
        { name: 'left', sequence: 'A'.repeat(20) },
        { name: 'right', sequence: 'A'.repeat(20) },
      ], value, 20).success).toBe(false);
    }
  });

  it('does not attach a physical topology to an invalid runtime topology request', () => {
    const result = gibsonAssemble([
      { name: 'left', sequence: 'AAAACCCCCCCC' },
      { name: 'right', sequence: 'CCCCCCCCTTTT' },
    ], 8, 8, 'banana' as never);

    expect(result).toMatchObject({
      success: false,
      topology: null,
      requestedTopology: 'banana',
    });
    expect(result.errors.join(' ')).toMatch(/linear.*circular/i);
  });

  it('fails closed on oversized fragment cardinality and total input', () => {
    const tooMany = gibsonAssemble(
      Array.from({ length: MAX_GIBSON_FRAGMENTS + 1 }, (_, index) => ({ name: `part-${index}`, sequence: 'A'.repeat(8) })),
      8,
      8,
    );
    expect(tooMany.success).toBe(false);
    expect(tooMany.errors.join(' ')).toMatch(/at most/);

    const tooLarge = gibsonAssemble([
      { name: 'left', sequence: 'A'.repeat(MAX_GIBSON_TOTAL_INPUT_LENGTH) },
      { name: 'right', sequence: 'A'.repeat(8) },
    ], 8, 8);
    expect(tooLarge.success).toBe(false);
    expect(tooLarge.errors.join(' ')).toMatch(/total|longer/i);
  });

  it('keeps legacy overlap arrays while exposing typed malformed-input diagnostics', () => {
    const fragments = [
      { name: 'left', sequence: 'GCGCGCGCGCGCGCGC' },
      { name: 'right', sequence: 'GCGCGCGCGCGCGCGC' },
    ];
    expect(validateOverlaps(fragments, 16, 16)).toHaveLength(1);
    expect(validateOverlapsWithDiagnostics(fragments, 16, 16)).toMatchObject({
      status: 'valid',
      valid: true,
    });
    expect(() => validateOverlaps([
      { name: 'bad', sequence: 'ACGT!' },
      { name: 'right', sequence: 'ACGT' },
    ], 8, 8)).toThrow(GibsonInputError);
    expect(validateOverlapsWithDiagnostics([
      { name: 'bad', sequence: 'ACGT!' },
      { name: 'right', sequence: 'ACGT' },
    ], 8, 8)).toMatchObject({ status: 'invalid_input', valid: false });
  });

  it('bounds feature metadata as plain UTF-8 data before assembly', () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`label-${index}`, '😀'.repeat(2_048)]),
    );
    const validation = validateGibsonFragments([
      {
        name: 'left',
        sequence: 'AAAAAAAA',
        features: [{
          id: 'feature-id',
          name: 'feature',
          type: 'misc_feature',
          start: 0,
          end: 8,
          strand: 1,
          color: '#888888',
          metadata,
        }],
      },
      { name: 'right', sequence: 'AAAAAAAA' },
    ]);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toMatch(/metadata.*byte/i);
  });
});
