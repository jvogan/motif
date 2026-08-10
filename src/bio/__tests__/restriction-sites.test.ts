import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { reverseComplement } from '../reverse-complement';
import {
  RESTRICTION_ENZYMES,
  classifyRestrictionEnzymes,
  findNonCutters,
  findRestrictionSites,
  isActiveDoubleStrandRestrictionSite,
  restrictionSiteActivity,
} from '../restriction-sites';
import { resolveEnzymeUnion } from '../restriction-presets';
import type { RestrictionEnzyme } from '../types';

function enzyme(name: string) {
  const match = RESTRICTION_ENZYMES.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing restriction enzyme fixture: ${name}`);
  return match;
}

const iupacBases: Record<string, readonly string[]> = {
  A: ['A'], C: ['C'], G: ['G'], T: ['T'],
  R: ['A', 'G'], Y: ['C', 'T'], S: ['G', 'C'], W: ['A', 'T'],
  K: ['G', 'T'], M: ['A', 'C'], B: ['C', 'G', 'T'], D: ['A', 'G', 'T'],
  H: ['A', 'C', 'T'], V: ['A', 'C', 'G'], N: ['A', 'C', 'G', 'T'],
};

function materializeRecognitionSequence(recognitionSequence: string): string {
  return [...recognitionSequence.toUpperCase()]
    .map((base) => iupacBases[base]?.[0] ?? base)
    .join('');
}

function reverseOnlyRecognitionExample(recognitionSequence: string): string | null {
  const forward = recognitionSequence.toUpperCase();
  const reverse = reverseComplement(forward);
  if (reverse === forward) return null;
  const sequence = [...reverse].map((base) => iupacBases[base]?.[0] ?? base);
  for (let index = 0; index < reverse.length; index++) {
    const forwardChoices = new Set(iupacBases[forward[index]] ?? [forward[index]]);
    const reverseOnlyBase = (iupacBases[reverse[index]] ?? [reverse[index]])
      .find((base) => !forwardChoices.has(base));
    if (reverseOnlyBase) {
      sequence[index] = reverseOnlyBase;
      return sequence.join('');
    }
  }
  return null;
}

describe('restriction-site scanning', () => {
  it('anchors every catalog recognition sequence and sense-strand cut at its actual match', () => {
    for (const candidate of RESTRICTION_ENZYMES_FULL) {
      const sequence = materializeRecognitionSequence(candidate.recognitionSequence);
      const sites = findRestrictionSites(sequence, [candidate]);

      expect(sites, candidate.name).toContainEqual(expect.objectContaining({
        enzyme: candidate.name,
        position: 0,
        cutPosition: candidate.cutOffset,
        recognitionSequence: candidate.recognitionSequence,
        overhang: candidate.overhang,
        strand: 1,
        cleavageMode: candidate.cleavageMode ?? 'double-strand',
        topCutPosition: candidate.cleavageMode === 'nick_bottom' ? null : candidate.cutOffset,
        bottomCutPosition: candidate.cleavageMode === 'nick_top' ? null : candidate.complementCutOffset,
      }));
    }
  });

  it('anchors every non-palindromic catalog entry on the reverse strand with its mirrored cut', () => {
    let checked = 0;
    for (const candidate of RESTRICTION_ENZYMES_FULL) {
      const sequence = reverseOnlyRecognitionExample(candidate.recognitionSequence);
      if (!sequence) continue;
      checked += 1;
      const sites = findRestrictionSites(sequence, [candidate]);

      expect(sites, candidate.name).toContainEqual(expect.objectContaining({
        enzyme: candidate.name,
        position: 0,
        cutPosition: candidate.recognitionSequence.length - candidate.complementCutOffset,
        recognitionSequence: candidate.recognitionSequence,
        overhang: candidate.overhang,
        strand: -1,
        cleavageMode: candidate.cleavageMode ?? 'double-strand',
        topCutPosition: candidate.cleavageMode === 'nick_bottom'
          ? null
          : candidate.recognitionSequence.length - candidate.complementCutOffset,
        bottomCutPosition: candidate.cleavageMode === 'nick_top'
          ? null
          : candidate.recognitionSequence.length - candidate.cutOffset,
      }));
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('reports a non-palindromic reverse-strand Type IIS site with its mirrored cut', () => {
    const sites = findRestrictionSites('AAAAAAGAGACCTTTTT', [enzyme('BsaI')]);

    expect(sites).toEqual([expect.objectContaining({
      enzyme: 'BsaI',
      position: 6,
      cutPosition: 1,
      recognitionSequence: 'GGTCTC',
      overhang: '5prime',
      strand: -1,
      cleavageMode: 'double-strand',
      topCutPosition: 1,
      bottomCutPosition: 5,
      cleavageStatus: 'ok',
    })]);
  });

  it('retains distinct physical geometries when an asymmetric ambiguous site matches both strands', () => {
    const asymmetric: RestrictionEnzyme = {
      name: 'AsymmetricAmbiguous',
      recognitionSequence: 'RNNN',
      cutOffset: 1,
      complementCutOffset: 2,
      overhang: '5prime',
    };
    const sites = findRestrictionSites('ACCC', [asymmetric]);

    expect(sites).toHaveLength(2);
    expect(sites.map(({ strand, position, topCutPosition, bottomCutPosition }) => ({
      strand,
      position,
      topCutPosition,
      bottomCutPosition,
    }))).toEqual(expect.arrayContaining([
      { strand: 1, position: 0, topCutPosition: 1, bottomCutPosition: 2 },
      { strand: -1, position: 0, topCutPosition: 2, bottomCutPosition: 3 },
    ]));
  });

  it('merges strand matches only when their physical cut geometry is identical', () => {
    const symmetricGeometry: RestrictionEnzyme = {
      name: 'SymmetricGeometryAmbiguous',
      recognitionSequence: 'RNNN',
      cutOffset: 1,
      complementCutOffset: 3,
      overhang: '5prime',
    };
    const sites = findRestrictionSites('ACCC', [symmetricGeometry]);

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      strand: 1,
      topCutPosition: 1,
      bottomCutPosition: 3,
    });
  });

  it('finds and wraps a palindromic site that crosses a circular origin once', () => {
    const sequence = 'AATTCCCCCG';
    const ecoRI = enzyme('EcoRI');

    expect(findRestrictionSites(sequence, [ecoRI])).toEqual([]);
    expect(findRestrictionSites(sequence, [ecoRI], { topology: 'circular' })).toEqual([expect.objectContaining({
      enzyme: 'EcoRI',
      position: 9,
      cutPosition: 0,
      recognitionSequence: 'GAATTC',
      overhang: '5prime',
      strand: 1,
      cleavageMode: 'double-strand',
      topCutPosition: 0,
      bottomCutPosition: 4,
      cleavageStatus: 'ok',
    })]);
  });

  it('keeps physical safety fields enumerable across spreads and JSON round trips', () => {
    const [site] = findRestrictionSites('AAAAAGAATTCAAAA', [enzyme('EcoRI')]);
    expect(Object.keys(site)).toEqual(expect.arrayContaining([
      'cleavageMode',
      'topCutPosition',
      'bottomCutPosition',
      'cleavageStatus',
    ]));
    const spread = { ...site };
    const restored = JSON.parse(JSON.stringify(site)) as typeof site;
    expect(spread).toMatchObject({
      cleavageMode: 'double-strand',
      topCutPosition: 6,
      bottomCutPosition: 10,
      cleavageStatus: 'ok',
    });
    expect(restored).toMatchObject(spread);
    expect(isActiveDoubleStrandRestrictionSite(restored)).toBe(true);

    const legacy = { ...site };
    delete legacy.cleavageMode;
    delete legacy.topCutPosition;
    delete legacy.bottomCutPosition;
    delete legacy.cleavageStatus;
    expect(restrictionSiteActivity(legacy)).toBe('legacy-unsafe');
    expect(isActiveDoubleStrandRestrictionSite(legacy)).toBe(false);
  });

  it('resolves Common enzymes to full catalog methylation records', () => {
    const full = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === 'HpaII');
    const common = RESTRICTION_ENZYMES.find((candidate) => candidate.name === 'HpaII');
    const resolved = resolveEnzymeUnion(['common']).find((candidate) => candidate.name === 'HpaII');
    expect(full?.methylationRequirement).toMatchObject({ target: 'cpg', state: 'unmethylated' });
    expect(common).toBe(full);
    expect(resolved).toBe(full);
    expect(resolved?.methylationRequirement?.evidence?.source).toMatch(/^https:\/\/www\.neb\.com\//);
  });

  it('categorizes no-site, nick, conditional, and incomplete legacy outcomes', () => {
    const nick = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === 'Nb.BbvCI');
    const conditional = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === 'DpnI');
    if (!nick || !conditional) throw new Error('Missing activity-category fixture');
    const sequence = 'AAAAGATCAAAA';
    const [noSite] = classifyRestrictionEnzymes('AAAAAAAAAAAA', [conditional]);
    const [conditionalSite] = classifyRestrictionEnzymes(sequence, [conditional]);
    const [nickSite] = classifyRestrictionEnzymes(nick.recognitionSequence + 'AAAAAAAA', [nick]);
    expect(noSite.category).toBe('no-site');
    expect(conditionalSite.category).toBe('conditional');
    expect(nickSite.category).toBe('nick-only');
    expect(classifyRestrictionEnzymes(sequence, [conditional])[0].activeDoubleStrandSiteCount).toBe(0);
    expect(findNonCutters(sequence, [conditional, nick]).map((candidate) => candidate.name))
      .toEqual([conditional.name, nick.name]);
  });
});
