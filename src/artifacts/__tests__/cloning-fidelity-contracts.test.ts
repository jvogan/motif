import { describe, expect, it } from 'vitest';
import { getGoldenGateKit } from '../../bio/golden-gate-kits';
import { planArtifactGibsonDesign } from '../claude-science-cloning-design';

describe('cloning-fidelity contracts', () => {
  it('publishes explicit GoldenBraid level transitions and kit grammar', () => {
    const kit = getGoldenGateKit('goldenbraid-3');
    expect(kit?.levels.map((level) => [level.level, level.enzyme, level.fusionSiteLength, level.nextLevel, level.transitionEnzyme])).toEqual([
      ['entry', 'BsaI', 4, 'alpha', 'BsmBI'],
      ['alpha', 'BsmBI', 4, 'omega', 'BsaI'],
      ['omega', 'BsaI', 4, 'alpha', 'BsmBI'],
    ]);
    expect(kit?.levels.every((level) => level.acceptedFusionSites.length > 0 && level.grammar.length > 0)).toBe(true);
  });

  it('blocks an IUPAC-only Gibson homology claim in the artifact adapter', () => {
    const plan = planArtifactGibsonDesign({
      fragments: [
        { recordId: 'left', name: 'Left', sequence: 'TTTTTNAAAANAAAA', molecule: 'dna' },
        { recordId: 'right', name: 'Right', sequence: 'NAAAANAAAAGGGGG', molecule: 'dna' },
      ],
      topology: 'linear',
      minOverlap: 10,
      maxOverlap: 10,
    });
    expect(plan.product).toBeNull();
    expect(plan.junctions[0]).toMatchObject({
      status: 'ambiguous_overlap',
      overlapState: 'ambiguous_symbols',
      overlapUnique: false,
    });
    expect(plan.junctions[0].issues).toContainEqual(expect.objectContaining({ code: 'ambiguous_overlap_symbols' }));
  });
});
