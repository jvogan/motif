import { describe, expect, it } from 'vitest';
import {
  alignmentResiduesMatch,
  alignmentResiduesMatchUncached,
  classifyAlignmentResidues,
  classifyAlignmentResiduesUncached,
  type AlignmentMolecule,
} from '../alignment-semantics';

const MOLECULES: AlignmentMolecule[] = ['dna', 'rna', 'protein'];
const ASCII = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code));

describe('alignment residue pair cache', () => {
  for (const molecule of MOLECULES) {
    it(`matches the uncached residue comparison for every ASCII pair (${molecule})`, () => {
      // Two passes: the first fills the table, the second reads cached entries.
      for (let pass = 0; pass < 2; pass += 1) {
        const mismatches: string[] = [];
        for (const left of ASCII) {
          for (const right of ASCII) {
            const expectedMatch = alignmentResiduesMatchUncached(left, right, molecule);
            const expectedClass = classifyAlignmentResiduesUncached(left, right, molecule);
            if (alignmentResiduesMatch(left, right, molecule) !== expectedMatch
              || classifyAlignmentResidues(left, right, molecule) !== expectedClass) {
              mismatches.push(`${left.charCodeAt(0)}:${right.charCodeAt(0)}`);
            }
          }
        }
        expect(mismatches).toEqual([]);
      }
    });

    it(`treats lowercase and uppercase residues identically (${molecule})`, () => {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (const left of letters) {
        for (const right of letters) {
          const variants: Array<[string, string]> = [
            [left, right],
            [left.toLowerCase(), right],
            [left, right.toLowerCase()],
            [left.toLowerCase(), right.toLowerCase()],
          ];
          const expectedMatch = alignmentResiduesMatchUncached(left, right, molecule);
          const expectedClass = classifyAlignmentResiduesUncached(left, right, molecule);
          for (const [a, b] of variants) {
            expect(alignmentResiduesMatch(a, b, molecule)).toBe(alignmentResiduesMatchUncached(a, b, molecule));
            expect(classifyAlignmentResidues(a, b, molecule)).toBe(classifyAlignmentResiduesUncached(a, b, molecule));
            expect(alignmentResiduesMatch(a, b, molecule)).toBe(expectedMatch);
            expect(classifyAlignmentResidues(a, b, molecule)).toBe(expectedClass);
          }
        }
      }
    });

    it(`falls back to the uncached path for non-ASCII and multi-character input (${molecule})`, () => {
      const inputs = ['', 'AC', 'ac', 'Ä', 'é', 'ß', 'ı', 'ſ', 'K', 'Á', '\u{1F9EC}'];
      const partners = [...inputs, 'A', 'a', 'N', 'X', '-', 'T', 'U'];
      for (const left of inputs) {
        for (const right of partners) {
          for (const [a, b] of [[left, right], [right, left]]) {
            expect(alignmentResiduesMatch(a, b, molecule)).toBe(alignmentResiduesMatchUncached(a, b, molecule));
            expect(classifyAlignmentResidues(a, b, molecule)).toBe(classifyAlignmentResiduesUncached(a, b, molecule));
          }
        }
      }
    });
  }

  it('keeps the documented residue semantics', () => {
    expect(classifyAlignmentResidues('A', 'a', 'protein')).toBe('match');
    expect(classifyAlignmentResidues('X', 'X', 'protein')).toBe('ambiguous');
    expect(classifyAlignmentResidues('B', 'D', 'protein')).toBe('ambiguous');
    expect(classifyAlignmentResidues('A', 'C', 'protein')).toBe('substitution');
    expect(classifyAlignmentResidues('u', 'T', 'rna')).toBe('match');
    expect(classifyAlignmentResidues('N', 'n', 'dna')).toBe('ambiguous');
    expect(classifyAlignmentResidues('R', 'A', 'dna')).toBe('ambiguous');
    expect(alignmentResiduesMatch('-', 'A', 'dna')).toBe(false);
    expect(alignmentResiduesMatch('A', '-', 'protein')).toBe(false);
  });
});
