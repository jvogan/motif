import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';
import {
  buildDigestRecipe,
  resolveDigestEnzymes,
} from '../claude-science-digest-recipe';

describe('Claude Science digest recipe model', () => {
  it('parses compact separators, resolves case-insensitively, and reports duplicate requests', () => {
    const result = resolveDigestEnzymes(
      'ecori, BamHI; ECORI\n  hindiii bamhi',
      RESTRICTION_ENZYMES_FULL,
    );

    expect(result.tokens).toEqual(['ecori', 'BamHI', 'ECORI', 'hindiii', 'bamhi']);
    expect(result.enzymes.map((enzyme) => enzyme.name)).toEqual(['EcoRI', 'BamHI', 'HindIII']);
    expect(result.duplicateNames).toEqual(['EcoRI', 'BamHI']);
    expect(result.unresolvedNames).toEqual([]);
  });

  it('runs a known EcoRI digest and exposes per-enzyme cut counts', () => {
    const recipe = buildDigestRecipe({
      sequence: 'AAAAAAGAATTCTTTTTT',
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'ecori',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    });

    expect(recipe.isValid).toBe(true);
    expect(recipe.enzymes).toMatchObject([{ name: 'EcoRI', cutCount: 1, type: 'traditional' }]);
    expect(recipe.cutCount).toBe(1);
    expect(recipe.outcome).toBe('fragmented');
    expect(recipe.fragments).toHaveLength(2);
    expect(recipe.fragments[0].overhang3).toBe('AATT');
    expect(recipe.fragments[1].overhang5).toBe('AATT');
  });

  it('blocks a mixed known/unknown recipe instead of presenting an intact molecule as success', () => {
    const recipe = buildDigestRecipe({
      sequence: 'AAAAAAGAATTCTTTTTT',
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'EcoRI, MadeUpI; madeupi',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    });

    expect(recipe.isValid).toBe(false);
    expect(recipe.unresolvedNames).toEqual(['MadeUpI']);
    expect(recipe.issues).toContainEqual(expect.objectContaining({
      code: 'unresolved-enzyme',
      names: ['MadeUpI'],
    }));
    // Known names can still show useful cut counts beside the invalid field.
    expect(recipe.enzymes).toMatchObject([{ name: 'EcoRI', cutCount: 1 }]);
    expect(recipe.outcome).toBe('not-run');
    expect(recipe.fragments).toEqual([]);
  });

  it.each([
    {
      label: 'forward',
      sequence: 'TTTTTGGTCTCACAGTGGGGGGGG',
      strand: 1,
      downstreamOverhang: 'CAGT',
      upstreamOverhang: 'ACTG',
    },
    {
      label: 'reverse',
      sequence: 'AAAACCCCAGAGACCTTTTTTTT',
      strand: -1,
      downstreamOverhang: 'CCCC',
      upstreamOverhang: 'GGGG',
    },
  ])('preserves BsaI $label-strand Type IIS geometry', ({
    sequence,
    strand,
    downstreamOverhang,
    upstreamOverhang,
  }) => {
    const recipe = buildDigestRecipe({
      sequence,
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'BSAI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    });

    expect(recipe.isValid).toBe(true);
    expect(recipe.enzymes).toMatchObject([{ name: 'BsaI', cutCount: 1, type: 'type-iis' }]);
    expect(recipe.sites).toMatchObject([{ enzyme: 'BsaI', strand }]);
    expect(recipe.fragments).toHaveLength(2);
    expect(recipe.fragments[0].overhang3).toBe(upstreamOverhang);
    expect(recipe.fragments[1].overhang5).toBe(downstreamOverhang);
    expect(recipe.fragments[1].overhang5Type).toBe('5prime');
  });

  it.each([
    { topology: 'linear' as const, sequence: 'AAAAAAAAAAAA', cuts: 0, fragments: 1, outcome: 'uncut' },
    { topology: 'circular' as const, sequence: 'AAAAAAAAAAAA', cuts: 0, fragments: 1, outcome: 'uncut' },
    { topology: 'linear' as const, sequence: 'AAAAGAATTCAAAA', cuts: 1, fragments: 2, outcome: 'fragmented' },
    { topology: 'circular' as const, sequence: 'AAAAGAATTCAAAA', cuts: 1, fragments: 1, outcome: 'linearized' },
    { topology: 'linear' as const, sequence: 'GAATTCAAAAGAATTC', cuts: 2, fragments: 3, outcome: 'fragmented' },
    { topology: 'circular' as const, sequence: 'GAATTCAAAAGAATTC', cuts: 2, fragments: 2, outcome: 'fragmented' },
  ])('distinguishes $topology $cuts-cut molecules as $outcome', ({
    topology,
    sequence,
    cuts,
    fragments,
    outcome,
  }) => {
    const recipe = buildDigestRecipe({
      sequence,
      sequenceType: 'dna',
      topology,
      enzymeText: 'EcoRI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    });

    expect(recipe.isValid).toBe(true);
    expect(recipe.cutCount).toBe(cuts);
    expect(recipe.fragments).toHaveLength(fragments);
    expect(recipe.outcome).toBe(outcome);
  });

  it.each(['rna', 'protein', 'mixed', 'unknown'] as const)(
    'rejects %s records without scanning or converting them to DNA',
    (sequenceType) => {
      const recipe = buildDigestRecipe({
        sequence: sequenceType === 'rna' ? 'AAAAAAGAAUUCUUUUUU' : 'AAAAAAGAATTCTTTTTT',
        sequenceType,
        topology: 'linear',
        enzymeText: 'EcoRI',
        enzymeCatalog: RESTRICTION_ENZYMES_FULL,
      });

      expect(recipe.isValid).toBe(false);
      expect(recipe.issues).toContainEqual(expect.objectContaining({ code: 'unsupported-sequence-type' }));
      expect(recipe.enzymes).toMatchObject([{ name: 'EcoRI', cutCount: 0 }]);
      expect(recipe.sites).toEqual([]);
      expect(recipe.fragments).toEqual([]);
      expect(recipe.outcome).toBe('not-run');
    },
  );
});
