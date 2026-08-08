/**
 * Small, shared nucleotide primitives for sequence-sensitive workflows.
 *
 * Formatting whitespace is the only disposable input. Gaps, punctuation, and
 * other characters are retained in the inspection result and are never
 * deleted to make a sequence appear contiguous.
 */

export const IUPAC_DNA_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  A: ['A'],
  C: ['C'],
  G: ['G'],
  T: ['T'],
  U: ['T'],
  R: ['A', 'G'],
  Y: ['C', 'T'],
  S: ['G', 'C'],
  W: ['A', 'T'],
  K: ['G', 'T'],
  M: ['A', 'C'],
  B: ['C', 'G', 'T'],
  D: ['A', 'G', 'T'],
  H: ['A', 'C', 'T'],
  V: ['A', 'C', 'G'],
  N: ['A', 'C', 'G', 'T'],
};

export const IUPAC_DNA_ALPHABET = /^[ACGTURYSWKMBDHVN]*$/;
export const CANONICAL_DNA_ALPHABET = /^[ACGT]*$/;

export type NucleotideInspection = Readonly<{
  sequence: string;
  invalidCharacters: readonly string[];
  ambiguous: boolean;
}>;

/** Normalize case/RNA U and remove only formatting whitespace. */
export function inspectNucleotideSequence(value: string): NucleotideInspection {
  const withoutFormattingWhitespace = value.replace(/\s+/g, '');
  const sequence = withoutFormattingWhitespace.toUpperCase().replace(/U/g, 'T');
  const invalid = new Set<string>();
  let ambiguous = false;
  for (const character of sequence) {
    const expansion = IUPAC_DNA_EXPANSIONS[character];
    if (!expansion) invalid.add(character);
    else if (expansion.length > 1) ambiguous = true;
  }
  return {
    sequence,
    invalidCharacters: [...invalid],
    ambiguous,
  };
}

/** Normalize a nucleotide sequence or fail without deleting sequence data. */
export function normalizeNucleotideSequence(value: string): string {
  const inspected = inspectNucleotideSequence(value);
  if (inspected.invalidCharacters.length > 0) {
    throw new Error(`Invalid nucleotide character${inspected.invalidCharacters.length === 1 ? '' : 's'}: ${inspected.invalidCharacters.join(', ')}`);
  }
  return inspected.sequence;
}

export function isCanonicalDna(value: string): boolean {
  return CANONICAL_DNA_ALPHABET.test(value);
}

export function isValidIupacDna(value: string): boolean {
  return IUPAC_DNA_ALPHABET.test(value);
}

/** Whether two IUPAC symbols have at least one possible matching base. */
export function nucleotideSymbolsCanPair(left: string, right: string): boolean {
  const leftBases = IUPAC_DNA_EXPANSIONS[left.toUpperCase()];
  const rightBases = IUPAC_DNA_EXPANSIONS[right.toUpperCase()];
  if (!leftBases || !rightBases) return false;
  return leftBases.some((base) => rightBases.includes(base));
}
