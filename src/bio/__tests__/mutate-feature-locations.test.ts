import { describe, expect, it } from 'vitest';
import { extractFeatureSequence, isMultipartFeature } from '../feature-location';
import {
  applyDeletion,
  applyInsertion,
  applySubstitution,
  MAX_MUTATION_INSERTION_LENGTH,
  MAX_MUTATION_OPERATION_UNITS,
  MAX_MUTATION_RESULT_LENGTH,
  preflightSequenceEdit,
} from '../mutate';
import type { Feature } from '../types';

function joinedFeature(): Feature {
  return {
    id: 'joined-feature',
    name: 'joined feature',
    type: 'cds',
    start: 0,
    end: 12,
    strand: 1,
    subRanges: [
      { start: 0, end: 3, strand: 1 },
      { start: 9, end: 12, strand: 1 },
    ],
    color: '#888888',
    metadata: {},
  };
}

describe('mutation feature-location integrity', () => {
  it('preflights exact record-cap boundaries without constructing a mutation', () => {
    expect(preflightSequenceEdit(249_999, { deletedLength: 0, insertedLength: 1 })).toMatchObject({
      ok: true,
      nextLength: 250_000,
    });
    expect(preflightSequenceEdit(250_000, { deletedLength: 0, insertedLength: 1 })).toMatchObject({
      ok: false,
      nextLength: 250_001,
    });
    expect(preflightSequenceEdit(250_000, { deletedLength: 1, insertedLength: 1 })).toMatchObject({
      ok: true,
      nextLength: 250_000,
    });
  });

  it('executes cap-boundary overwrite, end-insert, and delete-then-insert edits', () => {
    const belowCap = 'A'.repeat(249_999);
    const atCap = 'A'.repeat(250_000);
    const insertedAtEnd = applyInsertion(belowCap, [], [], belowCap.length - 1, 'C');
    expect(insertedAtEnd.raw).toHaveLength(250_000);
    expect(insertedAtEnd.raw.endsWith('AC')).toBe(true);
    expect(() => applyInsertion(atCap, [], [], atCap.length - 1, 'C')).toThrow(/250,000|result limit/i);
    const overwrittenAtCap = applySubstitution(atCap, [], [], atCap.length - 1, 'C');
    expect(overwrittenAtCap.raw).toHaveLength(250_000);
    expect(overwrittenAtCap.raw.endsWith('C')).toBe(true);
    const deleted = applyDeletion(atCap, [], [], atCap.length - 1, 1);
    expect(deleted.raw).toHaveLength(249_999);
    const restored = applyInsertion(deleted.raw, [], [], deleted.raw.length - 1, 'C');
    expect(restored.raw).toHaveLength(250_000);
  });

  it('requires exactly one residue for substitution and rejects length-changing disguises', () => {
    expect(applySubstitution('ATGC', [], [], 1, 'C').raw).toBe('ACGC');
    for (const replacement of ['', 'GG', '-', ' ']) {
      expect(() => applySubstitution('ATGC', [], [], 1, replacement)).toThrow(/exactly one valid residue/i);
    }
    expect(applySubstitution('MKW', [], [], 1, 'X', 'protein').raw).toBe('MXW');
    expect(() => applySubstitution('ATGC', [], [], 1, 'X', 'dna')).toThrow(/declared dna alphabet/i);
  });

  it('rejects fractional or non-finite edit coordinates before string indexing', () => {
    expect(() => applySubstitution('ATGC', [], [], 1.5, 'C')).toThrow(/pos.*safe integer/i);
    expect(() => applySubstitution('ATGC', [], [], Number.NaN, 'C')).toThrow(/pos.*safe integer/i);
    expect(() => applyInsertion('ATGC', [], [], 1.5, 'AA')).toThrow(/pos.*safe integer/i);
    expect(() => applyInsertion('ATGC', [], [], Number.NaN, 'AA')).toThrow(/pos.*safe integer/i);
    expect(() => applyDeletion('ATGC', [], [], 1, 1.5)).toThrow(/count.*safe integer/i);
    expect(() => applyDeletion('ATGC', [], [], 1, Number.NaN)).toThrow(/count.*safe integer/i);
    expect(applyInsertion('ATGC', [], [], -1, 'AA').raw).toBe('AAATGC');
  });

  it('bounds nucleotide insertion alphabet, size, and work before allocating derived state', () => {
    expect(applyInsertion('ATGC', [], [], 1, 'ac').raw).toBe('ATACGC');
    expect(() => applyInsertion('ATGC', [], [], 1, 'X')).toThrow(/declared dna alphabet/i);
    expect(applyInsertion('MKW', [], [], 1, 'X*', 'protein').raw).toBe('MKX*W');
    expect(applyInsertion('ACGU', [], [], 1, 'R', 'rna').raw).toBe('ACRGU');
    expect(() => applyInsertion('MKW', [], [], 1, 'X*', 'dna')).toThrow(/declared dna alphabet/i);
    expect(() => applyInsertion('ATGC', [], [], 1, 'A'.repeat(MAX_MUTATION_INSERTION_LENGTH + 1)))
      .toThrow(/cannot exceed/i);
    expect(() => applyInsertion('A'.repeat(MAX_MUTATION_RESULT_LENGTH), [], [], 0, 'A'))
      .toThrow(/result limit/i);
    expect(() => applyInsertion('A', new Array(MAX_MUTATION_OPERATION_UNITS), [], 0, 'A'))
      .toThrow(/operation budget/i);
  });

  it('returns an out-of-range insertion as a no-op before unrelated size or work checks', () => {
    const scars = new Array(MAX_MUTATION_OPERATION_UNITS);
    expect(applyInsertion('ATGC', scars, [], 99, 'X'.repeat(MAX_MUTATION_INSERTION_LENGTH + 1))).toEqual({
      raw: 'ATGC',
      scars: [...scars],
      features: [],
    });
    expect(applySubstitution('ATGC', scars, [], 99, 'X')).toEqual({
      raw: 'ATGC',
      scars: [...scars],
      features: [],
    });
    expect(applyDeletion('ATGC', scars, [], 99, MAX_MUTATION_OPERATION_UNITS)).toEqual({
      raw: 'ATGC',
      scars: [...scars],
      features: [],
    });
  });

  it('uses half-open feature affinity at insertion boundaries', () => {
    const feature: Feature = {
      id: 'feature',
      name: 'feature',
      type: 'misc_feature',
      start: 2,
      end: 5,
      strand: 1,
      color: '#888888',
      metadata: {},
    };

    expect(applyInsertion('AACCGGTT', [], [feature], 1, 'AA').features[0])
      .toMatchObject({ start: 4, end: 7 });
    expect(applyInsertion('AACCGGTT', [], [feature], 2, 'AA').features[0])
      .toMatchObject({ start: 2, end: 7 });
    expect(applyInsertion('AACCGGTT', [], [feature], 4, 'AA').features[0])
      .toMatchObject({ start: 2, end: 5 });
  });

  it('shifts authoritative pieces and recomputes their envelope after insertion', () => {
    const result = applyInsertion('ATGCCCGGGCCA', [], [joinedFeature()], 5, 'AA');

    expect(result.features[0]).toMatchObject({
      start: 0,
      end: 14,
      subRanges: [
        { start: 0, end: 3, strand: 1 },
        { start: 11, end: 14, strand: 1 },
      ],
    });
    expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('ATGCCA');
  });

  it('drops a deleted piece and derives the envelope from the surviving piece', () => {
    const result = applyDeletion('ATGCCCGGGCCA', [], [joinedFeature()], 0, 3);

    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({
      start: 6,
      end: 9,
      subRanges: [{ start: 6, end: 9, strand: 1 }],
    });
    expect(isMultipartFeature(result.features[0])).toBe(false);
  });

  it('removes an inter-segment gap without changing the assembled product', () => {
    const result = applyDeletion('ATGCCCGGGCCA', [], [joinedFeature()], 3, 6);

    expect(result.raw).toBe('ATGCCA');
    expect(result.features[0]).toMatchObject({
      start: 0,
      end: 6,
      subRanges: [
        { start: 0, end: 3, strand: 1 },
        { start: 3, end: 6, strand: 1 },
      ],
    });
    expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('ATGCCA');
  });

  it('removes a multipart feature when every authoritative piece is deleted', () => {
    const result = applyDeletion('ATGCCCGGGCCA', [], [joinedFeature()], 0, 12);

    expect(result.features).toEqual([]);
  });
});
