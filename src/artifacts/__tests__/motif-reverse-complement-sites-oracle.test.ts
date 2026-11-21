import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { reverseComplement } from '../../bio/reverse-complement';
import type { RestrictionEnzyme, RestrictionSite, Topology } from '../../bio/types';
import {
  normalizeRecord,
  reverseComplementRestrictionSites,
  scanRestrictionSitesForRecord,
  serializeSites,
  validateRuntimeRecordInputs,
} from '../motif-artifact';

// An independent oracle for the whole-record reverse-complement action: the
// sites it carries over must be exactly what a fresh scan of the
// reverse-complemented text finds. Every sequence here is made up.

function enzyme(name: string): RestrictionEnzyme {
  const found = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing catalog enzyme ${name}`);
  return found;
}

// FokI is not in the catalog. GGATG(9/13): top cut 5 + 9 = 14, bottom 5 + 13 = 18.
const FOKI: RestrictionEnzyme = { name: 'FokI', recognitionSequence: 'GGATG', cutOffset: 14, complementCutOffset: 18, overhang: '5prime' };
// A made-up Type IIS enzyme that cuts upstream (left) of its forward site.
const UPSTREAM: RestrictionEnzyme = { name: 'UpstreamCutter', recognitionSequence: 'GCAGTG', cutOffset: -6, complementCutOffset: -2, overhang: '5prime' };
// One window can match both orientations with different cuts: two sites at one position.
const BOTH_STRANDS: RestrictionEnzyme = { name: 'BothStrandsAmbiguous', recognitionSequence: 'RNNN', cutOffset: 1, complementCutOffset: 2, overhang: '5prime' };

type Fields = Pick<RestrictionSite, 'enzyme' | 'position' | 'cutPosition' | 'recognitionSequence' | 'overhang' | 'strand'>
  & { cleavageMode: unknown; topCutPosition: unknown; bottomCutPosition: unknown; cleavageStatus: unknown; overhangLength: number | null };

/** Every field a user can see or a digest reads, plus the overhang length the two cuts imply. */
function fields(site: RestrictionSite, circularLength = 0): Fields {
  const top = site.topCutPosition;
  const bottom = site.bottomCutPosition;
  const gap = typeof top === 'number' && typeof bottom === 'number' ? Math.abs(top - bottom) : null;
  return {
    enzyme: site.enzyme,
    position: site.position,
    cutPosition: site.cutPosition,
    recognitionSequence: site.recognitionSequence,
    overhang: site.overhang,
    strand: site.strand ?? 1,
    cleavageMode: site.cleavageMode,
    topCutPosition: top,
    bottomCutPosition: bottom,
    cleavageStatus: site.cleavageStatus,
    // On a circular record an overhang can straddle the origin: take the shorter way round.
    overhangLength: gap === null || circularLength === 0 ? gap : Math.min(gap, circularLength - gap),
  };
}

function sorted(sites: readonly RestrictionSite[]): Fields[] {
  return sites.map((site) => fields(site)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function mirrorAndRescan(sequence: string, enzymes: RestrictionEnzyme[], topology: Topology) {
  const forward = findRestrictionSites(sequence, enzymes, { topology });
  const reversed = reverseComplement(sequence);
  const rescanned = findRestrictionSites(reversed, enzymes, { topology });
  const mirrored = reverseComplementRestrictionSites(forward, sequence, topology);
  return { forward, reversed, rescanned, mirrored };
}

/** What the user sees: the scan of the new record merged with the sites the action stored on it. */
function displayedAfterAction(sequence: string, enzymes: RestrictionEnzyme[], topology: Topology) {
  const source = { molecule: 'dna', topology, seq: sequence, sites: serializeSites(findRestrictionSites(sequence, enzymes, { topology })) } as const;
  validateRuntimeRecordInputs([source], 'motifAddRecords');
  const record = normalizeRecord(source, 0)!;
  const added = {
    molecule: 'dna',
    topology,
    seq: reverseComplement(record.sequence),
    sites: serializeSites(reverseComplementRestrictionSites(record.sites, record.sequence, topology)),
  } as const;
  validateRuntimeRecordInputs([added], 'motifAddRecords');
  const child = normalizeRecord(added, 1)!;
  return {
    displayed: scanRestrictionSitesForRecord(child, enzymes).sites,
    fresh: findRestrictionSites(child.sequence, enzymes, { topology }),
  };
}

const A = (count: number) => 'A'.repeat(count);
const rotate = (text: string, by: number) => text.slice(by) + text.slice(0, by);

type Case = { label: string; enzymes: RestrictionEnzyme[]; sequence: string; topology: Topology; expect: { enzyme: string; position: number } };

const cases: Case[] = [
  // Palindromic 6-cutters: 5' overhang, 3' overhang, blunt.
  { label: 'EcoRI 5′ overhang', enzymes: [enzyme('EcoRI')], sequence: A(7) + 'GAATTC' + A(9), topology: 'linear', expect: { enzyme: 'EcoRI', position: 7 } },
  { label: 'PstI 3′ overhang', enzymes: [enzyme('PstI')], sequence: A(4) + 'CTGCAG' + A(11), topology: 'linear', expect: { enzyme: 'PstI', position: 4 } },
  { label: 'KpnI 3′ overhang, circular', enzymes: [enzyme('KpnI')], sequence: A(10) + 'GGTACC' + A(3), topology: 'circular', expect: { enzyme: 'KpnI', position: 10 } },
  { label: 'EcoRV blunt', enzymes: [enzyme('EcoRV')], sequence: A(3) + 'GATATC' + A(12), topology: 'linear', expect: { enzyme: 'EcoRV', position: 3 } },
  { label: 'SmaI blunt, circular', enzymes: [enzyme('SmaI')], sequence: A(8) + 'CCCGGG' + A(5), topology: 'circular', expect: { enzyme: 'SmaI', position: 8 } },
  // Interrupted palindromes with N.
  { label: 'SfiI', enzymes: [enzyme('SfiI')], sequence: A(5) + 'GGCCACTGAGGCC' + A(12), topology: 'linear', expect: { enzyme: 'SfiI', position: 5 } },
  { label: 'BglI', enzymes: [enzyme('BglI')], sequence: A(2) + 'GCCTCAGTGGC' + A(14), topology: 'linear', expect: { enzyme: 'BglI', position: 2 } },
  { label: 'DrdI', enzymes: [enzyme('DrdI')], sequence: A(6) + 'GACTTCAGAGTC' + A(4), topology: 'linear', expect: { enzyme: 'DrdI', position: 6 } },
  { label: 'XcmI', enzymes: [enzyme('XcmI')], sequence: A(3) + 'CCAGTCACTGTATGG' + A(6), topology: 'linear', expect: { enzyme: 'XcmI', position: 3 } },
  { label: 'BstXI', enzymes: [enzyme('BstXI')], sequence: A(5) + 'CCAGTCACCTGG' + A(5), topology: 'linear', expect: { enzyme: 'BstXI', position: 5 } },
  // Degenerate R/Y/W/M/K sites.
  { label: 'HincII GTYRAC', enzymes: [enzyme('HincII')], sequence: A(5) + 'GTCGAC' + A(9), topology: 'linear', expect: { enzyme: 'HincII', position: 5 } },
  { label: 'AccI GTMKAC', enzymes: [enzyme('AccI')], sequence: A(4) + 'GTATAC' + A(4), topology: 'linear', expect: { enzyme: 'AccI', position: 4 } },
  { label: 'BsiHKAI GWGCWC', enzymes: [enzyme('BsiHKAI')], sequence: A(6) + 'GAGCTC' + A(7), topology: 'linear', expect: { enzyme: 'BsiHKAI', position: 6 } },
  { label: 'AvaII GGWCC (odd length)', enzymes: [enzyme('AvaII')], sequence: A(9) + 'GGACC' + A(2), topology: 'linear', expect: { enzyme: 'AvaII', position: 9 } },
  { label: 'PpuMI RGGWCCY', enzymes: [enzyme('PpuMI')], sequence: A(3) + 'AGGTCCT' + A(8), topology: 'linear', expect: { enzyme: 'PpuMI', position: 3 } },
  // Non-palindromic Type IIS, each orientation, cutting outside the site on each side.
  { label: 'BsaI forward, cuts right', enzymes: [enzyme('BsaI')], sequence: A(4) + 'GGTCTC' + A(14), topology: 'linear', expect: { enzyme: 'BsaI', position: 4 } },
  { label: 'BsaI reverse, cuts left', enzymes: [enzyme('BsaI')], sequence: A(14) + 'GAGACC' + A(4), topology: 'linear', expect: { enzyme: 'BsaI', position: 14 } },
  { label: 'BsmBI forward', enzymes: [enzyme('BsmBI')], sequence: A(3) + 'CGTCTC' + A(15), topology: 'linear', expect: { enzyme: 'BsmBI', position: 3 } },
  { label: 'BsmBI reverse', enzymes: [enzyme('BsmBI')], sequence: A(15) + 'GAGACG' + A(3), topology: 'linear', expect: { enzyme: 'BsmBI', position: 15 } },
  { label: 'SapI forward', enzymes: [enzyme('SapI')], sequence: A(2) + 'GCTCTTC' + A(14), topology: 'linear', expect: { enzyme: 'SapI', position: 2 } },
  { label: 'BspQI reverse', enzymes: [enzyme('BspQI')], sequence: A(13) + 'GAAGAGC' + A(3), topology: 'linear', expect: { enzyme: 'BspQI', position: 13 } },
  { label: 'FokI forward', enzymes: [FOKI], sequence: A(3) + 'GGATG' + A(22), topology: 'linear', expect: { enzyme: 'FokI', position: 3 } },
  { label: 'FokI reverse', enzymes: [FOKI], sequence: A(22) + 'CATCC' + A(3), topology: 'linear', expect: { enzyme: 'FokI', position: 22 } },
  { label: 'upstream cutter forward', enzymes: [UPSTREAM], sequence: A(10) + 'GCAGTG' + A(4), topology: 'linear', expect: { enzyme: 'UpstreamCutter', position: 10 } },
  { label: 'upstream cutter reverse', enzymes: [UPSTREAM], sequence: A(4) + 'CACTGC' + A(10), topology: 'linear', expect: { enzyme: 'UpstreamCutter', position: 4 } },
  // Circular Type IIS whose cuts wrap the origin.
  { label: 'BsaI forward, cuts wrap the origin', enzymes: [enzyme('BsaI')], sequence: A(5) + 'GGTCTC' + A(4), topology: 'circular', expect: { enzyme: 'BsaI', position: 5 } },
  { label: 'FokI reverse, cuts wrap the origin', enzymes: [FOKI], sequence: A(2) + 'CATCC' + A(16), topology: 'circular', expect: { enzyme: 'FokI', position: 2 } },
  // Position 0, the last base, and across the origin.
  { label: 'EcoRI at position 0, linear', enzymes: [enzyme('EcoRI')], sequence: 'GAATTC' + A(10), topology: 'linear', expect: { enzyme: 'EcoRI', position: 0 } },
  { label: 'EcoRI ending on the last base, linear', enzymes: [enzyme('EcoRI')], sequence: A(10) + 'GAATTC', topology: 'linear', expect: { enzyme: 'EcoRI', position: 10 } },
  { label: 'EcoRI starting on the last base, circular', enzymes: [enzyme('EcoRI')], sequence: rotate(A(10) + 'GAATTC', 11), topology: 'circular', expect: { enzyme: 'EcoRI', position: 15 } },
  { label: 'SfiI across the origin, circular', enzymes: [enzyme('SfiI')], sequence: rotate(A(9) + 'GGCCACTGAGGCC', 15), topology: 'circular', expect: { enzyme: 'SfiI', position: 16 } },
  { label: 'BsaI reverse at position 0, circular', enzymes: [enzyme('BsaI')], sequence: 'GAGACC' + A(12), topology: 'circular', expect: { enzyme: 'BsaI', position: 0 } },
  // Linear records where a cut falls off an end.
  { label: 'BsaI forward, cut past the right end', enzymes: [enzyme('BsaI')], sequence: A(6) + 'GGTCTC' + 'AA', topology: 'linear', expect: { enzyme: 'BsaI', position: 6 } },
  { label: 'BsaI reverse, cut before base 0', enzymes: [enzyme('BsaI')], sequence: 'A' + 'GAGACC' + A(8), topology: 'linear', expect: { enzyme: 'BsaI', position: 1 } },
  { label: 'FokI reverse at position 0', enzymes: [FOKI], sequence: 'CATCC' + A(20), topology: 'linear', expect: { enzyme: 'FokI', position: 0 } },
  // Bottom cut at -1: a one-based save would write it as 0 and restore it as base 0.
  { label: 'BsaI reverse at position 0, cut at -1', enzymes: [enzyme('BsaI')], sequence: 'GAGACC' + A(10), topology: 'linear', expect: { enzyme: 'BsaI', position: 0 } },
  { label: 'BsaI forward, mirrored cut at -1', enzymes: [enzyme('BsaI')], sequence: A(10) + 'GGTCTC', topology: 'linear', expect: { enzyme: 'BsaI', position: 10 } },
  // Overlapping sites.
  { label: 'PvuI overlapping two TaqI sites', enzymes: [enzyme('TaqI'), enzyme('PvuI')], sequence: A(5) + 'TCGATCGA' + A(5), topology: 'linear', expect: { enzyme: 'PvuI', position: 6 } },
  { label: 'EcoRI overlapping MluCI', enzymes: [enzyme('EcoRI'), enzyme('MluCI')], sequence: A(5) + 'CGAATTCG' + A(5), topology: 'circular', expect: { enzyme: 'EcoRI', position: 6 } },
  { label: 'one window, both orientations, different cuts', enzymes: [BOTH_STRANDS], sequence: 'TTTT' + 'ACCC' + 'TTTT', topology: 'linear', expect: { enzyme: 'BothStrandsAmbiguous', position: 4 } },
  // Nicking enzymes, both orientations.
  { label: 'Nt.BstNBI forward', enzymes: [enzyme('Nt.BstNBI')], sequence: A(3) + 'GAGTC' + A(10), topology: 'linear', expect: { enzyme: 'Nt.BstNBI', position: 3 } },
  { label: 'Nt.BstNBI reverse', enzymes: [enzyme('Nt.BstNBI')], sequence: A(10) + 'GACTC' + A(3), topology: 'linear', expect: { enzyme: 'Nt.BstNBI', position: 10 } },
  { label: 'Nb.BbvCI forward', enzymes: [enzyme('Nb.BbvCI')], sequence: A(4) + 'CCTCAGC' + A(6), topology: 'linear', expect: { enzyme: 'Nb.BbvCI', position: 4 } },
  { label: 'Nt.BbvCI reverse, circular', enzymes: [enzyme('Nt.BbvCI')], sequence: A(6) + 'GCTGAGG' + A(4), topology: 'circular', expect: { enzyme: 'Nt.BbvCI', position: 6 } },
  // A methylation-conditional site keeps its status.
  { label: 'DpnI with unknown dam state', enzymes: [enzyme('DpnI')], sequence: A(6) + 'GATC' + A(6), topology: 'linear', expect: { enzyme: 'DpnI', position: 6 } },
];

describe('reverse-complement oracle: carried sites equal a fresh scan', () => {
  it.each(cases)('$label ($topology)', ({ enzymes, sequence, topology, expect: site }) => {
    const { forward, rescanned, mirrored } = mirrorAndRescan(sequence, enzymes, topology);
    expect(forward).toContainEqual(expect.objectContaining(site));
    expect(sorted(mirrored)).toEqual(sorted(rescanned));
    // And back again: mirroring twice returns the original sites.
    expect(sorted(reverseComplementRestrictionSites(mirrored, reverseComplement(sequence), topology))).toEqual(sorted(forward));
  });

  it.each(cases)('shows no extra site after the action: $label ($topology)', ({ enzymes, sequence, topology }) => {
    const { displayed, fresh } = displayedAfterAction(sequence, enzymes, topology);
    expect(sorted(displayed)).toEqual(sorted(fresh));
  });

  it.each<Topology>(['linear', 'circular'])('agrees for every catalog enzyme in both orientations (%s)', (topology) => {
    // One concrete copy of each recognition sequence and one of its reverse
    // complement, separated by spacer, so every catalog enzyme hits both ways.
    const concrete = (motif: string) => motif.replace(/[RYSWKMBDHVN]/g, (code) => ({ R: 'A', Y: 'C', S: 'G', W: 'T', K: 'G', M: 'C', B: 'G', D: 'A', H: 'T', V: 'C', N: 'T' })[code]!);
    const spacer = A(24);
    const sequence = spacer + RESTRICTION_ENZYMES_FULL.map((entry) => {
      const site = concrete(entry.recognitionSequence);
      return site + spacer + reverseComplement(site) + spacer;
    }).join('');
    const { forward, rescanned, mirrored } = mirrorAndRescan(sequence, RESTRICTION_ENZYMES_FULL, topology);
    expect(new Set(forward.map((site) => site.enzyme)).size).toBe(RESTRICTION_ENZYMES_FULL.length);
    expect(sorted(mirrored)).toEqual(sorted(rescanned));
    const { displayed, fresh } = displayedAfterAction(sequence, RESTRICTION_ENZYMES_FULL, topology);
    expect(sorted(displayed)).toEqual(sorted(fresh));
  });
});

describe('reverse-complement oracle: values worked by hand', () => {
  it('SfiI in a linear 30-base record', () => {
    // SfiI GGCCNNNN^NGGCC: L = 13, top cut 8, bottom cut 5 from the site start.
    // Forward site at 5: top 5 + 8 = 13, bottom 5 + 5 = 10.
    // After reverse-complementing 30 bases, base i -> 29 - i and bond c -> 30 - c:
    //   start = 30 - (5 + 13) = 12; top = 30 - bottom = 20; bottom = 30 - top = 17.
    // The site is palindromic, so it is reported on the forward strand; 3-base 3' overhang (20 - 17).
    const sequence = A(5) + 'GGCCACTGAGGCC' + A(12);
    expect(sequence).toHaveLength(30);
    const [site] = reverseComplementRestrictionSites(findRestrictionSites(sequence, [enzyme('SfiI')]), sequence, 'linear');
    expect(fields(site)).toEqual({
      enzyme: 'SfiI', position: 12, cutPosition: 20, recognitionSequence: 'GGCCNNNNNGGCC', overhang: '3prime', strand: 1,
      cleavageMode: 'double-strand', topCutPosition: 20, bottomCutPosition: 17, cleavageStatus: 'ok', overhangLength: 3,
    });
  });

  it('BsaI forward in a linear 26-base record moves to the reverse strand and cuts left of the site', () => {
    // BsaI GGTCTC(1/5): top cut 7, bottom cut 11 from the site start.
    // Forward site at 4 in 26 bases: top 11, bottom 15.
    // Mirror: start = 26 - (4 + 6) = 16; top = 26 - 15 = 11; bottom = 26 - 11 = 15.
    // Check against the reverse-strand formula: top = 16 + 6 - 11 = 11, bottom = 16 + 6 - 7 = 15.
    // The cuts sit left of the new site (11 and 15 < 16): 4-base 5' overhang.
    const sequence = A(4) + 'GGTCTC' + A(16);
    expect(sequence).toHaveLength(26);
    const [site] = reverseComplementRestrictionSites(findRestrictionSites(sequence, [enzyme('BsaI')]), sequence, 'linear');
    expect(fields(site)).toEqual({
      enzyme: 'BsaI', position: 16, cutPosition: 11, recognitionSequence: 'GGTCTC', overhang: '5prime', strand: -1,
      cleavageMode: 'double-strand', topCutPosition: 11, bottomCutPosition: 15, cleavageStatus: 'ok', overhangLength: 4,
    });
  });

  it('EcoRI across the origin of a circular 20-base record', () => {
    // EcoRI G^AATTC: top cut 1, bottom cut 5. Site at 18 covers bases 18, 19, 0, 1, 2, 3.
    // Forward: top (18 + 1) mod 20 = 19, bottom (18 + 5) mod 20 = 3.
    // Mirror: start = (20 - (18 + 6)) mod 20 = 16; top = 20 - 3 = 17; bottom = 20 - 19 = 1.
    // A fresh scan at 16: top 16 + 1 = 17, bottom (16 + 5) mod 20 = 1. 4-base 5' overhang across the origin.
    const sequence = 'ATTC' + A(14) + 'GA';
    expect(sequence).toHaveLength(20);
    const forward = findRestrictionSites(sequence, [enzyme('EcoRI')], { topology: 'circular' });
    expect(forward).toEqual([expect.objectContaining({ position: 18, topCutPosition: 19, bottomCutPosition: 3 })]);
    const [site] = reverseComplementRestrictionSites(forward, sequence, 'circular');
    expect(fields(site, sequence.length)).toEqual({
      enzyme: 'EcoRI', position: 16, cutPosition: 17, recognitionSequence: 'GAATTC', overhang: '5prime', strand: 1,
      cleavageMode: 'double-strand', topCutPosition: 17, bottomCutPosition: 1, cleavageStatus: 'ok', overhangLength: 4,
    });
  });

  it('Nt.BstNBI forward nick moves to the bottom strand', () => {
    // Nt.BstNBI nicks the GAGTC strand four bases past the site: offset 5 + 4 = 9.
    // Forward site at 3 in 18 bases: top-strand nick at 12, bottom strand intact.
    // Reverse-complementing turns the top strand into the bottom strand: nick at 18 - 12 = 6 on the bottom,
    // and the site (GACTC on the top strand) starts at 18 - (3 + 5) = 10, so the nick lies left of it.
    const sequence = A(3) + 'GAGTC' + A(10);
    const [site] = reverseComplementRestrictionSites(findRestrictionSites(sequence, [enzyme('Nt.BstNBI')]), sequence, 'linear');
    expect(fields(site)).toEqual({
      enzyme: 'Nt.BstNBI', position: 10, cutPosition: 6, recognitionSequence: 'GAGTC', overhang: 'blunt', strand: -1,
      cleavageMode: 'nick_bottom', topCutPosition: null, bottomCutPosition: 6, cleavageStatus: 'ok', overhangLength: null,
    });
  });
});

describe('reverse-complement oracle: sites saved without strand cuts', () => {
  // A connected tool or an older workspace can store a site as just a start and a
  // (top-strand) cut. Such a site shows once beside the scan; after the action
  // it must still show once, not as a second site on other bases.
  const legacy: Array<{ label: string; enzyme: string; sequence: string; topology: Topology; position: number; cut: number; strand?: 1 | -1 }> = [
    { label: 'EcoRI', enzyme: 'EcoRI', sequence: A(7) + 'GAATTC' + A(9), topology: 'linear', position: 7, cut: 8 },
    { label: 'PstI', enzyme: 'PstI', sequence: A(4) + 'CTGCAG' + A(11), topology: 'linear', position: 4, cut: 9 },
    { label: 'BsaI forward', enzyme: 'BsaI', sequence: A(4) + 'GGTCTC' + A(14), topology: 'linear', position: 4, cut: 11 },
    { label: 'BsaI reverse', enzyme: 'BsaI', sequence: A(14) + 'GAGACC' + A(4), topology: 'linear', position: 14, cut: 9, strand: -1 },
    { label: 'SfiI across the origin', enzyme: 'SfiI', sequence: rotate(A(9) + 'GGCCACTGAGGCC', 15), topology: 'circular', position: 16, cut: 2 },
  ];

  it.each(legacy)('$label ($topology)', ({ enzyme: name, sequence, topology, position, cut, strand }) => {
    const enzymes = [enzyme(name)];
    const record = normalizeRecord({
      molecule: 'dna', topology, seq: sequence,
      sites: [{ enzyme: name, indexBase: 0, hits: [{ position, cutPosition: cut, ...(strand ? { strand } : {}) }] }],
    }, 0)!;
    expect(record.sites[0].topCutPosition).toBeUndefined();
    expect(scanRestrictionSitesForRecord(record, enzymes).sites).toHaveLength(1);

    const child = normalizeRecord({
      molecule: 'dna', topology, seq: reverseComplement(sequence),
      sites: serializeSites(reverseComplementRestrictionSites(record.sites, record.sequence, topology)),
    }, 1)!;
    expect(child.sites[0].topCutPosition).toBeUndefined();
    expect(sorted(scanRestrictionSitesForRecord(child, enzymes).sites)).toEqual(sorted(findRestrictionSites(child.sequence, enzymes, { topology })));
  });
});
