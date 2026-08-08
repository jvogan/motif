import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { restrictionDigestDetailed } from '../restriction-digest';
import { analyzeOverlap, gibsonAssemble } from '../gibson-assembly';
import { buildSyntheticGoldenGateVector, getGoldenGatePartBoundary, goldenGateAssemble } from '../golden-gate';
import { applyDeletion, applyInsertion, applySubstitution } from '../mutate';
import { VALID_NCBI_TABLE_IDS, getTranslationTable } from '../codon-tables';
import { IUPAC_BASE_EXPANSIONS, translate } from '../translate';
import type { Feature } from '../types';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function dna(random: () => number, length: number): string {
  const alphabet = 'ACGT';
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}

function feature(name: string, start: number, end: number): Feature {
  return { id: `${name}-id`, name, type: 'misc_feature', start, end, strand: 1, color: '#888888', metadata: {} };
}

function expectBounded(result: { sequence: string; features: Feature[] }): void {
  for (const candidate of result.features) {
    expect(candidate.start).toBeGreaterThanOrEqual(0);
    expect(candidate.end).toBeLessThanOrEqual(result.sequence.length);
    for (const range of candidate.subRanges ?? []) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(result.sequence.length);
      expect(range.end).toBeGreaterThan(range.start);
    }
  }
}

describe('seeded release-confidence invariants', () => {
  it('conserves every base through randomized physical digest fragments', () => {
    const random = seeded(0x51_7e_2026);
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const source = `${dna(random, 24 + Math.floor(random() * 24))}GAATTC${dna(random, 24)}`;
      const result = restrictionDigestDetailed(source, ['EcoRI']);
      expect(result.issues, `digest iteration ${iteration}`).toEqual([]);
      expect(result.fragments.reduce((sum, fragment) => sum + fragment.length, 0)).toBe(source.length);
      expect(result.fragments.map((fragment) => fragment.sequence).join('')).toBe(source);
      expect(result.fragments.every((fragment) => fragment.length === fragment.sequence.length)).toBe(true);
    }
  });

  it('keeps nickase continuity and never emits a false double-strand fragment cut', () => {
    const random = seeded(0x6e_1c_2026);
    for (const enzyme of RESTRICTION_ENZYMES_FULL.filter((candidate) => candidate.cleavageMode?.startsWith('nick_'))) {
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const source = `${dna(random, 12)}${enzyme.recognitionSequence}${dna(random, 16)}`;
        const result = restrictionDigestDetailed(source, [enzyme.name]);
        expect(result.issues, enzyme.name).toEqual([]);
        expect(result.cuts, enzyme.name).toEqual([]);
        expect(result.fragments).toHaveLength(1);
        expect(result.fragments[0]?.sequence).toBe(source);
      }
    }
  });

  it('keeps Gibson alternatives explicit and circular seam features bounded', () => {
    const random = seeded(0x91_6b_2026);
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const overlap = dna(random, 15);
      const closing = dna(random, 15);
      const left = `${closing}AAAA${overlap}`;
      const right = `${overlap}CCCC${closing}`;
      const search = analyzeOverlap(left, right, overlap.length, overlap.length);
      expect(search).toMatchObject({ reason: 'exact', unique: true, ambiguous: false });
      expect(search.selected?.sequence).toBe(overlap);
      const result = gibsonAssemble([
        { name: 'left', sequence: left, features: [feature('left', 0, left.length)] },
        { name: 'right', sequence: right, features: [feature('right', 0, right.length)] },
      ], overlap.length, overlap.length, 'circular');
      expect(result.success).toBe(true);
      expectBounded(result);
      expect(result.overlapSearches).toHaveLength(2);
      expect(result.overlapSearches?.every((entry) => entry.selected !== null)).toBe(true);
    }
    const ambiguous = analyzeOverlap(`TTTT${'A'.repeat(14)}N`, `${'N'}${'A'.repeat(14)}GGGG`, 15, 15);
    expect(ambiguous).toMatchObject({ reason: 'ambiguous_symbols', selected: null, ambiguous: true });
  });

  it('keeps Golden Gate ordering and seam feature bounds deterministic', () => {
    const random = seeded(0x44_aa_2026);
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const fillerA = `${'AACCGGTT'.repeat(1 + Math.floor(random() * 2))}`;
      const fillerB = `${'TTCCAAGG'.repeat(1 + Math.floor(random() * 2))}`;
      const partA = buildSyntheticGoldenGateVector('ATGC', 'GCTA', { name: `A-${iteration}`, filler: fillerA });
      const partB = buildSyntheticGoldenGateVector('GCTA', 'ATGC', { name: `B-${iteration}`, filler: fillerB });
      const boundaryA = getGoldenGatePartBoundary(partA);
      const boundaryB = getGoldenGatePartBoundary(partB);
      expect(boundaryA.valid).toBe(true);
      expect(boundaryB.valid).toBe(true);
      const result = goldenGateAssemble([
        { ...partA, features: [feature('A', boundaryA.insertStart!, boundaryA.insertEnd!)] },
        { ...partB, features: [feature('B', boundaryB.insertStart!, boundaryB.insertEnd!)] },
      ]);
      expect(result.success).toBe(true);
      expect(result.topology).toBe('circular');
      expectBounded(result);
    }
  });

  it('preserves translation/IUPAC length invariants across every shipped table', () => {
    const random = seeded(0x70_aa_2026);
    const symbols = Object.keys(IUPAC_BASE_EXPANSIONS);
    for (const id of VALID_NCBI_TABLE_IDS) {
      const table = getTranslationTable(id);
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const sequence = Array.from({ length: 18 }, () => symbols[Math.floor(random() * symbols.length)]).join('');
        expect(translate(sequence, 0, table)).toHaveLength(6);
      }
    }
    expect(() => translate('ATG-NNN', 0, getTranslationTable(1))).toThrow(/Invalid nucleotide character/u);
  });

  it('keeps edit coordinate invariants under seeded substitutions, insertions, and deletions', () => {
    const random = seeded(0x3d_ee_2026);
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const source = dna(random, 48);
      const pos = Math.floor(random() * source.length);
      const substituted = applySubstitution(source, [], [feature('whole', 0, source.length)], pos, 'A');
      expect(substituted.raw).toHaveLength(source.length);
      expect(substituted.features[0]).toMatchObject({ start: 0, end: source.length });
      const inserted = applyInsertion(source, [], [feature('whole', 0, source.length)], pos, 'AC');
      expect(inserted.raw).toHaveLength(source.length + 2);
      expect(inserted.features.every((candidate) => candidate.start >= 0 && candidate.end <= inserted.raw.length)).toBe(true);
      const deleted = applyDeletion(source, [], [feature('whole', 0, source.length)], pos, 2);
      expect(deleted.raw).toHaveLength(source.length - 2);
      expect(deleted.features.every((candidate) => candidate.start >= 0 && candidate.end <= deleted.raw.length)).toBe(true);
    }
  });
});
