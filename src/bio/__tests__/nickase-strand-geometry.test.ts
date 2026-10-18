import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { reverseComplement } from '../reverse-complement';
import {
  calculateRestrictionCleavageGeometry,
  findRestrictionSites,
  restrictionSiteActivity,
} from '../restriction-sites';

function catalogEnzyme(name: string) {
  const found = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing catalog enzyme ${name}`);
  return found;
}

// Nt.BbvCI nicks the recognition strand CC^TCAGC; Nb.BbvCI nicks the
// complementary strand of the same site (CCTCA^GC read on the recognition
// strand, i.e. after base 5 of the complementary strand read 5'->3').
describe('nicking-enzyme strand geometry', () => {
  const flank = 'AAAAA';
  const forwardSite = `${flank}CCTCAGC${flank}`;
  const reverseSite = `${flank}${reverseComplement('CCTCAGC')}${flank}`;

  it('reports a forward-strand Nt.BbvCI nick on the molecule top strand', () => {
    const [site] = findRestrictionSites(forwardSite, [catalogEnzyme('Nt.BbvCI')]);
    expect(site).toMatchObject({
      strand: 1,
      cleavageMode: 'nick_top',
      topCutPosition: 7,
      bottomCutPosition: null,
      cutPosition: 7,
      cleavageStatus: 'ok',
    });
    expect(restrictionSiteActivity(site)).toBe('nick-only');
  });

  it('reports a reverse-strand Nt.BbvCI nick on the molecule bottom strand', () => {
    const [site] = findRestrictionSites(reverseSite, [catalogEnzyme('Nt.BbvCI')]);
    // The recognition strand is the molecule bottom strand here; its second
    // base pairs with top index 10, so the nick sits at boundary 10.
    expect(site).toMatchObject({
      strand: -1,
      cleavageMode: 'nick_bottom',
      topCutPosition: null,
      bottomCutPosition: 10,
      cutPosition: 10,
      cleavageStatus: 'ok',
    });
    expect(restrictionSiteActivity(site)).toBe('nick-only');
  });

  it('reports a reverse-strand Nb.BbvCI nick on the molecule top strand', () => {
    const [site] = findRestrictionSites(reverseSite, [catalogEnzyme('Nb.BbvCI')]);
    expect(site).toMatchObject({
      strand: -1,
      cleavageMode: 'nick_top',
      topCutPosition: 7,
      bottomCutPosition: null,
      cutPosition: 7,
    });
    expect(restrictionSiteActivity(site)).toBe('nick-only');
  });

  it('mirrors the molecule-relative geometry when the molecule is reverse-complemented', () => {
    for (const name of ['Nt.BbvCI', 'Nb.BbvCI', 'Nt.BstNBI']) {
      const enzyme = catalogEnzyme(name);
      const sequence = `AAAAAAAA${enzyme.recognitionSequence}AAAAAAAAAAAA`;
      const [forward] = findRestrictionSites(sequence, [enzyme]);
      const [reverse] = findRestrictionSites(reverseComplement(sequence), [enzyme]);
      const flip = (mode: string | undefined) => (mode === 'nick_top' ? 'nick_bottom' : 'nick_top');
      expect(reverse.cleavageMode, name).toBe(flip(forward.cleavageMode));
      const mirror = (value: number | null | undefined) => (value === null || value === undefined ? value : sequence.length - value);
      expect(reverse.topCutPosition, name).toBe(mirror(forward.bottomCutPosition));
      expect(reverse.bottomCutPosition, name).toBe(mirror(forward.topCutPosition));
    }
  });

  it('exposes the molecule-relative mode from the geometry helper', () => {
    const geometry = calculateRestrictionCleavageGeometry(catalogEnzyme('Nt.BbvCI'), 5, -1);
    expect(geometry).toMatchObject({ mode: 'nick_bottom', topCutPosition: null, bottomCutPosition: 10, valid: true });
    const forward = calculateRestrictionCleavageGeometry(catalogEnzyme('Nt.BbvCI'), 5, 1);
    expect(forward).toMatchObject({ mode: 'nick_top', topCutPosition: 7, bottomCutPosition: null, valid: true });
  });
});
