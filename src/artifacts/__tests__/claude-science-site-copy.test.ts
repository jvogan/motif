import { describe, expect, it } from 'vitest';
import { restrictionSiteCopy } from '../motif-artifact';

// A selected restriction site stays a site, but Copy takes its bases.
describe('what Copy takes from a selected restriction site', () => {
  const sequence = 'AAAGAATTCAAAGGATCCAA';
  const ecoRI = { enzyme: 'EcoRI', position: 3, recognitionSequence: 'GAATTC' };
  const bamHI = { enzyme: 'BamHI', position: 12, recognitionSequence: 'GGATCC' };

  it('one site gives its recognition bases, named after the enzyme', () => {
    expect(restrictionSiteCopy([ecoRI], sequence, 'linear')).toEqual({ label: 'EcoRI site', bases: 'GAATTC' });
  });

  it('a site across the origin of a circular record reads on through base 1', () => {
    const wrapped = { enzyme: 'EcoRI', position: 17, recognitionSequence: 'GAATTC' };
    expect(restrictionSiteCopy([wrapped], 'ATTCAAAAAAAAAAAAAGA', 'circular')).toEqual({ label: 'EcoRI site', bases: 'GAATTC' });
  });

  it('several sites, no site, or a site that runs off a linear record give nothing', () => {
    expect(restrictionSiteCopy([ecoRI, bamHI], sequence, 'linear')).toBeNull();
    expect(restrictionSiteCopy([], sequence, 'linear')).toBeNull();
    expect(restrictionSiteCopy([{ ...ecoRI, position: 17 }], sequence, 'linear')).toBeNull();
  });
});
