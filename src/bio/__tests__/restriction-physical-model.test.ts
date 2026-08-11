import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import {
  digestPreviewDetailed,
  restrictionDigestDetailed,
} from '../restriction-digest';
import {
  countAmbiguousBases,
  findRestrictionSites,
  MAX_RESTRICTION_ENZYMES,
  MAX_RESTRICTION_ENZYME_NAME_LENGTH,
  isValidRestrictionRecognitionSequence,
  normalizeRestrictionSequence,
} from '../restriction-sites';
import type { RestrictionEnzyme } from '../types';
import { buildDigestRecipe } from '../../artifacts/claude-science-digest-recipe';

const byName = (name: string): RestrictionEnzyme => {
  const enzyme = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === name);
  if (!enzyme) throw new Error(`Missing test enzyme ${name}`);
  return enzyme;
};

describe('physical restriction model', () => {
  it('returns a typed invalid-topology result at the digest boundary', () => {
    const result = restrictionDigestDetailed('AAAAGAATTC', ['EcoRI'], 'wrapped' as never);
    expect(result).toMatchObject({
      topology: 'linear',
      issues: [expect.objectContaining({ code: 'invalid_topology' })],
      fragments: [],
    });
  });

  it.each(['BsaI', 'BbsI', 'BsmBI', 'SapI'])('reports insufficient_flanking_bases for a short linear %s site', (name) => {
    const enzyme = byName(name);
    const result = restrictionDigestDetailed(enzyme.recognitionSequence, [name]);
    const site = result.sites[0];

    expect(site).toBeDefined();
    expect(site?.topCutPosition).not.toBeNull();
    expect(site?.bottomCutPosition).not.toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'insufficient_flanking_bases',
      enzyme: name,
    }));
    expect(result.fragments).toEqual([]);
  });

  it.each([
    { name: 'BsaI', site: 'GGTCTC', flank: 'AAAAAAAAAAAA' },
    { name: 'BbsI', site: 'GAAGAC', flank: 'AAAAAAAAAAAA' },
    { name: 'BsmBI', site: 'CGTCTC', flank: 'AAAAAAAAAAAA' },
    { name: 'SapI', site: 'GCTCTTC', flank: 'AAAAAAAAAAAA' },
  ])('keeps forward and reverse strand cleavage coordinates explicit for $name', ({ name, site, flank }) => {
    const enzyme = byName(name);
    const forward = findRestrictionSites(site + flank, [enzyme])[0];
    const reverseSite = [...site].reverse().map((base) => ({ A: 'T', T: 'A', C: 'G', G: 'C' }[base] ?? base)).join('');
    const reverse = findRestrictionSites(flank + reverseSite + flank, [enzyme])
      .find((candidate) => candidate.strand === -1);

    expect(forward).toMatchObject({ strand: 1, cleavageMode: 'double-strand' });
    expect(forward?.topCutPosition).toBe(enzyme.cutOffset);
    expect(forward?.bottomCutPosition).toBe(enzyme.complementCutOffset);
    expect(reverse).toBeDefined();
    if (!reverse) throw new Error('Expected reverse-strand site');
    expect(reverse?.topCutPosition).toBe(reverse?.position + enzyme.recognitionSequence.length - enzyme.complementCutOffset);
    expect(reverse?.bottomCutPosition).toBe(reverse?.position + enzyme.recognitionSequence.length - enzyme.cutOffset);
  });

  it('never converts a missing sticky overhang window into a blunt end', () => {
    const result = restrictionDigestDetailed('GGTCTC', ['BsaI']);
    expect(result.fragments).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: 'insufficient_flanking_bases' });
    expect(result.fragments.every((fragment) => fragment.overhang5Type !== 'blunt' || fragment.overhang5 === '')).toBe(true);
  });

  it('treats every catalog nickase as a one-strand event without increasing fragment count', () => {
    const nickases = RESTRICTION_ENZYMES_FULL.filter((enzyme) => enzyme.cleavageMode?.startsWith('nick_'));
    expect(nickases.map((enzyme) => enzyme.name)).toEqual(['Nb.BbvCI', 'Nt.BbvCI', 'Nt.BstNBI']);
    for (const enzyme of nickases) {
      const sequence = enzyme.recognitionSequence + 'AAAAAAAAAAAA';
      const result = restrictionDigestDetailed(sequence, [enzyme.name]);
      expect(enzyme.cleavageMode).toMatch(/^nick_(top|bottom)$/);
      expect(result.cuts).toEqual([]);
      expect(result.fragments).toHaveLength(1);
      expect(result.fragments[0].length).toBe(sequence.length);
      expect(result.fragments[0].sequence).toBe(sequence);
    }
  });

  it('requires an explicit methylation assumption before DpnI can cut', () => {
    const sequence = 'AAAAGATCAAAA';
    const unknown = restrictionDigestDetailed(sequence, ['DpnI']);
    const unmethylated = restrictionDigestDetailed(sequence, ['DpnI'], 'linear', undefined, undefined, {
      methylation: 'unmethylated',
    });
    const methylated = restrictionDigestDetailed(sequence, ['DpnI'], 'linear', undefined, undefined, {
      methylationAssumptions: { dam: 'methylated' },
    });

    expect(byName('DpnI').methylationRequirement).toMatchObject({ target: 'dam', state: 'methylated' });
    expect(unknown).toMatchObject({ cutCount: 0, fragments: [] });
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'methylation_unknown' }));
    expect(unmethylated.issues).toContainEqual(expect.objectContaining({ code: 'methylation_unmethylated' }));
    expect(methylated).toMatchObject({ cutCount: 1 });
    expect(methylated.fragments).toHaveLength(2);
    expect(methylated.fragments.every((fragment) => fragment.overhang5Type === 'blunt' || fragment.overhang5.length > 0)).toBe(true);
  });

  it.each([
    { name: 'DpnII', target: 'dam' as const, sequence: 'AAAAGATCAAAA' },
    { name: 'MboI', target: 'dam' as const, sequence: 'AAAAGATCAAAA' },
    { name: 'HpaII', target: 'cpg' as const, sequence: 'AAAACCGGAAAA' },
    { name: 'HhaI', target: 'cpg' as const, sequence: 'AAAAGCGCAAAA' },
  ])('models unmethylated cutting for $name with first-party evidence', ({ name, target, sequence }) => {
    const unknown = restrictionDigestDetailed(sequence, [name]);
    const unmethylated = restrictionDigestDetailed(sequence, [name], 'linear', undefined, undefined, {
      methylationAssumptions: { [target]: 'unmethylated' },
    });
    expect(byName(name).methylationRequirement).toMatchObject({ target, state: 'unmethylated' });
    expect(byName(name).methylationRequirement?.evidence?.source).toMatch(/^https:\/\/www\.neb\.com\//);
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'methylation_unknown' }));
    expect(unmethylated.cutCount).toBe(1);
  });

  it('keeps MspI external/internal methylation nuance conditional', () => {
    const sequence = 'AAAACCGGAAAA';
    expect(restrictionDigestDetailed(sequence, ['MspI']).issues).toContainEqual(expect.objectContaining({
      code: 'methylation_context_unknown',
      enzyme: 'MspI',
    }));
    expect(restrictionDigestDetailed(sequence, ['MspI'], 'linear', undefined, undefined, {
      methylationAssumptions: { cpg: 'unmethylated' },
    }).cutCount).toBe(1);
  });

  it('reports unknown requested enzymes in the detailed preview', () => {
    const preview = digestPreviewDetailed('AAAAGAATTCAAAA', ['EcoRI', 'NotInCatalog']);
    expect(preview.unknownEnzymes).toEqual(['NotInCatalog']);
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'unknown_enzyme', enzyme: 'NotInCatalog' }));
    expect(preview.counts.get('EcoRI')).toBe(1);
  });

  it('returns a typed issue for malformed requested enzyme names', () => {
    const malformedRequests: unknown[] = [
      null,
      [''],
      ['   '],
      ['E'.repeat(MAX_RESTRICTION_ENZYME_NAME_LENGTH + 1)],
      ['EcoRI', null],
      Array.from({ length: MAX_RESTRICTION_ENZYMES + 1 }, () => 'EcoRI'),
    ];
    for (const request of malformedRequests) {
      const result = restrictionDigestDetailed('AAAAGAATTCAAAA', request as never);
      expect(result).toMatchObject({
        fragments: [],
        cuts: [],
        issues: [expect.objectContaining({ code: 'invalid_enzyme_name' })],
      });
    }
    const oversizedInvalidTopology = restrictionDigestDetailed(
      'AAAAGAATTCAAAA',
      Array.from({ length: MAX_RESTRICTION_ENZYMES + 1 }, () => 'EcoRI'),
      'invalid' as never,
    );
    expect(oversizedInvalidTopology.requestedEnzymes).toEqual([]);
  });

  it('rejects malformed custom methylation metadata before scanning', () => {
    const base: RestrictionEnzyme = {
      name: 'CustomMethylation',
      recognitionSequence: 'GATC',
      cutOffset: 2,
      complementCutOffset: 2,
      overhang: 'blunt',
    };
    const malformed: RestrictionEnzyme[] = [
      { ...base, methylationRequirement: { target: 'not-a-target', state: 'methylated' } as never },
      { ...base, methylationRequirement: { target: 'dam', state: 'unknown' } as never },
      { ...base, methylationBehavior: 'always' as never },
      {
        ...base,
        methylationRequirement: {
          target: 'dam',
          state: 'methylated',
          evidence: { source: 42, sourceLabel: 'label', conditions: 'conditions' },
        } as never,
      },
      {
        ...base,
        methylationEvidence: { source: 'source', sourceLabel: 'label', conditions: null },
      } as never,
    ];

    for (const enzyme of malformed) {
      const result = restrictionDigestDetailed(
        'AAAAGATCAAAA',
        [base.name],
        'linear',
        undefined,
        [enzyme],
      );
      expect(result).toMatchObject({
        fragments: [],
        cuts: [],
        issues: [expect.objectContaining({ code: 'invalid_recognition_sequence' })],
      });
    }
  });

  it('normalizes formatted DNA and rejects invalid/custom regex-like recognition strings', () => {
    expect(normalizeRestrictionSequence('  1 gaa ttc\n2 ')).toBe('GAATTC');
    expect(findRestrictionSites('  1 gaa ttc\n2 ', [byName('EcoRI')])).toHaveLength(1);
    expect(countAmbiguousBases('GAATNC')).toBe(1);
    expect(findRestrictionSites('GAATNC', [byName('EcoRI')])).toEqual([]);
    expect(isValidRestrictionRecognitionSequence('GAATTC')).toBe(true);
    expect(isValidRestrictionRecognitionSequence('GAATTC)|.*(')).toBe(false);
    expect(() => findRestrictionSites('GAATTC', [{
      ...byName('EcoRI'),
      recognitionSequence: 'GAATTC)|.*(',
    }])).toThrow(/IUPAC/);
  });

  it.each([
    ['EcoRI', 'AAAAGAATTCAAAA'],
    ['BsaI', 'AAAAAAGGTCTCAAAAA'],
  ])('conserves sequence length and exact fragment sequence for %s', (name, sequence) => {
    const result = restrictionDigestDetailed(sequence, [name]);
    expect(result.issues).toEqual([]);
    expect(result.fragments.reduce((sum, fragment) => sum + fragment.length, 0)).toBe(sequence.length);
    expect(result.fragments.every((fragment) => fragment.length === fragment.sequence.length && fragment.length > 0)).toBe(true);
    expect(result.fragments.map((fragment) => fragment.sequence).join('')).toBe(sequence);
  });

  it('materializes a circular sticky-end window that crosses the origin', () => {
    // EcoRI recognition starts at position 8 and ends at position 4 on this
    // 10-base circular molecule. Its 5-prime overhang is positions 9,0,1,2
    // (AATT), so the digest must remain a valid one-fragment circular digest.
    const sequence = 'ATTCAACCGA';
    const result = restrictionDigestDetailed(sequence, ['EcoRI'], 'circular');

    expect(result.issues).toEqual([]);
    expect(result.cutCount).toBe(1);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]).toMatchObject({
      sequence: 'AATTCAACC G'.replace(' ', ''),
      length: sequence.length,
      startInOriginal: 9,
      endInOriginal: 19,
      overhang5: 'AATT',
      overhang3: 'AATT',
      overhang5Type: '5prime',
      overhang3Type: '5prime',
    });
  });

  it('keeps conditional physical outcomes explicit in the recipe contract', () => {
    const edge = buildDigestRecipe({
      sequence: 'GGTCTC',
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'BsaI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    });
    const nick = buildDigestRecipe({
      sequence: 'CCTCAGCAAAAAAAAAAAA',
      sequenceType: 'dna',
      topology: 'linear',
      enzymeText: 'Nb.BbvCI',
      enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    });

    expect(edge).toMatchObject({ isValid: false, outcome: 'not-run', fragments: [] });
    expect(edge.issues).toContainEqual(expect.objectContaining({ code: 'insufficient_flanking_bases' }));
    expect(nick).toMatchObject({ isValid: true, outcome: 'uncut', cutCount: 0, fragments: [{ length: 19 }] });
  });

  it('reports incompatible co-located strand geometry instead of deduping on top cut', () => {
    const first: RestrictionEnzyme = {
      name: 'CoLocatedA',
      recognitionSequence: 'GAATTC',
      cutOffset: 1,
      complementCutOffset: 5,
      overhang: '5prime',
    };
    const second: RestrictionEnzyme = {
      ...first,
      name: 'CoLocatedB',
      complementCutOffset: 4,
    };
    const result = restrictionDigestDetailed(
      'AAAAAGAATTCAAAA',
      [first.name, second.name],
      'linear',
      undefined,
      [first, second],
    );

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'incompatible_colocated_cleavage',
      position: 6,
    }));
    expect(result.cuts).toHaveLength(2);
    expect(result.fragments).toEqual([]);
  });

  it('deduplicates only fully compatible co-located isoschizomer geometry', () => {
    const result = restrictionDigestDetailed(
      'AAAACCGGAAAA',
      ['HpaII', 'MspI'],
      'linear',
      undefined,
      RESTRICTION_ENZYMES_FULL,
      { methylationAssumptions: { cpg: 'unmethylated' } },
    );
    expect(result.issues).toEqual([]);
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].enzymes).toEqual(['HpaII', 'MspI']);
    expect(result.fragments).toHaveLength(2);
  });
});
