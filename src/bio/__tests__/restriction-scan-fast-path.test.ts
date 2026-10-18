import { describe, expect, it } from 'vitest';
import { normalizeRestrictionSequence, scanRestrictionSites } from '../restriction-sites';
import { reverseComplement } from '../reverse-complement';
import type { RestrictionEnzyme } from '../types';

const BASES: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'GC', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};

/** Straightforward reference: concrete sequence bases only, every window. */
function referenceStarts(seq: string, recognition: string, circular: boolean): number[] {
  const buffer = circular ? seq + seq.slice(0, recognition.length - 1) : seq;
  const starts: number[] = [];
  for (let i = 0; i + recognition.length <= buffer.length; i += 1) {
    if (circular && i >= seq.length) break;
    let ok = true;
    for (let k = 0; k < recognition.length && ok; k += 1) {
      ok = 'ACGT'.includes(buffer[i + k]) && BASES[recognition[k]].includes(buffer[i + k]);
    }
    if (ok) starts.push(i);
  }
  return starts;
}

const enzymes: RestrictionEnzyme[] = [
  { name: 'EcoRI', recognitionSequence: 'GAATTC', cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BsoBI', recognitionSequence: 'CYCGRG', cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BstYI', recognitionSequence: 'RGATCY', cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'XcmI', recognitionSequence: 'CCANNNNNNNNNTGG', cutOffset: 8, complementCutOffset: 7, overhang: '3prime' },
  { name: 'AsymConcrete', recognitionSequence: 'GGATG', cutOffset: 10, complementCutOffset: 14, overhang: '5prime' },
  { name: 'Homopolymer', recognitionSequence: 'AAAA', cutOffset: 2, complementCutOffset: 2, overhang: 'blunt' },
];

function makeSequence(length: number, alphabet: string, seed: number): string {
  let state = seed;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

describe('restriction scan matching', () => {
  for (const topology of ['linear', 'circular'] as const) {
    for (const [label, alphabet] of [
      ['plain ACGT', 'ACGT'],
      ['with IUPAC ambiguity', 'ACGTACGTACGTRYNK'],
      ['homopolymer rich', 'AAAAAAC'],
    ] as const) {
      it(`${topology} ${label}: sites equal the reference matcher on both strands`, () => {
        for (const length of [30, 211, 1500]) {
          const seq = makeSequence(length, alphabet, length + alphabet.length);
          const result = scanRestrictionSites(seq, enzymes, { topology });
          for (const enzyme of enzymes) {
            const recognition = enzyme.recognitionSequence;
            const reverse = reverseComplement(recognition);
            const forward = referenceStarts(seq, recognition, topology === 'circular');
            const expected = new Set(forward.map((p) => `${p}:1`));
            if (reverse !== recognition) {
              for (const p of referenceStarts(seq, reverse, topology === 'circular')) expected.add(`${p}:-1`);
            }
            const actualPositions = new Set(
              result.sites.filter((site) => site.enzyme === enzyme.name).map((site) => site.position),
            );
            const expectedPositions = new Set([...expected].map((entry) => Number(entry.split(':')[0])));
            expect(actualPositions).toEqual(expectedPositions);
          }
        }
      });
    }
  }

  it('finds overlapping concrete occurrences', () => {
    const result = scanRestrictionSites('AAAAAAA', [enzymes[5]], { topology: 'linear' });
    expect(result.sites.map((site) => site.position)).toEqual([0, 1, 2, 3]);
  });

  it('finds a concrete site that spans the circular origin and nothing past it', () => {
    const result = scanRestrictionSites('ATTCCCCCGA', [enzymes[0]], { topology: 'circular' });
    expect(result.sites.map((site) => site.position)).toEqual([8]);
    expect(scanRestrictionSites('ATTCCCCCGA', [enzymes[0]], { topology: 'linear' }).sites).toEqual([]);
  });
});

describe('normalizeRestrictionSequence fast path', () => {
  it('returns plain ACGT unchanged and upper-cases lowercase input', () => {
    expect(normalizeRestrictionSequence('')).toBe('');
    expect(normalizeRestrictionSequence('ACGT')).toBe('ACGT');
    expect(normalizeRestrictionSequence('acgtacgt')).toBe('ACGTACGT');
  });

  it('still handles RNA, whitespace, numbering, ambiguity, and invalid symbols', () => {
    expect(normalizeRestrictionSequence('acgu')).toBe('ACGT');
    expect(normalizeRestrictionSequence('AC GT\n12 n')).toBe('ACGTN');
    expect(() => normalizeRestrictionSequence('ACGX')).toThrow(/unsupported symbol/);
  });
});
