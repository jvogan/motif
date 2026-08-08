import { describe, expect, it } from 'vitest';
import { getTranslationTable, STANDARD_CODE } from '../codon-tables';
import { findORFs } from '../orf-detection';
import type { CodonTable, ORF } from '../types';

function forwardOrfAtOrigin(sequence: string, table: CodonTable): ORF | undefined {
  return findORFs(sequence, 1, table).find((orf) => orf.strand === 1 && orf.start === 0);
}

describe('translation-table-aware ORF detection', () => {
  it('uses each table\'s alternative initiator set', () => {
    const sequence = 'GTGAAATAA';

    expect(forwardOrfAtOrigin(sequence, STANDARD_CODE)).toBeUndefined();
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(11))).toMatchObject({
      start: 0,
      end: 9,
      aminoAcids: 2,
      startCodon: 'GTG',
      stopCodon: 'TAA',
    });
    expect(forwardOrfAtOrigin('TTGAAATAA', STANDARD_CODE)).toMatchObject({
      startCodon: 'TTG',
      stopCodon: 'TAA',
    });
  });

  it('ends an ORF at a table-specific mitochondrial stop', () => {
    const sequence = 'ATGAAAAGATTTTAA';

    expect(forwardOrfAtOrigin(sequence, STANDARD_CODE)).toMatchObject({
      end: 15,
      aminoAcids: 4,
      stopCodon: 'TAA',
    });
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(2))).toMatchObject({
      end: 9,
      aminoAcids: 2,
      stopCodon: 'AGA',
    });
  });

  it('does not treat a reassigned TAG codon as a stop', () => {
    const sequence = 'ATGAAATAGCCCTGA';

    expect(forwardOrfAtOrigin(sequence, STANDARD_CODE)).toMatchObject({
      end: 9,
      aminoAcids: 2,
      stopCodon: 'TAG',
    });
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(15))).toMatchObject({
      end: 15,
      aminoAcids: 4,
      stopCodon: 'TGA',
    });
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(32))).toMatchObject({
      end: 15,
      aminoAcids: 4,
      stopCodon: 'TGA',
    });
  });

  it('honors a table supplied through the options overload', () => {
    const sequence = 'ATGAAAAGATTTTAA';
    const orf = findORFs(sequence, 30, STANDARD_CODE, {
      minAminoAcids: 1,
      table: getTranslationTable(2),
    }).find((candidate) => candidate.strand === 1 && candidate.start === 0);

    expect(orf).toMatchObject({ end: 9, stopCodon: 'AGA' });
  });

  it('accepts every IUPAC DNA ambiguity symbol instead of treating it as protein input', () => {
    for (const symbol of 'ACGTRYSWKMBDHVN') {
      const orfs = findORFs(`ATG${symbol}AATGA`, 1, STANDARD_CODE);
      expect(orfs.some((orf) => orf.strand === 1 && orf.start === 0), symbol).toBe(true);
    }
  });

  it('reports partial circular ORFs without inventing a second revolution or stop', () => {
    const orfs = findORFs('ATGAAA', 1, STANDARD_CODE, { topology: 'circular' });
    const forward = orfs.find((orf) => orf.strand === 1 && orf.start === 0);

    expect(forward).toMatchObject({
      start: 0,
      end: 6,
      length: 6,
      stopCodon: '',
      status: 'partial',
    });
    expect(forward?.warnings).toContain('No in-frame stop codon within one complete circular revolution');
    expect(orfs.every((orf) => orf.end <= orf.start + 6)).toBe(true);
  });
});
