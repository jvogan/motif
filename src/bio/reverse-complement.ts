/**
 * Reverse complement for DNA and RNA sequences.
 * Supports full IUPAC ambiguity codes.
 */

import type { Feature } from './types';

const DNA_COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G',
  R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B',
  D: 'H', H: 'D', N: 'N',
  a: 't', t: 'a', g: 'c', c: 'g',
  r: 'y', y: 'r', s: 's', w: 'w',
  k: 'm', m: 'k', b: 'v', v: 'b',
  d: 'h', h: 'd', n: 'n',
};

const RNA_COMPLEMENT: Record<string, string> = {
  A: 'U', U: 'A', G: 'C', C: 'G',
  R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B',
  D: 'H', H: 'D', N: 'N',
  a: 'u', u: 'a', g: 'c', c: 'g',
  r: 'y', y: 'r', s: 's', w: 'w',
  k: 'm', m: 'k', b: 'v', v: 'b',
  d: 'h', h: 'd', n: 'n',
};

/** Get complement of a single base */
export function complementBase(base: string, isRna = false): string {
  const table = isRna ? RNA_COMPLEMENT : DNA_COMPLEMENT;
  return table[base] ?? base;
}

/** Get complement of a sequence (without reversing) */
export function complement(seq: string, isRna = false): string {
  const table = isRna ? RNA_COMPLEMENT : DNA_COMPLEMENT;
  const chars = new Array<string>(seq.length);
  for (let i = 0; i < seq.length; i++) {
    chars[i] = table[seq[i]] ?? seq[i];
  }
  return chars.join('');
}

/** Reverse a string */
export function reverseString(s: string): string {
  const chars = new Array<string>(s.length);
  for (let i = s.length - 1; i >= 0; i--) {
    chars[s.length - 1 - i] = s[i];
  }
  return chars.join('');
}

/** Reverse complement of a DNA or RNA sequence */
export function reverseComplement(seq: string, isRna = false): string {
  return reverseString(complement(seq, isRna));
}

/**
 * Transform features to match a reverse-complemented sequence.
 * Coordinates are mirrored and strands are flipped.
 */
export function reverseComplementFeatures(features: Feature[], seqLength: number): Feature[] {
  return features.map((f) => ({
    ...f,
    id: crypto.randomUUID(),
    start: seqLength - f.end,
    end: seqLength - f.start,
    // A directionless feature (strand 0) has no orientation to flip — keep it 0,
    // otherwise reverse-complementing would silently turn a block into a
    // forward-arrow feature.
    strand: (f.strand === 0 ? 0 : f.strand === 1 ? -1 : 1) as Feature['strand'],
    subRanges: f.subRanges?.map((r) => ({
      ...r,
      start: seqLength - r.end,
      end: seqLength - r.start,
      strand: r.strand != null ? r.strand * -1 : undefined,
    })),
  }));
}
