import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { reverseComplement } from '../reverse-complement';
import { RESTRICTION_ENZYMES, findRestrictionSites } from '../restriction-sites';

function enzyme(name: string) {
  const match = RESTRICTION_ENZYMES.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing restriction enzyme fixture: ${name}`);
  return match;
}

const iupacBases: Record<string, readonly string[]> = {
  A: ['A'], C: ['C'], G: ['G'], T: ['T'],
  R: ['A', 'G'], Y: ['C', 'T'], S: ['G', 'C'], W: ['A', 'T'],
  K: ['G', 'T'], M: ['A', 'C'], B: ['C', 'G', 'T'], D: ['A', 'G', 'T'],
  H: ['A', 'C', 'T'], V: ['A', 'C', 'G'], N: ['A', 'C', 'G', 'T'],
};

function materializeRecognitionSequence(recognitionSequence: string): string {
  return [...recognitionSequence.toUpperCase()]
    .map((base) => iupacBases[base]?.[0] ?? base)
    .join('');
}

function reverseOnlyRecognitionExample(recognitionSequence: string): string | null {
  const forward = recognitionSequence.toUpperCase();
  const reverse = reverseComplement(forward);
  if (reverse === forward) return null;
  const sequence = [...reverse].map((base) => iupacBases[base]?.[0] ?? base);
  for (let index = 0; index < reverse.length; index++) {
    const forwardChoices = new Set(iupacBases[forward[index]] ?? [forward[index]]);
    const reverseOnlyBase = (iupacBases[reverse[index]] ?? [reverse[index]])
      .find((base) => !forwardChoices.has(base));
    if (reverseOnlyBase) {
      sequence[index] = reverseOnlyBase;
      return sequence.join('');
    }
  }
  return null;
}

describe('restriction-site scanning', () => {
  it('anchors every catalog recognition sequence and sense-strand cut at its actual match', () => {
    for (const candidate of RESTRICTION_ENZYMES_FULL) {
      const sequence = materializeRecognitionSequence(candidate.recognitionSequence);
      const sites = findRestrictionSites(sequence, [candidate]);

      expect(sites, candidate.name).toContainEqual({
        enzyme: candidate.name,
        position: 0,
        cutPosition: candidate.cutOffset,
        recognitionSequence: candidate.recognitionSequence,
        overhang: candidate.overhang,
        strand: 1,
      });
    }
  });

  it('anchors every non-palindromic catalog entry on the reverse strand with its mirrored cut', () => {
    let checked = 0;
    for (const candidate of RESTRICTION_ENZYMES_FULL) {
      const sequence = reverseOnlyRecognitionExample(candidate.recognitionSequence);
      if (!sequence) continue;
      checked += 1;
      const sites = findRestrictionSites(sequence, [candidate]);

      expect(sites, candidate.name).toContainEqual({
        enzyme: candidate.name,
        position: 0,
        cutPosition: candidate.recognitionSequence.length - candidate.complementCutOffset,
        recognitionSequence: candidate.recognitionSequence,
        overhang: candidate.overhang,
        strand: -1,
      });
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('reports a non-palindromic reverse-strand Type IIS site with its mirrored cut', () => {
    const sites = findRestrictionSites('AAAAAAGAGACCTTTTT', [enzyme('BsaI')]);

    expect(sites).toEqual([{
      enzyme: 'BsaI',
      position: 6,
      cutPosition: 1,
      recognitionSequence: 'GGTCTC',
      overhang: '5prime',
      strand: -1,
    }]);
  });

  it('finds and wraps a palindromic site that crosses a circular origin once', () => {
    const sequence = 'AATTCCCCCG';
    const ecoRI = enzyme('EcoRI');

    expect(findRestrictionSites(sequence, [ecoRI])).toEqual([]);
    expect(findRestrictionSites(sequence, [ecoRI], { topology: 'circular' })).toEqual([{
      enzyme: 'EcoRI',
      position: 9,
      cutPosition: 0,
      recognitionSequence: 'GAATTC',
      overhang: '5prime',
      strand: 1,
    }]);
  });
});
