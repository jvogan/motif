import { describe, expect, it } from 'vitest';
import { getTranslationTable, STANDARD_CODE } from '../codon-tables';
import { translate, translateCompleteCds } from '../translate';

describe('translation-table-aware translation', () => {
  it('uses the selected table for codons whose residue assignments diverge', () => {
    expect(translate('ATATGAAGAAGG', 0, STANDARD_CODE)).toBe('I*RR');
    expect(translate('ATATGAAGAAGG', 0, getTranslationTable(2))).toBe('MW**');
    expect(translate('TAG', 0, getTranslationTable(15))).toBe('Q');
    expect(translate('TAG', 0, getTranslationTable(32))).toBe('W');
  });

  it('normalizes lowercase RNA uracil before table lookup', () => {
    expect(translate('augugauga', 0, STANDARD_CODE)).toBe('M**');
    expect(translate('augugauga', 0, getTranslationTable(2))).toBe('MWW');
  });

  it('includes the first stop symbol and omits all following codons when requested', () => {
    const sequence = 'ATGTAATGGTAG';

    expect(translate(sequence, 0, STANDARD_CODE)).toBe('M*W*');
    expect(translate(sequence, 0, STANDARD_CODE, true)).toBe('M*');
  });

  it('uses alternative initiators only for a complete CDS', () => {
    const bacterial = getTranslationTable(11);

    expect(translate('GTGGTGTAA', 0, bacterial)).toBe('VV*');
    expect(translateCompleteCds('GTGGTGTAA', 0, bacterial)).toBe('MV*');
    expect(translateCompleteCds('GTGGTGTAAATG', 0, bacterial, true)).toBe('MV*');
  });

  it('changes only the first complete-CDS codon to methionine', () => {
    expect(translate('TTGCTG', 0, STANDARD_CODE)).toBe('LL');
    expect(translateCompleteCds('TTGCTG', 0, STANDARD_CODE)).toBe('ML');
    expect(translateCompleteCds('GTTGTG', 0, getTranslationTable(11))).toBe('VV');
  });
});
