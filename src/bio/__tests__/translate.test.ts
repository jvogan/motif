import { describe, expect, it } from 'vitest';
import { getTranslationTable, NCBI_TRANSLATION_TABLES, STANDARD_CODE } from '../codon-tables';
import { resolveIupacCodon } from '../translate';
import type { CodonTable } from '../types';
import { translate, translateCompleteCds, translateFromFirstATG } from '../translate';
import { extractFeatureSequence } from '../feature-location';
import { reverseComplement } from '../reverse-complement';

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

  it('resolves deterministic IUPAC codons and marks divergent codons as X', () => {
    expect(translate('ATGGCN', 0, STANDARD_CODE)).toBe('MA');
    expect(translate('ATGATH', 0, STANDARD_CODE)).toBe('MI');
    expect(translate('ATGNNN', 0, STANDARD_CODE)).toBe('MX');
  });

  it('removes formatting whitespace but rejects gaps and punctuation', () => {
    expect(translate('  ATG\n GCN\t', 0, STANDARD_CODE)).toBe('MA');
    expect(() => translate('ATG-GCN', 0, STANDARD_CODE)).toThrow(/Invalid nucleotide character/i);
    expect(() => translate('ATG.GCN', 0, STANDARD_CODE)).toThrow(/Invalid nucleotide character/i);
  });

  it('uses table-specific alternative initiators when translating from a start', () => {
    const bacterial = getTranslationTable(11);

    expect(translateFromFirstATG('CCCGTGAAATAA', bacterial)).toBe('MK*');
    expect(translateFromFirstATG('CCCGTGAAATAA', STANDARD_CODE)).toBeNull();
  });

  it('recognizes an ambiguous codon only when every expansion is an initiator', () => {
    const mitochondrial = getTranslationTable(2);

    expect(translateCompleteCds('ATHAAATAA', 0, mitochondrial)).toBe('MK*');
    expect(translateCompleteCds('ATNAAATAA', 0, STANDARD_CODE)).toBe('XK*');
    expect(translateFromFirstATG('CCCGTNAAAACC', mitochondrial)).toBeNull();
  });

  it('applies codon_start after orienting a reverse feature into biological order', () => {
    const biological = 'AATGAAATAG';
    const genomic = reverseComplement(biological);
    const feature = {
      start: 0,
      end: genomic.length,
      strand: -1 as const,
      subRanges: undefined,
    };
    const extracted = extractFeatureSequence(genomic, feature, 'dna');

    expect(extracted).toBe(biological);
    expect(translateCompleteCds(extracted, 1, getTranslationTable(11))).toBe('MK*');
  });
});

describe('the concrete-codon fast path is indistinguishable from full IUPAC resolution', () => {
  // translate() short-circuits a codon that is a key of the table, on the
  // argument that a concrete codon is its own only expansion. That argument has
  // to hold for every codon in every shipped table, not just the ones a test
  // happens to name — so check all of them against the path it replaced.
  const IUPAC_BASES = ['A', 'C', 'G', 'T', 'R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V', 'N'];
  const ALL_CODONS: string[] = [];
  for (const a of IUPAC_BASES) for (const b of IUPAC_BASES) for (const c of IUPAC_BASES) ALL_CODONS.push(a + b + c);

  // The exact expression translate() used before the fast path landed.
  const referenceResidue = (codon: string, table: CodonTable) =>
    resolveIupacCodon(codon, table).residue ?? 'X';

  const tableIds = Object.keys(NCBI_TRANSLATION_TABLES).map(Number);

  it('covers every IUPAC codon in every NCBI table', () => {
    expect(ALL_CODONS).toHaveLength(15 ** 3);
    expect(tableIds.length).toBeGreaterThan(8);
  });

  it('agrees with resolveIupacCodon for every codon in every table', () => {
    const disagreements: string[] = [];
    for (const id of tableIds) {
      const table = NCBI_TRANSLATION_TABLES[id];
      for (const codon of ALL_CODONS) {
        const viaTranslate = translate(codon, 0, table);
        const viaReference = referenceResidue(codon, table);
        if (viaTranslate !== viaReference) {
          disagreements.push(`table ${id} codon ${codon}: ${viaTranslate} vs ${viaReference}`);
        }
      }
    }
    expect(disagreements.slice(0, 12)).toEqual([]);
  });

  it('still returns X where the table has no residue for an ambiguous codon', () => {
    // Guards the fallback half: a codon whose expansions disagree must not be
    // silently resolved by the lookup, because it is not a key at all.
    expect(translate('RAT', 0, STANDARD_CODE)).toBe('X');
    expect(translate('NNN', 0, STANDARD_CODE)).toBe('X');
    // ...while an ambiguous codon whose expansions all agree still resolves.
    expect(translate('CTN', 0, STANDARD_CODE)).toBe('L');
    expect(translate('MGR', 0, STANDARD_CODE)).toBe('R');
  });

  it('keeps stopAtFirst behaviour on the fast path', () => {
    expect(translate('ATGAAATAAGGG', 0, STANDARD_CODE, true)).toBe('MK*');
    expect(translate('ATGAAATAAGGG', 0, STANDARD_CODE, false)).toBe('MK*G');
  });
});
