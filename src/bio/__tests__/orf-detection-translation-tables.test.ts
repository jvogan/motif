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
});
