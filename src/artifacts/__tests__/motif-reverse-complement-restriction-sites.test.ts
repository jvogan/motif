import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { reverseComplement } from '../../bio/reverse-complement';
import type { RestrictionEnzyme, Topology } from '../../bio/types';
import { normalizeRecord, reverseComplementRestrictionSites, serializeSites, validateRuntimeRecordInputs } from '../motif-artifact';

function enzymeNamed(name: string): RestrictionEnzyme {
  const enzyme = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === name);
  if (!enzyme) throw new Error(`Missing test enzyme ${name}`);
  return enzyme;
}

const interruptedTypeIIS: RestrictionEnzyme = {
  name: 'InterruptedTypeIIS',
  recognitionSequence: 'GTRNAC',
  cutOffset: 7,
  complementCutOffset: 10,
  overhang: '5prime',
};

describe.each<Topology>(['linear', 'circular'])('restriction sites on reverse-complemented %s records', (topology) => {
  it.each([
    { enzyme: enzymeNamed('EcoRI'), motif: 'GAATTC' },
    { enzyme: enzymeNamed('SfiI'), motif: 'GGCCACTGAGGCC' },
    { enzyme: enzymeNamed('HincII'), motif: 'GTTGAC' },
    { enzyme: enzymeNamed('BsaI'), motif: 'GGTCTC' },
    { enzyme: interruptedTypeIIS, motif: 'GTAGAC' },
  ])('agrees with a fresh $enzyme.name scan in both orientations', ({ enzyme, motif }) => {
    const left = 'AACCGG';
    const right = 'CATAG';
    const joined = left + motif + right;
    // Rotate the same synthetic record so circular recognition crosses the origin.
    const split = topology === 'circular' ? left.length + 2 : 0;
    const source = joined.slice(split) + joined.slice(0, split);
    const reversed = reverseComplement(source);
    const sites = findRestrictionSites(source, [enzyme], { topology });
    const rescanned = findRestrictionSites(reversed, [enzyme], { topology });

    expect(sites).toHaveLength(1);
    expect(rescanned).toHaveLength(1);
    expect(sites[0].position).toBe(topology === 'circular' ? source.length - 2 : left.length);

    // The start and the full recognition string define the end, including wraps.
    expect(reverseComplementRestrictionSites(sites, source, topology)).toEqual(rescanned);
    expect(reverseComplementRestrictionSites(rescanned, reversed, topology)).toEqual(sites);
  });
});

it('agrees with a fresh scan when an ambiguous window matches both strands at the same cuts', () => {
  const enzyme: RestrictionEnzyme = {
    name: 'SymmetricAmbiguous',
    recognitionSequence: 'RNNN',
    cutOffset: 1,
    complementCutOffset: 3,
    overhang: '5prime',
  };
  const sequence = 'ACCC';
  const sites = findRestrictionSites(sequence, [enzyme]);
  const rescanned = findRestrictionSites(reverseComplement(sequence), [enzyme]);

  expect(rescanned).toEqual([expect.objectContaining({ strand: 1 })]);
  expect(reverseComplementRestrictionSites(sites, sequence, 'linear')).toEqual(rescanned);
});

it('agrees with a fresh scan of a selected range with insufficient linear flanking bases', () => {
  const motif = 'GGTCTC';
  const padded = 'ACCA' + motif + 'CATAG';
  const selected = padded.slice(4, 4 + motif.length);
  const enzyme = enzymeNamed('BsaI');
  const sites = findRestrictionSites(selected, [enzyme]);
  const reversed = reverseComplement(selected);
  const rescanned = findRestrictionSites(reversed, [enzyme]);

  expect(rescanned).toEqual([expect.objectContaining({
    topCutPosition: -5,
    bottomCutPosition: -1,
    cleavageStatus: 'insufficient_flanking_bases',
  })]);
  const mirrored = reverseComplementRestrictionSites(sites, selected, 'linear');
  expect(mirrored).toEqual(rescanned);

  const record = { molecule: 'dna', topology: 'linear', seq: reversed, sites: serializeSites(mirrored) } as const;
  validateRuntimeRecordInputs([record], 'motifAddRecords');
  expect(normalizeRecord(record, 0)?.sites).toEqual(rescanned);
});

it('agrees with a fresh scan for the interrupted palindrome DrdI', () => {
  const sequence = 'AA' + 'GACACTAGCGTC' + 'TCA';
  const enzyme = enzymeNamed('DrdI');
  const sites = findRestrictionSites(sequence, [enzyme]);
  const rescanned = findRestrictionSites(reverseComplement(sequence), [enzyme]);

  // DrdI GACNNNN^NNGTC cuts its palindromic site symmetrically (7/5), so both
  // orientations give one site: 17 - (2 + 12) = 3, top 3 + 7, bottom 3 + 5.
  expect(rescanned).toEqual([expect.objectContaining({
    position: 3, strand: 1, topCutPosition: 10, bottomCutPosition: 8,
  })]);
  expect(reverseComplementRestrictionSites(sites, sequence, 'linear')).toEqual(rescanned);
});

it('switches a stored nick to the opposite physical strand', () => {
  const sequence = 'AAAA' + 'GAGTC' + 'ACAAG';
  const sites = findRestrictionSites(sequence, [enzymeNamed('Nt.BstNBI')]);

  expect(reverseComplementRestrictionSites(sites, sequence, 'linear')).toEqual([expect.objectContaining({
    position: 5, strand: -1, cleavageMode: 'nick_bottom', topCutPosition: null, bottomCutPosition: 1,
    cutPosition: 1, overhang: 'blunt',
  })]);
});
