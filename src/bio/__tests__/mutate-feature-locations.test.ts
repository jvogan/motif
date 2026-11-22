import { describe, expect, it } from 'vitest';
import { extractFeatureSequence, isMultipartFeature } from '../feature-location';
import {
  applyDeletion,
  applyInsertion,
  applyReplacement,
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

  it('preserves an origin-spanning feature during substitution', () => {
    const wrapped: Feature = {
      id: 'wrapped',
      name: 'wrapped',
      type: 'misc_feature',
      start: 3,
      end: 1,
      strand: 1,
      color: '#888888',
      metadata: {},
    };

    const result = applySubstitution('ATGC', [], [wrapped], 0, 'C');

    expect(result.raw).toBe('CTGC');
    expect(result.features).toEqual([wrapped]);
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

  it('drops an annotation wholly destroyed by a non-empty replacement', () => {
    const enclosed: Feature = {
      id: 'enclosed',
      name: 'enclosed',
      type: 'misc_feature',
      start: 40,
      end: 50,
      strand: 1,
      color: '#888888',
      metadata: {},
    };

    const result = applyReplacement('A'.repeat(120), [], [enclosed], 10, 90, 'C');

    expect(result.raw).toBe(`${'A'.repeat(10)}C${'A'.repeat(20)}`);
    expect(result.features).toEqual([]);
  });

  it('drops every wholly replaced multipart piece, including duplicates', () => {
    const enclosedPieces: Feature = {
      id: 'enclosed-pieces',
      name: 'enclosed pieces',
      type: 'cds',
      start: 40,
      end: 70,
      strand: 1,
      subRanges: [
        { start: 40, end: 50, strand: 1 },
        { start: 40, end: 50, strand: 1 },
        { start: 60, end: 70, strand: 1 },
      ],
      color: '#888888',
      metadata: {},
    };

    const result = applyReplacement('A'.repeat(120), [], [enclosedPieces], 10, 90, 'C');

    expect(result.features).toEqual([]);
  });

  it('retains replacement-boundary and overlapping annotations with their established affinity', () => {
    const feature = (id: string, start: number, end: number): Feature => ({
      id,
      name: id,
      type: 'misc_feature',
      start,
      end,
      strand: 1,
      color: '#888888',
      metadata: {},
    });
    const boundaryPieces: Feature = {
      id: 'boundary-pieces',
      name: 'boundary pieces',
      type: 'cds',
      start: 10,
      end: 100,
      strand: 1,
      subRanges: [
        { start: 10, end: 50, strand: 1 },
        { start: 40, end: 50, strand: 1 },
        { start: 40, end: 100, strand: 1 },
      ],
      color: '#888888',
      metadata: {},
    };

    const result = applyReplacement('A'.repeat(120), [], [
      feature('left-boundary', 10, 50),
      feature('right-boundary', 40, 100),
      feature('left-overlap', 5, 50),
      feature('right-overlap', 40, 105),
      boundaryPieces,
    ], 10, 90, 'C');

    expect(result.features).toMatchObject([
      { id: 'left-boundary', start: 10, end: 11 },
      { id: 'right-boundary', start: 10, end: 11 },
      { id: 'left-overlap', start: 5, end: 11 },
      { id: 'right-overlap', start: 10, end: 16 },
      {
        id: 'boundary-pieces',
        start: 10,
        end: 11,
        subRanges: [
          { start: 10, end: 11, strand: 1 },
          { start: 10, end: 11, strand: 1 },
        ],
      },
    ]);
  });

  it('uses the surviving piece’s strand after deleting a mixed-strand piece', () => {
    const feature: Feature = {
      ...joinedFeature(),
      strand: 0,
      subRanges: [{ start: 0, end: 3, strand: 1 }, { start: 9, end: 12, strand: -1 }],
    };
    for (const result of [
      applyDeletion('ATGCCCGGGCCA', [], [feature], 0, 3),
      applyReplacement('ATGCCCGGGCCA', [], [feature], 0, 3, ''),
    ]) {
      expect(result.features).toHaveLength(1);
      expect(result.features[0]).toMatchObject({ start: 6, end: 9, strand: -1 });
      expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('TGG');
    }
  });

  it('covers a replacement bridging two joined pieces only once', () => {
    const result = applyReplacement('ATGCCCGGGCCA', [], [joinedFeature()], 2, 8, 'T');
    expect(result.raw).toBe('ATTCA');
    expect(result.features[0]).toMatchObject({
      start: 0, end: 5,
      subRanges: [{ start: 0, end: 3, strand: 1 }, { start: 3, end: 5, strand: 1 }],
    });
    expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('ATTCA');
  });

  describe('an imported /translation', () => {
    // join(1..6,13..21): exon ATGAAA, intron GTAAGT, exon TTTGAATAA, so the
    // spliced product ATGAAATTTGAATAA translates to MKFE.
    const raw = 'ATGAAAGTAAGTTTTGAATAA';
    const cds = (type: Feature['type'] = 'cds'): Feature => ({
      id: 'coding', name: 'coding', type, start: 0, end: 21, strand: 1, color: '#888888',
      subRanges: [{ start: 0, end: 6, strand: 1 }, { start: 12, end: 21, strand: 1 }],
      metadata: {
        translation: 'MKFE',
        note: 'kept',
        motifQualifiers: [{ key: 'translation', value: 'MKFE' }, { key: 'note', value: 'kept' }],
      },
    });
    const keepsTranslation = (feature: Feature) => {
      const inQualifiers = (feature.metadata.motifQualifiers as { key: string }[]).some((entry) => entry.key === 'translation');
      expect(feature.metadata.note).toBe('kept');
      expect(inQualifiers).toBe('translation' in feature.metadata);
      return inQualifiers;
    };

    it.each([
      { label: 'an intron substitution', run: () => applySubstitution(raw, [], [cds()], 8, 'C'), keeps: true },
      { label: 'an intron deletion', run: () => applyDeletion(raw, [], [cds()], 7, 3), keeps: true },
      { label: 'an intron replacement', run: () => applyReplacement(raw, [], [cds()], 7, 3, 'CCCC'), keeps: true },
      { label: 'deleting the whole intron', run: () => applyDeletion(raw, [], [cds()], 6, 6), keeps: true },
      { label: 'an insertion before the CDS', run: () => applyInsertion(raw, [], [cds()], -1, 'C'), keeps: true },
      { label: 'an insertion between pieces', run: () => applyInsertion(raw, [], [cds()], 5, 'C'), keeps: true },
      { label: 'retyping the same bases inside an exon', run: () => applyReplacement(raw, [], [cds()], 3, 3, 'aaa'), keeps: true },
      { label: 'a synonymous substitution', run: () => applySubstitution(raw, [], [cds()], 5, 'G'), keeps: false },
      { label: 'a missense substitution', run: () => applySubstitution(raw, [], [cds()], 3, 'C'), keeps: false },
      { label: 'an insertion inside an exon', run: () => applyInsertion(raw, [], [cds()], 3, 'C'), keeps: false },
      { label: 'a deletion inside an exon', run: () => applyDeletion(raw, [], [cds()], 13, 3), keeps: false },
      { label: 'a deletion across an exon edge', run: () => applyDeletion(raw, [], [cds()], 4, 4), keeps: false },
      // Bases 6-7 are already AG, so the sequence is unchanged, but the first
      // exon's end clamps to the replacement's end and takes in the G.
      { label: 'identical bases across an exon edge', run: () => applyReplacement(raw, [], [cds()], 5, 2, 'AG'), keeps: false },
    ])('is kept after $label only when the product is unchanged', ({ run, keeps }) => {
      const result = run();
      const before = extractFeatureSequence(raw, cds(), 'dna');
      const after = extractFeatureSequence(result.raw, result.features[0], 'dna');
      expect(after === before).toBe(keeps);
      expect(keepsTranslation(result.features[0])).toBe(keeps);
    });

    it('is left alone on a feature that is not coding', () => {
      const result = applySubstitution(raw, [], [cds('misc_feature')], 3, 'C');
      expect(keepsTranslation(result.features[0])).toBe(true);
    });
  });

  it('keeps strand 0 while surviving pieces still disagree and takes their shared strand once they agree', () => {
    const feature: Feature = {
      ...joinedFeature(),
      end: 15,
      strand: 0,
      subRanges: [{ start: 0, end: 3, strand: 1 }, { start: 6, end: 9, strand: 1 }, { start: 12, end: 15, strand: -1 }],
    };
    const raw = 'ATGAAACCCTTTGGG';
    expect(applyDeletion(raw, [], [feature], 0, 3).features[0].strand).toBe(0);
    expect(applyDeletion(raw, [], [feature], 12, 3).features[0]).toMatchObject({ strand: 1, start: 0, end: 9 });
  });

  it('covers a replacement bridging two reverse pieces only once, in either stored order', () => {
    const pieces = [{ start: 9, end: 12, strand: -1 as const }, { start: 0, end: 3, strand: -1 as const }];
    for (const subRanges of [pieces, [...pieces].reverse()]) {
      const result = applyReplacement('ATGCCCGGGCCA', [], [{ ...joinedFeature(), strand: -1, subRanges }], 2, 8, 'T');
      expect(result.raw).toBe('ATTCA');
      const [feature] = result.features;
      expect(feature.subRanges!.filter((range) => range.start <= 2 && 2 < range.end)).toHaveLength(1);
      expect(extractFeatureSequence(result.raw, feature, 'dna')).toHaveLength(5);
    }
    // Biological order: the reverse complement of AT + T + CA.
    const result = applyReplacement('ATGCCCGGGCCA', [], [{ ...joinedFeature(), strand: -1, subRanges: pieces }], 2, 8, 'T');
    expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('TGAAT');
  });

  it('drops a joined piece the replacement covers entirely', () => {
    const feature: Feature = {
      ...joinedFeature(),
      end: 15,
      subRanges: [{ start: 0, end: 3, strand: 1 }, { start: 6, end: 9, strand: 1 }, { start: 12, end: 15, strand: 1 }],
    };
    const result = applyReplacement('ATGAAACCCTTTGGG', [], [feature], 2, 11, 'T');
    expect(result.raw).toBe('ATTGG');
    expect(result.features[0].subRanges).toEqual([{ start: 0, end: 3, strand: 1 }, { start: 3, end: 5, strand: 1 }]);
    expect(extractFeatureSequence(result.raw, result.features[0], 'dna')).toBe('ATTGG');
  });

  it.each([
    { label: 'immediately before', at: 2, count: 1, expected: [2, 5] },
    { label: 'first base', at: 3, count: 1, expected: [3, 5] },
    { label: 'inside', at: 4, count: 1, expected: [3, 5] },
    { label: 'last base', at: 5, count: 1, expected: [3, 5] },
    { label: 'immediately after', at: 6, count: 1, expected: [3, 6] },
    { label: 'across the start', at: 2, count: 2, expected: [2, 4] },
    { label: 'across the end', at: 5, count: 2, expected: [3, 5] },
    { label: 'all bases', at: 3, count: 3, expected: null },
  ])('remaps deletions $label of a reverse feature', ({ at, count, expected }) => {
    const feature: Feature = {
      id: 'reverse', name: 'Reverse', type: 'misc_feature', start: 3, end: 6, strand: -1, color: '#888888', metadata: {},
    };
    const result = applyDeletion('AAACCCGGG', [], [feature], at, count);
    expect(result.features).toEqual(expected ? [{ ...feature, start: expected[0], end: expected[1] }] : []);
  });
});
