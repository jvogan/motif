import { describe, expect, it } from 'vitest';
import { inlineTrackResidues, nearestResidueIndex, residueSelectionRange } from '../motif-artifact';
import { normalizeSpan } from '../../plasmid-map/geometry/ranges';
import type { Topology } from '../../bio/types';

type Track = Parameters<typeof inlineTrackResidues>[2];
type Residue = ReturnType<typeof inlineTrackResidues>[number];

// Every expected number below is read from inlineTrackResidues output, never typed by hand.
const CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
const SEQUENCE = CHUNK.repeat(4).slice(0, 360);

function track(fields: Partial<Track> & Pick<Track, 'start' | 'end' | 'strand'>): Track {
  return { id: 'track', label: 'track', frame: 0, translationTableId: 1, source: 'layer', ...fields };
}

// The bases one codon covers, on the record (a codon across the origin wraps).
function codonBases(residue: Residue, length: number): number[] {
  return normalizeSpan(residue.start, residue.end, length, 'circular')
    .flatMap((span) => Array.from({ length: span.end - span.start }, (_, offset) => span.start + offset));
}

function rangeBases(range: { start: number; end: number }, length: number, topology: Topology): Set<number> {
  return new Set(normalizeSpan(range.start, range.end, length, topology)
    .flatMap((span) => Array.from({ length: span.end - span.start }, (_, offset) => span.start + offset)));
}

// The range must hold every base of every selected codon, start on the first one's lowest base and
// end on the last one's highest base (in reading order along the top strand).
function expectCovers(range: { start: number; end: number } | null, selected: Residue[], length: number, topology: Topology) {
  expect(range).not.toBeNull();
  const bases = rangeBases(range!, length, topology);
  for (const residue of selected) {
    for (const base of codonBases(residue, length)) expect(bases.has(base), `base ${base} of codon ${residue.start}`).toBe(true);
  }
  const all = selected.flatMap((residue) => codonBases(residue, length));
  expect(all).toContain(range!.start % length);
  expect(all).toContain((range!.end - 1) % length);
}

// The target the selection locks reads back as exactly the selected residues.
function retranslate(range: { start: number; end: number }, strand: 1 | -1, topology: Topology, sequence = SEQUENCE): string {
  return inlineTrackResidues(sequence, 'dna', track({ start: range.start, end: range.end, strand }), topology)
    .map((residue) => residue.aa).join('');
}

describe('residueSelectionRange', () => {
  it('runs from the first selected codon to the last on a forward track, in either drag direction', () => {
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 3, end: 150, strand: 1 }), 'linear');
    const range = residueSelectionRange(residues, 2, 8, 1, SEQUENCE.length, 'linear');
    expect(range).toEqual({ start: residues[2].start, end: residues[8].end });
    expect(residueSelectionRange(residues, 8, 2, 1, SEQUENCE.length, 'linear')).toEqual(range);
    expect(range!.end - range!.start).toBe(3 * 7);
    expectCovers(range, residues.slice(2, 9), SEQUENCE.length, 'linear');
    expect(retranslate(range!, 1, 'linear')).toBe(residues.slice(2, 9).map((residue) => residue.aa).join(''));
  });

  it('selects one codon for one residue', () => {
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 3, end: 150, strand: 1 }), 'linear');
    expect(residueSelectionRange(residues, 5, 5, 1, SEQUENCE.length, 'linear')).toEqual({ start: residues[5].start, end: residues[5].end });
  });

  it('starts on the last selected codon of a reverse-strand track, which is lowest on the top strand', () => {
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 170, end: 300, strand: -1 }), 'linear');
    expect(residues[0].start).toBeGreaterThan(residues[1].start);
    const range = residueSelectionRange(residues, 1, 5, -1, SEQUENCE.length, 'linear');
    expect(range).toEqual({ start: residues[5].start, end: residues[1].end });
    expect(residueSelectionRange(residues, 5, 1, -1, SEQUENCE.length, 'linear')).toEqual(range);
    expectCovers(range, residues.slice(1, 6), SEQUENCE.length, 'linear');
    expect(retranslate(range!, -1, 'linear')).toBe(residues.slice(1, 6).map((residue) => residue.aa).join(''));
  });

  it('crosses the origin of a circular record as one range that ends past its length', () => {
    const length = SEQUENCE.length;
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: length - 22, end: 20, strand: 1 }), 'circular');
    const across = residues.findIndex((residue) => residue.end > length);
    expect(across).toBeGreaterThan(0);
    const range = residueSelectionRange(residues, across - 2, across + 3, 1, length, 'circular');
    expect(range).toEqual({ start: residues[across - 2].start, end: residues[across + 3].end + length });
    expect(range!.end).toBeGreaterThan(length);
    expectCovers(range, residues.slice(across - 2, across + 4), length, 'circular');
    expect(rangeBases(range!, length, 'circular').size).toBe(3 * 6);
    expect(retranslate(range!, 1, 'circular')).toBe(residues.slice(across - 2, across + 4).map((residue) => residue.aa).join(''));

    // The codon split by the origin on its own, and a run that starts on it.
    expect(residueSelectionRange(residues, across, across, 1, length, 'circular')).toEqual({ start: residues[across].start, end: residues[across].end });
    const fromSplit = residueSelectionRange(residues, across, across + 2, 1, length, 'circular');
    expectCovers(fromSplit, residues.slice(across, across + 3), length, 'circular');
    expect(retranslate(fromSplit!, 1, 'circular')).toBe(residues.slice(across, across + 3).map((residue) => residue.aa).join(''));
  });

  it('crosses the origin on a reverse-strand track', () => {
    const length = SEQUENCE.length;
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: length - 20, end: 22, strand: -1 }), 'circular');
    const across = residues.findIndex((residue) => residue.end > length);
    expect(across).toBeGreaterThan(0);
    const range = residueSelectionRange(residues, across - 2, across + 2, -1, length, 'circular');
    expectCovers(range, residues.slice(across - 2, across + 3), length, 'circular');
    expect(rangeBases(range!, length, 'circular').size).toBe(3 * 5);
    expect(retranslate(range!, -1, 'circular')).toBe(residues.slice(across - 2, across + 3).map((residue) => residue.aa).join(''));
  });

  it('includes the intron of a joined CDS and keeps a codon split across the join whole', () => {
    // Exon 1 holds 13 bases, so codon 4 takes one base from it and two from exon 2.
    const joined = track({ start: 10, end: 60, strand: 1, segments: [{ start: 10, end: 23 }, { start: 40, end: 60 }] });
    const residues = inlineTrackResidues(SEQUENCE, 'dna', joined, 'linear');
    const spliced = SEQUENCE.slice(10, 23) + SEQUENCE.slice(40, 60);
    expect(residues).toHaveLength(spliced.length / 3);
    const split = residues.findIndex((residue) => residue.end - residue.start > 3);
    expect(codonBases(residues[split], SEQUENCE.length)).toEqual(expect.arrayContaining([22, 40, 41]));

    const range = residueSelectionRange(residues, split - 2, split + 2, 1, SEQUENCE.length, 'linear');
    expect(range).toEqual({ start: residues[split - 2].start, end: residues[split + 2].end });
    expectCovers(range, residues.slice(split - 2, split + 3), SEQUENCE.length, 'linear');
    // The intron's bases are inside the one contiguous range.
    for (let base = 23; base < 40; base += 1) expect(rangeBases(range!, SEQUENCE.length, 'linear').has(base)).toBe(true);
    expect(residueSelectionRange(residues, split, split, 1, SEQUENCE.length, 'linear')).toEqual({ start: residues[split].start, end: residues[split].end });
  });

  it('includes the intron of a reverse joined CDS, from its lowest selected base', () => {
    const joined = track({ start: 10, end: 60, strand: -1, segments: [{ start: 10, end: 30 }, { start: 47, end: 60 }] });
    const residues = inlineTrackResidues(SEQUENCE, 'dna', joined, 'linear');
    const split = residues.findIndex((residue) => residue.end - residue.start > 3);
    expect(split).toBeGreaterThan(0);
    const range = residueSelectionRange(residues, split - 1, split + 2, -1, SEQUENCE.length, 'linear');
    expect(range).toEqual({ start: residues[split + 2].start, end: residues[split - 1].end });
    expectCovers(range, residues.slice(split - 1, split + 3), SEQUENCE.length, 'linear');
    for (let base = 30; base < 47; base += 1) expect(rangeBases(range!, SEQUENCE.length, 'linear').has(base)).toBe(true);
  });

  it('covers a codon split across two lines with the bases on both lines', () => {
    // At 60 bases a line, frame 1 from base 1 starts a codon on base 58: two bases on the first line.
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 1, end: 120, strand: 1 }), 'linear');
    const split = residues.findIndex((residue) => residue.start < 60 && residue.end > 60);
    expect(split).toBeGreaterThan(0);
    const range = residueSelectionRange(residues, split, split + 1, 1, SEQUENCE.length, 'linear');
    expect(range).toEqual({ start: residues[split].start, end: residues[split + 1].end });
    expect(range!.start).toBeLessThan(60);
    expect(range!.end).toBeGreaterThan(60);
    expect(retranslate(range!, 1, 'linear')).toBe(residues[split].aa + residues[split + 1].aa);
  });

  it('returns nothing without residues or with an invalid index', () => {
    expect(residueSelectionRange([], 0, 0, 1, SEQUENCE.length, 'linear')).toBeNull();
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 3, end: 150, strand: 1 }), 'linear');
    expect(residueSelectionRange(residues, Number.NaN, 2, 1, SEQUENCE.length, 'linear')).toBeNull();
    // Indices past either end are held to the track.
    expect(residueSelectionRange(residues, -4, residues.length + 9, 1, SEQUENCE.length, 'linear'))
      .toEqual({ start: residues[0].start, end: residues[residues.length - 1].end });
  });
});

describe('nearestResidueIndex', () => {
  const residues = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 1, end: 150, strand: 1 }), 'linear');
  const split = residues.findIndex((residue) => residue.start < 60 && residue.end > 60);

  it('returns the residue drawn over the base under the pointer', () => {
    for (const offset of [0, 1, 2]) {
      expect(nearestResidueIndex(residues, residues[4].start + offset, 0, 60)).toBe(4);
    }
  });

  it('keeps to the line under the pointer: a codon split across lines is drawn on both lines', () => {
    expect(nearestResidueIndex(residues, residues[split].start + 1, 0, 60)).toBe(split);
    // On the second line its last base is drawn over too, and the next base is the next residue's.
    expect(nearestResidueIndex(residues, 60, 60, 120)).toBe(split);
    expect(nearestResidueIndex(residues, 61, 60, 120)).toBe(split + 1);
    // On a circle a codon over the origin is drawn on the first line as well.
    const ring = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 331, end: 31, strand: 1 }), 'circular');
    const origin = ring.findIndex((residue) => residue.start === 358);
    expect(nearestResidueIndex(ring, 0, 0, 60, SEQUENCE.length)).toBe(origin);
    expect(nearestResidueIndex(ring, 359, 300, 360, SEQUENCE.length)).toBe(origin);
    // Past the last residue drawn on a line, the pointer still means that line's last residue.
    expect(nearestResidueIndex(residues, 59, 0, 60)).toBe(split);
  });

  it('falls back to the nearest residue in reading position on a line the track does not reach', () => {
    expect(nearestResidueIndex(residues, 200, 180, 240)).toBe(residues.length - 1);
    expect(nearestResidueIndex(residues, 0, 0, 1)).toBe(0);
    expect(nearestResidueIndex([], 10, 0, 60)).toBeNull();
  });
});
