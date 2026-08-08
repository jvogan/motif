import { describe, expect, it } from 'vitest';
import { reverseComplement } from '../reverse-complement';
import { materializeTranslationExceptions } from '../transl-except';

const feature = (start: number, end: number, strand: 1 | -1 = 1) => ({ start, end, strand });

describe('feature-aware transl_except materialization', () => {
  it('materializes Sec, Pyl, and TERM only after strict base translation', () => {
    const result = materializeTranslationExceptions({
      sequence: 'ATGTGCTGG',
      feature: feature(0, 9),
      qualifier: '(pos:4..6,aa:Pyl)(pos:7..9,aa:TERM)',
      translationTableId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceProtein).toBe('MCW');
    expect(result.materializedProtein).toBe('MO*');
    expect(result.receipt).toMatchObject({
      rawQualifier: '(pos:4..6,aa:Pyl)(pos:7..9,aa:TERM)',
      proteinIdentity: null,
      codonStart: 1,
    });
    expect(result.exceptions.map((exception) => exception.residue)).toEqual(['O', '*']);
  });

  it('maps reverse-strand positions through biological order', () => {
    const coding = 'ATGTGCGAA';
    const result = materializeTranslationExceptions({
      sequence: reverseComplement(coding),
      feature: feature(0, coding.length, -1),
      qualifier: '(pos:complement(4..6),aa:Sec)',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceProtein).toBe('MCE');
    expect(result.materializedProtein).toBe('MUE');
    expect(result.exceptions[0]).toMatchObject({ codonIndex: 1, complement: true });
  });

  it.each([
    {
      label: 'complement on a forward CDS',
      feature: feature(0, 9, 1),
      qualifier: '(pos:complement(4..6),aa:Sec)',
    },
    {
      label: 'forward location on a reverse CDS',
      feature: feature(0, 9, -1),
      qualifier: '(pos:4..6,aa:Sec)',
    },
  ])('fails closed for a transl_except orientation mismatch ($label)', ({ feature, qualifier }) => {
    const result = materializeTranslationExceptions({
      sequence: feature.strand === -1 ? reverseComplement('ATGTGCGAA') : 'ATGTGCGAA',
      feature,
      qualifier,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'orientation_mismatch' }));
    expect(result.receipt).toBeNull();
  });

  it('maps an exception across a multipart CDS and honors codon_start', () => {
    const multipart = materializeTranslationExceptions({
      sequence: 'ATGTGCNNNNGAA',
      feature: { start: 0, end: 13, strand: 1, subRanges: [{ start: 0, end: 6 }, { start: 10, end: 13 }] },
      qualifier: '(pos:11..13,aa:TERM)',
    });
    expect(multipart.ok).toBe(true);
    if (!multipart.ok) return;
    expect(multipart.sourceProtein).toBe('MCE');
    expect(multipart.materializedProtein).toBe('MC*');
    expect(multipart.exceptions[0].codonIndex).toBe(2);

    const frameShifted = materializeTranslationExceptions({
      sequence: 'AATGTCTTAA',
      feature: feature(0, 10),
      qualifier: '(pos:5..7,aa:Sec)',
      codonStart: 2,
    });
    expect(frameShifted.ok).toBe(true);
    if (!frameShifted.ok) return;
    expect(frameShifted.sourceProtein).toBe('MS*');
    expect(frameShifted.materializedProtein).toBe('MU*');
    expect(frameShifted.receipt.codonStart).toBe(2);
  });

  it.each([
    ['(pos:ACC:1..3,aa:Sec)', 'remote_location'],
    ['(pos:<1..3,aa:Sec)', 'ambiguous_location'],
    ['(pos:1..2,aa:Sec)', 'not_codon'],
    ['(pos:1..3,aa:Trp)', 'unsupported_amino_acid'],
    ['(pos:1..3,aa:Sec', 'malformed'],
  ] as const)('returns typed diagnostics for unsupported %s', (qualifier, code) => {
    const result = materializeTranslationExceptions({
      sequence: 'ATGTGC',
      feature: feature(0, 6),
      qualifier,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    expect(result.diagnostics[0].rawQualifier).toBe(qualifier);
  });
});
