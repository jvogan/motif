import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';
import type { RestrictionEnzyme } from '../../bio/types';
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

  it('reports nickase recognition without inventing a double-strand fragment boundary', () => {
    const recipe = buildDigestRecipe({
      sequence: 'AAAACCTCAGCAAAA',
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'Nb.BbvCI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    });

    expect(recipe.isValid).toBe(true);
    expect(recipe.enzymes).toMatchObject([{
      name: 'Nb.BbvCI',
      cutCount: 0,
      nickCount: 1,
      type: 'nickase',
    }]);
    expect(recipe.recognitionSiteCount).toBe(1);
    expect(recipe.cutCount).toBe(0);
    expect(recipe.outcome).toBe('uncut');
    expect(recipe.fragments).toHaveLength(1);
  });

  it('keeps DpnI conditional until methylation is explicit and preserves the assumption', () => {
    const input = {
      sequence: 'AAAAGATCAAAA',
      sequenceType: 'dna' as const,
      topology: 'linear' as const,
      enzymeText: 'DpnI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    };

    const unknown = buildDigestRecipe({ ...input, methylationState: 'unknown' });
    expect(unknown.isValid).toBe(false);
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'methylation_unknown' }));
    expect(unknown.methylationAssumptions).toBe('unknown');

    const methylated = buildDigestRecipe({ ...input, methylationState: 'methylated' });
    expect(methylated.isValid).toBe(true);
    expect(methylated.cutCount).toBe(1);
    expect(methylated.fragments).toHaveLength(2);
    expect(methylated.methylationAssumptions).toBe('methylated');

    const unmethylated = buildDigestRecipe({ ...input, methylationState: 'unmethylated' });
    expect(unmethylated.isValid).toBe(false);
    expect(unmethylated.issues).toContainEqual(expect.objectContaining({ code: 'methylation_unmethylated' }));
    expect(unmethylated.methylationAssumptions).toBe('unmethylated');
  });

  it('keeps mixed dam and CpG assumptions independent, including context-dependent MspI', () => {
    const input = {
      sequence: 'AAAAGATCAAAACCGGAAAA',
      sequenceType: 'dna' as const,
      topology: 'linear' as const,
      enzymeText: 'DpnI, HpaII, MspI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    };

    const conditional = buildDigestRecipe({
      ...input,
      methylationAssumptions: { dam: 'methylated', cpg: 'unknown' },
    });
    expect(conditional.isValid).toBe(false);
    expect(conditional.methylationAssumptions).toEqual({ dam: 'methylated', cpg: 'unknown' });
    expect(conditional.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'methylation_unknown', enzyme: 'HpaII' }),
      expect.objectContaining({ code: 'methylation_context_unknown', enzyme: 'MspI' }),
    ]));
    expect(conditional.enzymes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'HpaII',
        methylationRequirement: expect.objectContaining({ target: 'cpg', state: 'unmethylated' }),
        methylationEvidence: expect.objectContaining({ source: expect.stringContaining('neb.com') }),
      }),
      expect.objectContaining({
        name: 'MspI',
        methylationBehavior: 'context_dependent',
        methylationEvidence: expect.objectContaining({ source: expect.stringContaining('neb.com') }),
      }),
    ]));

    const resolved = buildDigestRecipe({
      ...input,
      methylationAssumptions: { dam: 'methylated', cpg: 'unmethylated' },
    });
    expect(resolved.isValid).toBe(true);
    expect(resolved.cutCount).toBe(2);
    expect(resolved.recognitionSiteCount).toBe(3);
    expect(resolved.methylationAssumptions).toEqual({ dam: 'methylated', cpg: 'unmethylated' });
  });

  it('snapshots only supported methylation targets without enumerating or evaluating caller data', () => {
    const input = {
      sequence: 'AAAAGATCAAAA',
      sequenceType: 'dna' as const,
      topology: 'linear' as const,
      enzymeText: 'DpnI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    };
    const target: Record<string, unknown> = {
      dam: 'methylated',
      dcm: 'unknown',
      cpg: 'unknown',
      custom: 'unmethylated',
    };
    for (let index = 0; index < 50_000; index += 1) {
      target[`unrelated-${index}`] = 'unknown';
    }
    let ownKeysCalls = 0;
    const largeAssumptions = new Proxy(target, {
      ownKeys() {
        ownKeysCalls += 1;
        throw new Error('methylation assumptions must not be enumerated');
      },
    });
    const resolved = buildDigestRecipe({
      ...input,
      methylationAssumptions: largeAssumptions as never,
    });

    expect(ownKeysCalls).toBe(0);
    expect(resolved.isValid).toBe(true);
    expect(resolved.cutCount).toBe(1);
    expect(resolved.methylationAssumptions).toEqual({
      dam: 'methylated',
      dcm: 'unknown',
      cpg: 'unknown',
      custom: 'unmethylated',
    });

    let getterReads = 0;
    const accessorAssumptions = Object.defineProperty({}, 'dam', {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        return 'methylated';
      },
    });
    const rejected = buildDigestRecipe({
      ...input,
      methylationAssumptions: accessorAssumptions as never,
    });

    expect(getterReads).toBe(0);
    expect(rejected.isValid).toBe(false);
    expect(rejected.issues).toContainEqual(expect.objectContaining({ code: 'methylation_unknown' }));
  });

  it('detaches normalized enzyme geometry and nested evidence from the caller catalog', () => {
    const enzyme: RestrictionEnzyme = {
      name: 'StateI',
      recognitionSequence: 'GATC',
      cutOffset: 1,
      complementCutOffset: 1,
      overhang: 'blunt',
      methylationRequirement: {
        target: 'dam',
        state: 'methylated',
        evidence: {
          source: 'https://example.invalid/statei',
          sourceLabel: 'StateI reference',
          conditions: 'Defined fixture conditions',
        },
      },
    };
    const recipe = buildDigestRecipe({
      sequence: 'AAAAGATCAAAA',
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'StateI',
      enzymeCatalog: [enzyme],
      methylationAssumptions: 'methylated',
    });

    enzyme.cutOffset = 999;
    enzyme.methylationRequirement!.evidence!.conditions = 'mutated after construction';

    expect(recipe.enzymes[0].enzyme.cutOffset).toBe(1);
    expect(recipe.enzymes[0].methylationEvidence?.conditions).toBe('Defined fixture conditions');
    expect(recipe.enzymes[0].enzyme.methylationRequirement?.evidence?.conditions)
      .toBe('Defined fixture conditions');
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
