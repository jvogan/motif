import { describe, expect, it, vi } from 'vitest';

const residueComparisons = vi.hoisted(() => ({ count: 0 }));

vi.mock('../alignment-semantics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../alignment-semantics')>();
  return {
    ...actual,
    alignmentResiduesMatch: (...args: Parameters<typeof actual.alignmentResiduesMatch>) => {
      residueComparisons.count += 1;
      return actual.alignmentResiduesMatch(...args);
    },
  };
});

const { sequenceDiff } = await import('../sequence-diff');

function pseudoRandomDna(length: number): string {
  let state = 17;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    sequence += 'ACGT'[state % 4];
  }
  return sequence;
}

describe('pairwise comparison work', () => {
  it('scores each pair of residue letters once rather than once per matrix cell', () => {
    // 400 x 400 is 160,000 cells; four letters against five give 20 pairs.
    // Comparing IUPAC sets in every cell took three plasmids 2.5 s on the page's
    // main thread.
    const reference = pseudoRandomDna(400);
    const substituted = reference[50] === 'A' ? 'C' : 'A';
    const variant = `${reference.slice(0, 50)}${substituted}${reference.slice(51, 120)}N${reference.slice(121, 200)}${reference.slice(203)}`;
    residueComparisons.count = 0;
    const result = sequenceDiff(reference, variant, { molecule: 'dna' });
    expect(result.method).toBe('needleman-wunsch');
    expect(result.mismatches).toBe(1);
    expect(result.deletions).toBe(3);
    expect(result.ambiguousMatches).toBe(1);
    expect(residueComparisons.count).toBeGreaterThan(0);
    expect(residueComparisons.count).toBeLessThanOrEqual(20);
  });
});
