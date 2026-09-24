import { describe, expect, it } from 'vitest';
import { reverseComplement } from '../reverse-complement';
import { materializeTranslationExceptions, remapPositionQualifiers, translationExceptionEntries } from '../transl-except';

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

describe('remapPositionQualifiers', () => {
  // A 40 bp piece placed at product base 100; flipped, source base i lands at 139 - i.
  const shifted = { base: (index: number) => (index >= 0 && index < 40 ? index + 100 : null) };
  const flipped = { base: (index: number) => (index >= 0 && index < 40 ? 139 - index : null), flipped: true };

  it('moves /transl_except with the feature, keeping the rest of each entry', () => {
    expect(remapPositionQualifiers({ transl_except: '(pos:10..12,aa:Sec)', note: 'kept' }, shifted))
      .toEqual({ transl_except: '(pos:110..112,aa:Sec)', note: 'kept' });
    expect(remapPositionQualifiers({ translExcept: '(pos:complement(4..6),aa:Pyl)' }, shifted))
      .toEqual({ translExcept: '(pos:complement(104..106),aa:Pyl)' });
  });

  it('mirrors a position onto the other strand when the piece is flipped', () => {
    // Source bases 9..11 (0-based) land at 130..128, so 1-based 129..131.
    expect(remapPositionQualifiers({ transl_except: '(pos:10..12,aa:Sec)' }, flipped))
      .toEqual({ transl_except: '(pos:complement(129..131),aa:Sec)' });
    expect(remapPositionQualifiers({ transl_except: '(pos:complement(10..12),aa:Sec)' }, flipped))
      .toEqual({ transl_except: '(pos:129..131,aa:Sec)' });
    // An anticodon split by an intron keeps its pieces ascending inside complement(join(...)).
    expect(remapPositionQualifiers({ anticodon: '(pos:join(5,20..21),aa:Leu,seq:taa)' }, flipped))
      .toEqual({ anticodon: '(pos:complement(join(120..121,136)),aa:Leu,seq:taa)' });
    // A bare range has no strand to flip; it only moves.
    expect(remapPositionQualifiers({ rpt_unit_range: '3..8', tag_peptide: '30..35' }, flipped))
      .toEqual({ rpt_unit_range: '133..138', tag_peptide: '106..111' });
  });

  it('drops an entry whose bases are not carried or cannot be pinned down', () => {
    expect(remapPositionQualifiers({ transl_except: '(pos:39..41,aa:Sec)' }, shifted)).toEqual({});
    expect(remapPositionQualifiers({ transl_except: '(pos:<10..12,aa:Sec)' }, shifted)).toEqual({});
    expect(remapPositionQualifiers({ transl_except: '(pos:AB000001.1:10..12,aa:Sec)' }, shifted)).toEqual({});
    expect(remapPositionQualifiers({ rpt_unit_range: 'complement(3..8)' }, shifted)).toEqual({});
    // One entry of two still names carried bases, so it stays.
    expect(remapPositionQualifiers({ transl_except: '(pos:1..3,aa:Sec),(pos:50..52,aa:Sec)' }, shifted))
      .toEqual({ transl_except: '(pos:101..103,aa:Sec)' });
    expect(remapPositionQualifiers({ transl_except: ['(pos:1..3,aa:Sec)', '(pos:50..52,aa:Sec)'] }, shifted))
      .toEqual({ transl_except: ['(pos:101..103,aa:Sec)'] });
  });

  it('moves every entry of a value holding several groups, keeping their separators', () => {
    expect(remapPositionQualifiers({ transl_except: '(pos:1..3,aa:Sec)(pos:10..12,aa:Sec)' }, shifted))
      .toEqual({ transl_except: '(pos:101..103,aa:Sec)(pos:110..112,aa:Sec)' });
    expect(remapPositionQualifiers({ transl_except: '(pos:1..3,aa:Sec), (pos:10..12,aa:Pyl),(pos:20..22,aa:TERM)' }, flipped))
      .toEqual({ transl_except: '(pos:complement(138..140),aa:Sec), (pos:complement(129..131),aa:Pyl),(pos:complement(119..121),aa:TERM)' });
    expect(remapPositionQualifiers({ transl_except: '(pos:50..52,aa:Sec)(pos:10..12,aa:Sec)' }, shifted))
      .toEqual({ transl_except: '(pos:110..112,aa:Sec)' });
    // Materialized, both moved Sec codons still land on TGA.
    const cds = 'ATGTGAGCATGAAAATAA';
    const moved = remapPositionQualifiers({ transl_except: '(pos:4..6,aa:Sec)(pos:10..12,aa:Sec)' }, {
      base: (index) => (index >= 0 && index < cds.length ? index + 7 : null),
    });
    const result = materializeTranslationExceptions({ sequence: `GGGGGGG${cds}`, feature: feature(7, 25), qualifier: moved.transl_except });
    expect(result.ok && result.materializedProtein).toBe('MUAUK*');
  });

  it('rewrites the preserved qualifier list that GenBank export replays', () => {
    const metadata = {
      transl_except: '(pos:10..12,aa:Sec)',
      motifQualifiers: [
        { key: 'gene', value: 'selD' },
        { key: 'transl_except', value: '(pos:10..12,aa:Sec)' },
        { key: 'transl_except', value: '(pos:60..62,aa:Sec)' },
      ],
    };
    expect(remapPositionQualifiers(metadata, shifted)).toEqual({
      transl_except: '(pos:110..112,aa:Sec)',
      motifQualifiers: [
        { key: 'gene', value: 'selD' },
        { key: 'transl_except', value: '(pos:110..112,aa:Sec)' },
      ],
    });
  });

  it('returns the same metadata when nothing in it names a position', () => {
    const metadata = { codon_start: 1, motifQualifiers: [{ key: 'product', value: 'x' }] };
    expect(remapPositionQualifiers(metadata, shifted)).toBe(metadata);
  });

  it('keeps a moved Sec on the same codon once materialized', () => {
    // ATG GCA TGA AAA TAA with the TGA read as Sec, moved 100 bases along.
    const cds = 'ATGGCATGAAAATAA';
    const moved = remapPositionQualifiers({ transl_except: '(pos:7..9,aa:Sec)' }, {
      base: (index) => (index >= 0 && index < cds.length ? index + 100 : null),
    });
    const result = materializeTranslationExceptions({
      sequence: `${'C'.repeat(100)}${cds}`,
      feature: feature(100, 115),
      qualifier: moved.transl_except,
    });
    expect(result.ok && result.materializedProtein).toBe('MAUK*');
  });
});

describe('translationExceptionEntries', () => {
  it('splits a joined value into one entry per codon', () => {
    expect(translationExceptionEntries('(pos:6..8,aa:Sec),(pos:12..14,aa:Sec)')).toEqual(['(pos:6..8,aa:Sec)', '(pos:12..14,aa:Sec)']);
    expect(translationExceptionEntries('(pos:complement(15..17),aa:Sec) (pos:join(1..2,5),aa:Pyl)'))
      .toEqual(['(pos:complement(15..17),aa:Sec)', '(pos:join(1..2,5),aa:Pyl)']);
  });

  it('returns any other value whole', () => {
    for (const value of ['(pos:6..8,aa:Sec)', ' (pos:6..8,aa:Sec) ', '(pos:6..8,aa:Sec),x(pos:12..14,aa:Sec)', '(pos:6..8,aa:Sec),(pos:12..14', 'free text']) {
      expect(translationExceptionEntries(value)).toEqual([value]);
    }
  });
});
