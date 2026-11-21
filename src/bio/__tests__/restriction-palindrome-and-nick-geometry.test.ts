import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { findRestrictionSites } from '../restriction-sites';
import { reverseComplement } from '../reverse-complement';
import type { RestrictionEnzyme } from '../types';

function enzyme(name: string): RestrictionEnzyme {
  const found = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing catalog enzyme ${name}`);
  return found;
}

describe('catalog geometry of palindromic sites', () => {
  it('cuts every palindromic recognition sequence symmetrically', () => {
    // An enzyme cannot tell the two orientations of a palindromic site apart,
    // so the bottom-strand cut mirrors the top-strand cut: top + bottom = length.
    // The scanner relies on this when it reads a palindrome in one orientation only.
    const asymmetric = RESTRICTION_ENZYMES_FULL
      .filter((entry) => reverseComplement(entry.recognitionSequence) === entry.recognitionSequence)
      .filter((entry) => entry.cutOffset + entry.complementCutOffset !== entry.recognitionSequence.length)
      .map((entry) => `${entry.name} ${entry.cutOffset}/${entry.complementCutOffset}`);
    expect(asymmetric).toEqual([]);
  });

  it('places the DrdI and XcmI cuts where the enzymes cut', () => {
    // DrdI GACNNNN^NNGTC (bottom strand GACNN_): top 7, bottom 5, a 2-base 3' overhang.
    // XcmI CCANNNNN^NNNNTGG: top 8, bottom 7, the single-base 3' overhang used for T-vectors.
    expect(findRestrictionSites('AAAA' + 'GACTTCAGAGTC' + 'AAAA', [enzyme('DrdI')])).toEqual([
      expect.objectContaining({ position: 4, topCutPosition: 11, bottomCutPosition: 9, cutPosition: 11, overhang: '3prime' }),
    ]);
    expect(findRestrictionSites('AAA' + 'CCAGTCACTGTATGG' + 'AAA', [enzyme('XcmI')])).toEqual([
      expect.objectContaining({ position: 3, topCutPosition: 11, bottomCutPosition: 10, cutPosition: 11, overhang: '3prime' }),
    ]);
  });
});

describe('nicking enzymes on either strand', () => {
  it('places the Nb.BbvCI nick inside its site, where the bottom strand of CC^TCAGC is cut', () => {
    // NEB writes Nb.BbvCI as CCTCAGC(none/-2): the bottom strand is nicked 2 bases
    // inside the 3' end of the site, at 7 - 2 = 5 from its start.
    expect(findRestrictionSites('AAAA' + 'CCTCAGC' + 'AAAA', [enzyme('Nb.BbvCI')])).toEqual([
      expect.objectContaining({ position: 4, cleavageMode: 'nick_bottom', topCutPosition: null, bottomCutPosition: 9, cutPosition: 9 }),
    ]);
  });

  it('nicks the other physical strand when the site reads on the reverse strand', () => {
    // Nt.BstNBI nicks the strand that reads GAGTC, four bases past the site.
    // Reading GACTC on the top strand means GAGTC is on the bottom strand,
    // so the nick is on the bottom strand, four bases left of the site.
    expect(findRestrictionSites('AAAAAAAA' + 'GACTC' + 'AAA', [enzyme('Nt.BstNBI')])).toEqual([
      expect.objectContaining({ position: 8, strand: -1, cleavageMode: 'nick_bottom', topCutPosition: null, bottomCutPosition: 4, cutPosition: 4 }),
    ]);
    // Nb.BbvCI nicks the strand facing CCTCAGC; with GCTGAGG on the top strand that is the top strand.
    expect(findRestrictionSites('AAAA' + 'GCTGAGG' + 'AAAA', [enzyme('Nb.BbvCI')])).toEqual([
      expect.objectContaining({ position: 4, strand: -1, cleavageMode: 'nick_top', topCutPosition: 6, bottomCutPosition: null, cutPosition: 6 }),
    ]);
  });
});
