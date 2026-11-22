import { describe, expect, it } from 'vitest';
import {
  cleanFindQuery,
  findCountLabel,
  findSequenceMatches,
  findPositionPreview,
  firstMatchAtOrAfter,
  parseFindPosition,
  stepFindMatch,
  type FindMatch,
} from '../claude-science-find';

// Sequences are built from repeated characters; the filler is all A, so each planted site has a known position.
const [A, C, G, T] = ['A', 'C', 'G', 'T'];
const ECORI = G + A + A + T + T + C; // reads the same on both strands
const BSAI = G + G + T + C + T + C; // its reverse complement is GAGACC
const BSAI_BOTTOM = G + A + G + A + C + C;
const filler = (length: number) => A.repeat(length);

const starts = (matches: readonly FindMatch[]) => matches.map((match) => match.start);
const strands = (matches: readonly FindMatch[]) => matches.map((match) => match.strand);

// An independent brute-force matcher: every start, both strands, IUPAC as sets.
const SETS: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};
const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N' };
function bruteForce(sequence: string, query: string, circular: boolean) {
  const reverse = [...query].reverse().map((code) => COMPLEMENT[code]).join('');
  const fits = (target: string, start: number) => [...target].every((code, offset) => {
    const index = start + offset;
    if (!circular && index >= sequence.length) return false;
    return [...SETS[sequence[index % sequence.length]]].every((base) => SETS[code].includes(base));
  });
  const out: FindMatch[] = [];
  if (query.length > sequence.length) return out;
  const last = circular ? sequence.length - 1 : sequence.length - query.length;
  for (let start = 0; start <= last; start += 1) {
    const forward = fits(query, start);
    if (forward || fits(reverse, start)) out.push({ start, end: start + query.length, strand: forward ? 1 : -1 });
  }
  return out;
}

describe('find matching', () => {
  it('matches overlapping lowercase IUPAC queries by hand on both strands', () => {
    const sequence = 'aArtTa';
    const linear = findSequenceMatches(sequence, 'ar', 'dna');
    expect(linear.matches).toEqual([
      { start: 0, end: 2, strand: 1 },
      { start: 1, end: 3, strand: 1 },
      { start: 3, end: 5, strand: -1 },
    ]);
    expect(findCountLabel(linear, null)).toBe('3 matches');
    const circular = findSequenceMatches(sequence, 'ar', 'dna', 'circular');
    expect(circular.matches).toEqual([...linear.matches, { start: 5, end: 7, strand: 1 }]);
    expect(findCountLabel(circular, null)).toBe('4 matches');
    expect(findCountLabel(findSequenceMatches(sequence, 'nnnnnnn', 'dna', 'circular'), null)).toBe('No matches');
  });

  it('finds a site that is only on the bottom strand and marks it reverse', () => {
    const sequence = filler(20) + BSAI_BOTTOM + filler(20);
    const result = findSequenceMatches(sequence, BSAI, 'dna');
    expect(result.matches).toEqual([{ start: 20, end: 26, strand: -1 }]);
  });

  it('counts a palindromic site once, on the forward strand', () => {
    const result = findSequenceMatches(filler(10) + ECORI + filler(10), ECORI, 'dna');
    expect(result.matches).toEqual([{ start: 10, end: 16, strand: 1 }]);
  });

  it('keeps overlapping, reverse-strand, and circular hits in coordinate order', () => {
    const sequence = A.repeat(3) + T.repeat(3) + A;
    const query = A.repeat(2);
    expect(starts(findSequenceMatches(sequence, query, 'dna').matches)).toEqual([0, 1, 3, 4]);
    expect(strands(findSequenceMatches(sequence, query, 'dna').matches)).toEqual([1, 1, -1, -1]);
    expect(starts(findSequenceMatches(sequence, query, 'dna', 'circular').matches)).toEqual([0, 1, 3, 4, 6]);
    expect(starts(findSequenceMatches(sequence, query, 'protein', 'circular').matches)).toEqual([0, 1]);
    expect(findSequenceMatches(sequence, query.repeat(4), 'dna', 'circular').matches).toEqual([]);
  });

  it('matches across the origin of a circular record, on either strand', () => {
    const forward = ECORI.slice(2) + filler(30) + ECORI.slice(0, 2);
    expect(findSequenceMatches(forward, ECORI, 'dna', 'circular').matches).toEqual([{ start: 34, end: 40, strand: 1 }]);
    expect(findSequenceMatches(forward, ECORI, 'dna', 'linear').matches).toEqual([]);
    const reverse = BSAI_BOTTOM.slice(4) + filler(30) + BSAI_BOTTOM.slice(0, 4);
    expect(findSequenceMatches(reverse, BSAI, 'dna', 'circular').matches).toEqual([{ start: 32, end: 38, strand: -1 }]);
  });

  it('expands ambiguity codes in the query but does not let an N in the record stand for a base', () => {
    const hinf = G + A + 'N' + T + C;
    const sequence = filler(5) + G + A + C + T + C + filler(5) + hinf + filler(5);
    expect(starts(findSequenceMatches(sequence, hinf, 'dna').matches)).toEqual([5, 15]);
    expect(starts(findSequenceMatches(sequence, G + A + A + T + C, 'dna').matches)).toEqual([]);
    const ry = G + 'R' + C + G + 'Y' + C;
    expect(starts(findSequenceMatches(filler(4) + G + A + C + G + T + C + filler(4), ry, 'dna').matches)).toEqual([4]);
  });

  it('ignores case, spaces, digits, and line breaks, and treats U and T as the same base', () => {
    const sequence = filler(8) + BSAI_BOTTOM + filler(8);
    const pasted = `  1 ${BSAI_BOTTOM.slice(0, 3).toLowerCase()} ${BSAI_BOTTOM.slice(3).toLowerCase()}\n`;
    expect(findSequenceMatches(sequence, pasted, 'dna').matches).toEqual([{ start: 8, end: 14, strand: 1 }]);
    const withU = ECORI.replace(/T/g, 'U');
    expect(starts(findSequenceMatches(filler(3) + ECORI, withU, 'dna').matches)).toEqual([3]);
    expect(starts(findSequenceMatches(filler(3) + withU, ECORI, 'rna').matches)).toEqual([3]);
  });

  it('reports a character that is not a residue instead of dropping it', () => {
    const result = findSequenceMatches(filler(3) + ECORI, `${G}A-ATTC`, 'dna');
    expect(result.status).toBe('invalid');
    expect(result.invalidCharacter).toBe('-');
    expect(result.matches).toEqual([]);
    expect(cleanFindQuery('ga x', 'dna')).toEqual({ query: 'GAX', invalidCharacter: 'X' });
  });

  it('searches residues only on a protein, with X for any residue and no strands', () => {
    const protein = 'MK' + 'H'.repeat(6) + 'LE';
    const result = findSequenceMatches(protein, 'hhh', 'protein');
    expect(result.bothStrands).toBe(false);
    expect(starts(result.matches)).toEqual([2, 3, 4, 5]);
    expect(strands(result.matches)).toEqual([1, 1, 1, 1]);
    expect(starts(findSequenceMatches(protein, 'HXH', 'protein').matches)).toEqual([2, 3, 4, 5]);
  });

  it('caps the list and says the count is a floor', () => {
    const result = findSequenceMatches(A.repeat(50), A, 'dna', 'linear', 10);
    expect(result.matches).toHaveLength(10);
    expect(result.capped).toBe(true);
    expect(findCountLabel(result, 2)).toBe('3 of 10+');
    expect(findCountLabel(result, null)).toBe('10+ matches');
  });

  it('agrees with a brute-force matcher on random records and ambiguous queries', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = (alphabet: string, length: number) => Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    for (let round = 0; round < 200; round += 1) {
      const sequence = pick('ACGT', 40 + Math.floor(random() * 60)) + (round % 5 === 0 ? 'N' : '');
      const query = pick(round % 2 ? 'ACGT' : 'ACGTRYN', 1 + Math.floor(random() * 4));
      const circular = round % 3 === 0;
      expect(findSequenceMatches(sequence, query, 'dna', circular ? 'circular' : 'linear').matches)
        .toEqual(bruteForce(sequence, query, circular));
    }
  });

  it('labels the count for every state', () => {
    expect(findCountLabel(findSequenceMatches(ECORI, '', 'dna'), null)).toBe('Both strands');
    expect(findCountLabel(findSequenceMatches('MKH', '', 'protein'), null)).toBe('Type residues');
    expect(findCountLabel(findSequenceMatches(ECORI, 'GA?', 'dna'), null)).toBe('Not a base: ?');
    expect(findCountLabel(findSequenceMatches(filler(9), C, 'dna'), null)).toBe('No matches');
    expect(findCountLabel(findSequenceMatches(filler(3) + ECORI, ECORI, 'dna'), null)).toBe('1 match');
    expect(findCountLabel(findSequenceMatches(A.repeat(1200), A, 'dna'), 999)).toBe('1,000 of 1,200');
  });
});

describe('stepping through matches', () => {
  const matches: FindMatch[] = [10, 20, 30].map((start) => ({ start, end: start + 3, strand: 1 }));

  it('starts from where the search began and wraps at either end', () => {
    expect(firstMatchAtOrAfter(matches, 21)).toBe(2);
    expect(firstMatchAtOrAfter(matches, 31)).toBe(-1);
    expect(stepFindMatch(matches, null, 15, 1)).toEqual({ index: 1, wrapped: false });
    expect(stepFindMatch(matches, null, 15, -1)).toEqual({ index: 0, wrapped: false });
    expect(stepFindMatch(matches, null, 40, 1)).toEqual({ index: 0, wrapped: true });
    expect(stepFindMatch(matches, 20, 0, 1)).toEqual({ index: 2, wrapped: false });
    expect(stepFindMatch(matches, 30, 0, 1)).toEqual({ index: 0, wrapped: true });
    expect(stepFindMatch(matches, 20, 0, -1)).toEqual({ index: 0, wrapped: false });
    expect(stepFindMatch(matches, 10, 0, -1)).toEqual({ index: 2, wrapped: true });
    expect(stepFindMatch([], null, 0, 1)).toBeNull();
  });
});

describe('parseFindPosition', () => {
  it('reads a base or a range in the forms people type', () => {
    expect(parseFindPosition('1500')).toEqual({ first: 1500, last: 1500 });
    expect(parseFindPosition(' 1,500 ')).toEqual({ first: 1500, last: 1500 });
    expect(parseFindPosition('1500..1600')).toEqual({ first: 1500, last: 1600 });
    expect(parseFindPosition('1,500 - 1,600')).toEqual({ first: 1500, last: 1600 });
    expect(parseFindPosition('1500–1600')).toEqual({ first: 1500, last: 1600 });
    expect(parseFindPosition('1600..1500')).toEqual({ first: 1500, last: 1600, reversed: true });
  });

  it('leaves residues and malformed numbers to the sequence search', () => {
    expect(parseFindPosition('')).toBeNull();
    expect(parseFindPosition('GAATTC')).toBeNull();
    expect(parseFindPosition('15a')).toBeNull();
    expect(parseFindPosition('1,50')).toBeNull();
    expect(parseFindPosition('1500..')).toBeNull();
    expect(parseFindPosition('1500..1600..1700')).toBeNull();
  });
});

describe('findPositionPreview', () => {
  const preview = (query: string, length: number, circular: boolean) => findPositionPreview(parseFindPosition(query)!, length, circular);

  it('shows a range typed backwards on a linear record in the order Enter selects it', () => {
    // "1600..1500" previews "1,500–1,600", the range Enter selects, not "1,600–1,500".
    expect(preview('1600..1500', 3000, false)).toEqual({ label: '1,500–1,600', detail: 'Typed backwards' });
    expect(preview('1500..1600', 3000, false)).toEqual({ label: '1,500–1,600', detail: 'Enter selects it' });
  });

  it('keeps the typed order on a circular record, where a backwards range runs across the origin', () => {
    expect(preview('2680..10', 2686, true)).toEqual({ label: '2,680–10', detail: 'Enter selects it' });
    expect(preview('10..2680', 2686, true)).toEqual({ label: '10–2,680', detail: 'Enter selects it' });
  });

  it('names a base, base 0 and a position past the end before Enter', () => {
    expect(preview('1500', 3000, false)).toEqual({ label: 'Base 1,500', detail: 'Enter goes there' });
    expect(preview('0..5', 3000, true)).toEqual({ label: 'No base 0', detail: 'Bases start at 1' });
    expect(preview('5000..10', 3000, false)).toEqual({ label: 'Past the end', detail: 'Last base is 3,000' });
  });
});
