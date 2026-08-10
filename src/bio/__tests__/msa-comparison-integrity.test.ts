import { describe, expect, it } from 'vitest';
import { computeMSA, estimateMsaWork, isMSAError, MSA_MAX_SEQUENCES, multipleAlign } from '../msa';
import { sequenceDiff } from '../sequence-diff';

describe('bounded sequence comparison integrity', () => {
  it('keeps the exact full-matrix route explicit for small inputs', () => {
    const result = sequenceDiff('ACGT', 'ACGT', { molecule: 'dna' });
    expect(result.status).toBe('ok');
    expect(result.method).toBe('needleman-wunsch');
    expect(result.algorithm).toMatch(/Needleman/);
    expect(result.fallback).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('uses an indel-aware linear-space route above 25M cells', () => {
    const reference = 'A'.repeat(5_001);
    const inserted = `T${reference}`;
    const result = sequenceDiff(reference, inserted, { molecule: 'dna' });
    expect(result.status).toBe('ok');
    expect(result.method).toBe('linear-space-needleman-wunsch');
    expect(result.fallback).toBe(true);
    expect(result.aligned1.slice(0, 3)).toBe('-AA');
    expect(result.aligned2.slice(0, 3)).toBe('TAA');
    expect(result.insertions).toBe(1);
    expect(result.identity).toBeGreaterThan(99);
    expect(result.warnings.join(' ')).toMatch(/25M/);

    const deleted = sequenceDiff(inserted, reference, { molecule: 'dna' });
    expect(deleted.aligned1.slice(0, 3)).toBe('TAA');
    expect(deleted.aligned2.slice(0, 3)).toBe('-AA');
  }, 60_000);

  it('does not claim a result when input symbols or work bounds are invalid', () => {
    expect(sequenceDiff('ACGT!', 'ACGT', { molecule: 'dna' })).toMatchObject({
      status: 'invalid',
      method: 'validation',
    });
    expect(sequenceDiff('A'.repeat(10), 'A'.repeat(10), { molecule: 'dna', maxCells: 1 })).toMatchObject({
      status: 'work-limit',
      aligned1: '',
      aligned2: '',
    });
  });

  it('shares DNA and protein ambiguity semantics with the MSA result', () => {
    const dna = sequenceDiff('N', 'A', { molecule: 'dna' });
    const protein = sequenceDiff('BZXJ', 'D E Q I'.replace(/ /g, ''), { molecule: 'protein' });
    expect(dna).toMatchObject({ identity: 100, ambiguousMatches: 1, mismatches: 0 });
    expect(protein).toMatchObject({ identity: 100, ambiguousMatches: 4, mismatches: 0 });
    expect(sequenceDiff('X', 'W')).toMatchObject({ status: 'ok', identity: 100, ambiguousMatches: 1 });
  });
});

describe('MSA input and provenance contract', () => {
  it('rejects mismatched or duplicate names and malformed alphabets', () => {
    expect(computeMSA(['ACGT', 'ACGT'], ['one'])).toMatchObject({ type: 'invalid_input' });
    expect(computeMSA(['ACGT', 'ACGT'], ['one', 'ONE'])).toMatchObject({ type: 'invalid_input' });
    expect(computeMSA(['ACGT!', 'ACGT'], ['one', 'two'], { molecule: 'dna' })).toMatchObject({ type: 'invalid_input' });
  });

  it('caps sequence cardinality before normalization and checks work in one pass', () => {
    const sequences = Array.from({ length: MSA_MAX_SEQUENCES + 1 }, () => 'A');
    const names = sequences.map((_sequence, index) => `sequence-${index}`);
    expect(computeMSA(sequences, names)).toMatchObject({ type: 'too_large' });
    expect(estimateMsaWork([2, 3, 5])).toBe(56);
    expect(estimateMsaWork([Number.MAX_SAFE_INTEGER, 2])).toBe(Number.POSITIVE_INFINITY);
    expect(estimateMsaWork([1.5])).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns a typed failure from the deprecated wrapper instead of an empty alignment', () => {
    const empty = multipleAlign([]);
    expect(isMSAError(empty)).toBe(true);
    expect(empty).toMatchObject({ type: 'insufficient_sequences' });
    const malformed = multipleAlign([{ name: 'one', sequence: 'ACGT!' }, { name: 'two', sequence: 'ACGT' }]);
    expect(isMSAError(malformed)).toBe(true);
    expect(malformed).toMatchObject({ type: 'invalid_input' });
  });

  it('carries explicit star algorithm metadata and ambiguity counts', () => {
    const result = computeMSA(['AN', 'AA'], ['one', 'two'], { molecule: 'dna' });
    expect(isMSAError(result)).toBe(false);
    if (isMSAError(result)) return;
    expect(result.method).toBe('star');
    expect(result.algorithm).toContain('needleman-wunsch');
    expect(result.fallback).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.ambiguities).toBeGreaterThan(0);
  });
});
