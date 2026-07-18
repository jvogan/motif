import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES, findRestrictionSites } from '../restriction-sites';

function enzyme(name: string) {
  const match = RESTRICTION_ENZYMES.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing restriction enzyme fixture: ${name}`);
  return match;
}

describe('restriction-site scanning', () => {
  it('reports a non-palindromic reverse-strand Type IIS site with its mirrored cut', () => {
    const sites = findRestrictionSites('AAAAAAGAGACCTTTTT', [enzyme('BsaI')]);

    expect(sites).toEqual([{
      enzyme: 'BsaI',
      position: 6,
      cutPosition: 1,
      recognitionSequence: 'GGTCTC',
      overhang: '5prime',
      strand: -1,
    }]);
  });

  it('finds and wraps a palindromic site that crosses a circular origin once', () => {
    const sequence = 'AATTCCCCCG';
    const ecoRI = enzyme('EcoRI');

    expect(findRestrictionSites(sequence, [ecoRI])).toEqual([]);
    expect(findRestrictionSites(sequence, [ecoRI], { topology: 'circular' })).toEqual([{
      enzyme: 'EcoRI',
      position: 9,
      cutPosition: 0,
      recognitionSequence: 'GAATTC',
      overhang: '5prime',
      strand: 1,
    }]);
  });
});
