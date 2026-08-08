import { describe, expect, it } from 'vitest';
import { analyzeOverlap, findOverlap, gibsonAssemble } from '../gibson-assembly';

describe('Gibson overlap analysis', () => {
  it('does not certify IUPAC ambiguity symbols as exact homology', () => {
    const analysis = analyzeOverlap('AAAAANAAAA', 'NAAAA', 5, 5);
    expect(analysis.selected).toBeNull();
    expect(analysis.reason).toBe('ambiguous_symbols');
    expect(analysis.ambiguous).toBe(true);
    expect(findOverlap('AAAAANAAAA', 'NAAAA', 5, 5)).toBeNull();
    expect(analyzeOverlap('TTTTTACGTA', 'ACGTN', 5, 5).reason).toBe('ambiguous_symbols');

    const result = gibsonAssemble([
      { name: 'left', sequence: 'AAAAANAAAA' },
      { name: 'right', sequence: 'NAAAA' },
    ], 5, 5, 'linear');
    expect(result.success).toBe(false);
    expect(result.errors.some((message) => /ambiguity symbols/i.test(message))).toBe(true);
    expect(result.overlapSearches?.[0]).toMatchObject({ reason: 'ambiguous_symbols', unique: false });
  });

  it('enumerates alternate exact lengths and discloses non-uniqueness', () => {
    const analysis = analyzeOverlap('TTTTACGTACGT', 'ACGTACGTAAAA', 4, 8);
    expect(analysis.candidates.map((candidate) => candidate.length)).toEqual([8, 4]);
    expect(analysis.maximalCandidates.map((candidate) => candidate.length)).toEqual([8]);
    expect(analysis.selected?.length).toBe(8);
    expect(analysis.unique).toBe(false);
    expect(analysis.reason).toBe('multiple_exact');
  });

  it('keeps the longest exact overlap for safe legacy assembly while exposing alternatives', () => {
    const result = gibsonAssemble([
      { name: 'left', sequence: 'TTTTACGTACGT' },
      { name: 'right', sequence: 'ACGTACGTAAAA' },
    ], 4, 8, 'linear');
    expect(result.success).toBe(true);
    expect(result.overlaps[0].length).toBe(8);
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
});
