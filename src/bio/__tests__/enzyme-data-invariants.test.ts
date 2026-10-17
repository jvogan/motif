import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';

// IUPAC complement pairs; ambiguity codes complement to their set of partners.
const IUPAC_COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', C: 'G', G: 'C',
  R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
};

function reverseComplement(sequence: string): string {
  return Array.from(sequence.toUpperCase(), (base) => {
    const complement = IUPAC_COMPLEMENT[base];
    if (!complement) throw new Error(`Unexpected recognition base ${base}`);
    return complement;
  }).reverse().join('');
}

describe('restriction enzyme catalog geometry invariants', () => {
  const palindromic = RESTRICTION_ENZYMES_FULL.filter(
    (enzyme) => enzyme.recognitionSequence === reverseComplement(enzyme.recognitionSequence),
  );
  const doubleStrand = RESTRICTION_ENZYMES_FULL.filter(
    (enzyme) => enzyme.cleavageMode === undefined || enzyme.cleavageMode === 'double-strand',
  );

  it('finds palindromic recognition sites to check', () => {
    expect(palindromic.length).toBeGreaterThan(0);
  });

  it.each(palindromic.map((enzyme) => [enzyme.name, enzyme] as const))(
    '%s: homodimer cut offsets sum to the recognition length',
    (_name, enzyme) => {
      expect(enzyme.cutOffset + enzyme.complementCutOffset).toBe(enzyme.recognitionSequence.length);
    },
  );

  it.each(doubleStrand.map((enzyme) => [enzyme.name, enzyme] as const))(
    '%s: overhang label matches the nick offsets',
    (_name, enzyme) => {
      const expected = enzyme.cutOffset === enzyme.complementCutOffset
        ? 'blunt'
        : enzyme.cutOffset < enzyme.complementCutOffset
          ? '5prime'
          : '3prime';
      expect(enzyme.overhang).toBe(expected);
    },
  );

  it('pins the corrected DrdI, XcmI, and Nb.BbvCI geometry', () => {
    const find = (name: string) => {
      const enzyme = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === name);
      if (!enzyme) throw new Error(`Missing ${name}`);
      return enzyme;
    };
    expect(find('DrdI')).toMatchObject({
      recognitionSequence: 'GACNNNNNNGTC',
      cutOffset: 7,
      complementCutOffset: 5,
      overhang: '3prime',
    });
    expect(find('XcmI')).toMatchObject({
      recognitionSequence: 'CCANNNNNNNNNTGG',
      cutOffset: 8,
      complementCutOffset: 7,
      overhang: '3prime',
    });
    expect(find('Nb.BbvCI')).toMatchObject({
      recognitionSequence: 'CCTCAGC',
      cutOffset: 5,
      complementCutOffset: 5,
      cleavageMode: 'nick_bottom',
    });
    expect(find('Nt.BbvCI')).toMatchObject({ cutOffset: 2, complementCutOffset: 2, cleavageMode: 'nick_top' });
  });
});
