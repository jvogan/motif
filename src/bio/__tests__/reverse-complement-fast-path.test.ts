import { describe, expect, it } from 'vitest';
import { complement, reverseComplement } from '../reverse-complement';

// Reference implementation: per-character string maps, identity for anything
// outside the map.
const DNA: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
  a: 't', t: 'a', g: 'c', c: 'g', r: 'y', y: 'r', s: 's', w: 'w',
  k: 'm', m: 'k', b: 'v', v: 'b', d: 'h', h: 'd', n: 'n',
};
const RNA: Record<string, string> = Object.fromEntries([
  ...Object.entries(DNA).filter(([base]) => base !== 'T' && base !== 't'),
  ['U', 'A'],
  ['u', 'a'],
].map(([base, mate]) => [base, mate === 'T' ? 'U' : mate === 't' ? 'u' : mate]));

function referenceComplement(seq: string, isRna: boolean): string {
  const table = isRna ? RNA : DNA;
  return Array.from({ length: seq.length }, (_, i) => table[seq[i]] ?? seq[i]).join('');
}

function referenceReverseComplement(seq: string, isRna: boolean): string {
  const comp = referenceComplement(seq, isRna);
  const out: string[] = [];
  for (let i = comp.length - 1; i >= 0; i--) out.push(comp[i]);
  return out.join('');
}

const allAscii = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('');
const iupac = 'ACGTURYSWKMBDHVN';
const samples: Array<[string, string]> = [
  ['empty', ''],
  ['every ASCII character', allAscii],
  ['IUPAC upper', iupac],
  ['IUPAC lower', iupac.toLowerCase()],
  ['mixed case', 'AcGtUrYsWkMbDhVn'],
  ['with whitespace and digits', 'ACGT 123\nacgt\t'],
  ['non-ASCII', 'ACGTé☃acgt\u{1F9EC}N'],
  ['non-ASCII only', 'éè'],
];

describe('complement and reverseComplement ASCII fast path', () => {
  for (const isRna of [false, true]) {
    for (const [label, seq] of samples) {
      it(`${label} (${isRna ? 'RNA' : 'DNA'}) matches the string-map reference`, () => {
        expect(complement(seq, isRna)).toBe(referenceComplement(seq, isRna));
        expect(reverseComplement(seq, isRna)).toBe(referenceReverseComplement(seq, isRna));
      });
    }
  }

  it('maps every ASCII character individually like the reference', () => {
    for (let code = 0; code < 128; code += 1) {
      const ch = String.fromCharCode(code);
      expect(complement(ch, false)).toBe(referenceComplement(ch, false));
      expect(complement(ch, true)).toBe(referenceComplement(ch, true));
      expect(reverseComplement(ch, false)).toBe(referenceComplement(ch, false));
    }
  });

  it('keeps ASCII behavior for a long sequence', () => {
    const seq = 'ACGTNRYacgtnry'.repeat(5000);
    expect(reverseComplement(seq)).toBe(referenceReverseComplement(seq, false));
    expect(reverseComplement(seq, true)).toBe(referenceReverseComplement(seq, true));
  });

  it('is an involution on IUPAC input', () => {
    expect(reverseComplement(reverseComplement(iupac + iupac.toLowerCase()))).toBe(iupac + iupac.toLowerCase());
  });
});
