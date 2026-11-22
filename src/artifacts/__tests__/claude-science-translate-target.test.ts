import { describe, expect, it } from 'vitest';
import { featureTrackSegments, inlineTrackResidues, piecesInRange, residuesByLine, residueTouchesRanges, trackFrameForRange } from '../motif-artifact';
import type { Feature } from '../../bio/types';
import type { Topology } from '../../bio/types';

type Track = Parameters<typeof inlineTrackResidues>[2];

const CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
const SEQUENCE = CHUNK.repeat(4).slice(0, 360);

function track(fields: Partial<Track> & Pick<Track, 'start' | 'end' | 'strand'>): Track {
  return { id: 'track', label: 'track', frame: 0, translationTableId: 1, source: 'feature', ...fields };
}

// The codons of `outer` that lie wholly inside start..end, as "start-end:aa", in reading order.
function codonsInside(outer: Track, start: number, end: number, topology: Topology): string[] {
  const length = SEQUENCE.length;
  return inlineTrackResidues(SEQUENCE, 'dna', outer, topology)
    .filter((residue) => ((residue.start - start) % length + length) % length + residue.end - residue.start <= end - start)
    .map((residue) => `${residue.start}-${residue.end}:${residue.aa}`);
}

// A range read alone in the frame trackFrameForRange gives must draw exactly the codons the
// enclosing track draws inside it. Every expectation is read from inlineTrackResidues.
function expectSameCodons(outer: Track, start: number, end: number, topology: Topology) {
  const frame = trackFrameForRange(outer, start, end, SEQUENCE.length, topology);
  expect(frame, `range ${start}-${end}`).not.toBeNull();
  const alone = inlineTrackResidues(SEQUENCE, 'dna', track({ start, end, strand: outer.strand, frame: frame! }), topology)
    .map((residue) => `${residue.start}-${residue.end}:${residue.aa}`);
  const inside = codonsInside(outer, start, end, topology);
  expect(inside.length, `range ${start}-${end} holds codons`).toBeGreaterThan(0);
  expect(alone, `range ${start}-${end}`).toEqual(inside);
}

describe('trackFrameForRange', () => {
  for (const strand of [1, -1] as const) {
    for (const frame of [0, 1, 2] as const) {
      it(`reads a range inside a ${strand === 1 ? 'forward' : 'reverse'} track in frame +${frame + 1} as the track draws it`, () => {
        const outer = track({ start: 20, end: 290, strand, frame });
        for (const [start, end] of [[20, 290], [21, 40], [22, 41], [100, 160], [150, 151 + 6], [271, 290], [20, 26]]) {
          expectSameCodons(outer, start, end, 'linear');
        }
      });
    }
  }

  it('gives no frame for a range that leaves the track or holds no base of it', () => {
    const outer = track({ start: 20, end: 290, strand: 1 });
    expect(trackFrameForRange(outer, 10, 40, SEQUENCE.length, 'linear')).toBeNull();
    expect(trackFrameForRange(outer, 280, 300, SEQUENCE.length, 'linear')).toBeNull();
    expect(trackFrameForRange(outer, 300, 320, SEQUENCE.length, 'linear')).toBeNull();
    expect(trackFrameForRange(outer, 40, 40, SEQUENCE.length, 'linear')).toBeNull();
  });

  for (const strand of [1, -1] as const) {
    it(`follows a ${strand === 1 ? 'forward' : 'reverse'} track across the origin of a circular record`, () => {
      // The track runs from 330 over the origin to 40.
      const outer = track({ start: 330, end: SEQUENCE.length + 40, strand, frame: 1 });
      for (const [start, end] of [[331, 350], [340, SEQUENCE.length + 12], [SEQUENCE.length - 5, SEQUENCE.length + 30], [3, 33]]) {
        expectSameCodons(outer, start, end, 'circular');
      }
      expect(trackFrameForRange(outer, 300, 340, SEQUENCE.length, 'circular')).toBeNull();
    });
  }

  for (const strand of [1, -1] as const) {
    it(`reads inside one segment of a joined ${strand === 1 ? 'forward' : 'reverse'} track and refuses a range over the join gap`, () => {
      const outer = track({ start: 30, end: 200, strand, segments: [{ start: 30, end: 91 }, { start: 130, end: 200 }] });
      for (const [start, end] of [[31, 60], [32, 91], [130, 170], [140, 200]]) {
        expectSameCodons(outer, start, end, 'linear');
      }
      expect(trackFrameForRange(outer, 80, 140, SEQUENCE.length, 'linear')).toBeNull();
      expect(trackFrameForRange(outer, 95, 120, SEQUENCE.length, 'linear')).toBeNull();
    });
  }
});

describe('residueTouchesRanges', () => {
  it('counts a codon with any base in a range, and none with no base in it', () => {
    const codon = { start: 30, end: 33 };
    expect(residueTouchesRanges(codon, [{ start: 32, end: 40 }], 360)).toBe(true);
    expect(residueTouchesRanges(codon, [{ start: 20, end: 31 }], 360)).toBe(true);
    expect(residueTouchesRanges(codon, [{ start: 33, end: 40 }], 360)).toBe(false);
    expect(residueTouchesRanges(codon, [{ start: 20, end: 30 }], 360)).toBe(false);
    expect(residueTouchesRanges(codon, [{ start: 0, end: 10 }, { start: 31, end: 32 }], 360)).toBe(true);
  });

  it('counts a codon across the origin from either side of it', () => {
    const codon = { start: 359, end: 362 };
    expect(residueTouchesRanges(codon, [{ start: 0, end: 1 }], 360)).toBe(true);
    expect(residueTouchesRanges(codon, [{ start: 355, end: 360 }], 360)).toBe(true);
    expect(residueTouchesRanges(codon, [{ start: 2, end: 10 }], 360)).toBe(false);
  });
});

describe('joined tracks', () => {
  const joinedFeature = (strand: 1 | -1): Feature => ({
    id: 'j', name: 'j', type: 'cds', start: 30, end: 200, strand, color: '#000000', metadata: {},
    subRanges: strand === 1
      ? [{ start: 30, end: 91, strand }, { start: 130, end: 200, strand }]
      : [{ start: 130, end: 200, strand }, { start: 30, end: 91, strand }],
  });

  it('reads a joined feature in top-strand order on either strand', () => {
    expect(featureTrackSegments(joinedFeature(1))).toEqual([{ start: 30, end: 91 }, { start: 130, end: 200 }]);
    expect(featureTrackSegments(joinedFeature(-1))).toEqual([{ start: 30, end: 91 }, { start: 130, end: 200 }]);
    expect(featureTrackSegments({ ...joinedFeature(1), subRanges: undefined })).toBeUndefined();
  });

  for (const strand of [1, -1] as const) {
    it(`splits the codon across the gap into its parts and draws its letter over its middle base (${strand === 1 ? 'forward' : 'reverse'})`, () => {
      const outer = track({ start: 30, end: 200, strand, segments: featureTrackSegments(joinedFeature(strand)) });
      const residues = inlineTrackResidues(SEQUENCE, 'dna', outer, 'linear');
      // 61 + 70 bases: one codon has bases on both sides of the gap. Forward it
      // reads 91 | 131-132, reverse 132 | 91-90 (top strand 90-91 | 131).
      const split = residues.filter((residue) => residue.parts);
      expect(split).toHaveLength(1);
      expect(split[0].parts).toEqual(strand === 1
        ? [{ start: 90, end: 91 }, { start: 130, end: 132 }]
        : [{ start: 89, end: 91 }, { start: 130, end: 131 }]);
      expect({ start: split[0].start, end: split[0].end }).toEqual(strand === 1 ? { start: 90, end: 132 } : { start: 89, end: 131 });
      const byLine = residuesByLine(residues, 60, SEQUENCE.length);
      // The letter goes over the two-base part, which holds the middle base on either strand.
      const pieces = [...byLine.entries()]
        .flatMap(([lineStart, line]) => line.map((piece) => ({ ...piece, column: lineStart + piece.left })))
        .filter((piece) => piece.index === residues.indexOf(split[0]))
        .map((piece) => ({ column: piece.column, span: piece.span, letter: !piece.continuation }))
        .sort((a, b) => a.column - b.column);
      expect(pieces).toEqual(strand === 1
        ? [{ column: 90, span: 1, letter: false }, { column: 130, span: 2, letter: true }]
        : [{ column: 89, span: 2, letter: true }, { column: 130, span: 1, letter: false }]);
      // Bases inside the gap touch no residue of the track; a base of either part touches the split one.
      expect(residues.some((residue) => residueTouchesRanges(residue, [{ start: 100, end: 120 }], SEQUENCE.length))).toBe(false);
      for (const part of split[0].parts!) {
        expect(residueTouchesRanges(split[0], [{ start: part.start, end: part.start + 1 }], SEQUENCE.length)).toBe(true);
      }
    });
  }

  for (const strand of [1, -1] as const) {
    it(`splits a codon whose join gap crosses the origin, and leaves a join that only wraps the origin unsplit (${strand === 1 ? 'forward' : 'reverse'})`, () => {
      // join(301..350, 11..41) on a 360 bp circle: codon 17 is bases 349-350 before the gap and 11 after it.
      const gapped = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 300, end: 41, strand, segments: [{ start: 300, end: 350 }, { start: 10, end: 41 }] }), 'circular');
      expect(gapped).toHaveLength(27);
      const split = gapped.filter((residue) => residue.parts);
      expect(split).toHaveLength(1);
      expect(split[0].parts).toEqual([{ start: 348, end: 350 }, { start: 10, end: 11 }]);
      // Its bases run from the first part across the origin to the last.
      expect({ start: split[0].start, end: split[0].end }).toEqual({ start: 348, end: 371 });
      expect(residueTouchesRanges(split[0], [{ start: 200, end: 348 }], SEQUENCE.length)).toBe(false);
      expect(residueTouchesRanges(split[0], [{ start: 0, end: 11 }], SEQUENCE.length)).toBe(true);
      // join(332..360, 1..31): the codon over the origin is one unbroken run of three bases.
      const wrapped = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 331, end: 31, strand, segments: [{ start: 331, end: 360 }, { start: 0, end: 31 }] }), 'circular');
      const plain = inlineTrackResidues(SEQUENCE, 'dna', track({ start: 331, end: 31, strand }), 'circular');
      expect(wrapped).toEqual(plain);
      expect(wrapped.find((residue) => residue.start === 358)).toMatchObject({ start: 358, end: 361 });
      expect(wrapped.some((residue) => residue.parts)).toBe(false);
    });
  }

  it('keeps the pieces of a range that lie in it, and none when the range is one piece', () => {
    const pieces = [{ start: 30, end: 91 }, { start: 130, end: 200 }];
    expect(piecesInRange(pieces, 88, 135, SEQUENCE.length, 'linear')).toEqual([{ start: 88, end: 91 }, { start: 130, end: 135 }]);
    expect(piecesInRange(pieces, 40, 60, SEQUENCE.length, 'linear')).toBeUndefined();
  });
});


describe('a codon across a line end', () => {
  // Every residue's pieces as "line:column+span" (letter piece marked L, sorted), and
  // whether any piece passes the end of its line.
  function drawn(outer: Track, topology: Topology, basesPerLine = 60) {
    const residues = inlineTrackResidues(SEQUENCE, 'dna', outer, topology);
    const byLine = residuesByLine(residues, basesPerLine, SEQUENCE.length);
    const pieces = new Map<number, string[]>();
    let pastLineEnd = 0;
    let letters = 0;
    for (const [lineStart, line] of byLine) {
      const lineLength = Math.min(basesPerLine, SEQUENCE.length - lineStart);
      for (const piece of line) {
        if (piece.left + piece.span > lineLength) pastLineEnd += 1;
        if (!piece.continuation) letters += 1;
        pieces.set(piece.index, [...(pieces.get(piece.index) ?? []), `${lineStart}:${piece.left}+${piece.span}${piece.continuation ? '' : 'L'}`]);
      }
    }
    for (const list of pieces.values()) list.sort();
    return { residues, pieces, pastLineEnd, letters };
  }

  for (const strand of [1, -1] as const) {
    it(`draws each piece on its own line, the letter over the middle base (${strand === 1 ? 'forward' : 'reverse'})`, () => {
      // Codon 59-61 (1-based) has its middle base on the first line; codon 60-62 on the second.
      for (const [start, codonStart, expected] of [[1, 58, ['0:58+2L', '60:0+1']], [2, 59, ['0:59+1', '60:0+2L']]] as const) {
        const { residues, pieces, pastLineEnd, letters } = drawn(track({ start, end: start + 150, strand }), 'linear');
        expect(pastLineEnd).toBe(0);
        expect(letters).toBe(residues.length);
        const index = residues.findIndex((residue) => residue.start === codonStart);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(pieces.get(index)).toEqual(expected);
      }
    });

    it(`draws a codon over the origin on the last line and the first (${strand === 1 ? 'forward' : 'reverse'})`, () => {
      // 1-based 359-360 and 1: the letter on the last line, which holds the middle base.
      const { residues, pieces, pastLineEnd } = drawn(track({ start: 331, end: 31, strand }), 'circular');
      expect(pastLineEnd).toBe(0);
      expect(pieces.get(residues.findIndex((residue) => residue.start === 358))).toEqual(['0:0+1', '300:58+2L']);
    });
  }

  it('cuts at the end of a short last line', () => {
    // 360 bases in lines of 100: the last line is 60 long, and codon 359-361 of a circle crosses the origin there.
    const { residues, pieces, pastLineEnd } = drawn(track({ start: 340, end: 20, strand: 1 }), 'circular', 100);
    expect(pastLineEnd).toBe(0);
    expect(pieces.get(residues.findIndex((residue) => residue.start === 358))).toEqual(['0:0+1', '300:58+2L']);
  });
});
