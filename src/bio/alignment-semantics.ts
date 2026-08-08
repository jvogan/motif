import type { SequenceType } from './types';

/** The molecule types for which the alignment model has defined residue semantics. */
export type AlignmentMolecule = 'dna' | 'rna' | 'protein';

export type AlignmentResidueDifference = 'match' | 'ambiguous' | 'substitution';

/**
 * A validation error used by alignment callers.  Keeping the offset and field
 * here prevents import/browser routes from turning malformed input into a
 * shorter, apparently contiguous sequence.
 */
export class AlignmentSequenceError extends Error {
  readonly offset: number;
  readonly character: string;
  readonly field: string;

  constructor(field: string, offset: number, character: string, message: string) {
    super(`${field} contains ${message} ${JSON.stringify(character)} at offset ${offset}.`);
    this.name = 'AlignmentSequenceError';
    this.field = field;
    this.offset = offset;
    this.character = character;
  }
}

const DNA_SYMBOLS = 'ACGTRYSWKMBDHVN?';
const RNA_SYMBOLS = 'ACGURYSWKMBDHVN?';
const PROTEIN_SYMBOLS = 'ACDEFGHIKLMNPQRSTVWYOUJBXZ*?';

const IUPAC_NUCLEOTIDES: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
  '?': 'ACGT',
};

const IUPAC_PROTEINS: Record<string, string> = {
  B: 'DN', Z: 'EQ', J: 'IL', X: 'ACDEFGHIKLMNPQRSTVWY',
  '?': 'ACDEFGHIKLMNPQRSTVWY',
};

export function alignmentSymbols(molecule: AlignmentMolecule): string {
  if (molecule === 'dna') return DNA_SYMBOLS;
  if (molecule === 'rna') return RNA_SYMBOLS;
  return PROTEIN_SYMBOLS;
}

/** Validate a normalized, optionally gapped alignment sequence. */
export function isValidAlignmentSequence(
  sequence: string,
  molecule: AlignmentMolecule,
  options: { gapped?: boolean } = {},
): boolean {
  const gap = options.gapped === false ? '' : '-';
  const symbols = new Set(`${alignmentSymbols(molecule)}${gap}`);
  return Array.from(sequence).every((symbol) => symbols.has(symbol));
}

/**
 * Normalize only formatting whitespace and alignment dot notation. All other
 * punctuation is rejected, so coordinate-bearing callers cannot silently
 * delete a symbol and then report false contiguity.
 */
export function normalizeAlignmentSequence(
  value: unknown,
  molecule: AlignmentMolecule,
  options: { gapped?: boolean; field?: string } = {},
): string {
  const field = options.field ?? 'sequence';
  if (typeof value !== 'string') {
    throw new AlignmentSequenceError(field, 0, String(value), 'an invalid value');
  }
  let normalized = '';
  let offset = 0;
  for (const character of value) {
    if (character === ' ' || character === '\t' || character === '\r' || character === '\n') {
      offset += character.length;
      continue;
    }
    if (options.gapped !== false && character === '.') {
      normalized += '-';
      offset += character.length;
      continue;
    }
    const symbol = character.toUpperCase();
    const allowed = alignmentSymbols(molecule).includes(symbol)
      || (options.gapped !== false && symbol === '-');
    if (!allowed) {
      throw new AlignmentSequenceError(field, offset, character, 'an invalid alignment symbol');
    }
    normalized += symbol;
    offset += character.length;
  }
  return normalized;
}

function residueSet(symbol: string, molecule: AlignmentMolecule): string {
  const upper = symbol.toUpperCase();
  if (molecule === 'protein') return IUPAC_PROTEINS[upper] ?? upper;
  return IUPAC_NUCLEOTIDES[upper] ?? (upper === 'U' ? 'T' : upper);
}

/** Compatibility identity for one pair of non-gap residues. */
export function alignmentResiduesMatch(
  left: string,
  right: string,
  molecule: AlignmentMolecule,
): boolean {
  if (left === '-' || right === '-') return false;
  const leftSet = residueSet(left, molecule);
  const rightSet = residueSet(right, molecule);
  return Array.from(leftSet).some((residue) => rightSet.includes(residue));
}

/**
 * Distinguish literal identity, compatible ambiguity, and a hard
 * substitution. X/B/Z/J and nucleotide IUPAC symbols are intentionally
 * compatible but not presented as literal matches.
 */
export function classifyAlignmentResidues(
  left: string,
  right: string,
  molecule: AlignmentMolecule,
): AlignmentResidueDifference {
  const normalizedLeft = molecule === 'protein'
    ? left.toUpperCase()
    : (left.toUpperCase() === 'U' ? 'T' : left.toUpperCase());
  const normalizedRight = molecule === 'protein'
    ? right.toUpperCase()
    : (right.toUpperCase() === 'U' ? 'T' : right.toUpperCase());
  const wildcard = molecule === 'protein' ? 'X?' : 'N?';
  if (normalizedLeft === normalizedRight && !wildcard.includes(normalizedLeft)) return 'match';
  if (!alignmentResiduesMatch(normalizedLeft, normalizedRight, molecule)) return 'substitution';
  return 'ambiguous';
}

/** Convert the broad SequenceType used by artifacts to the strict alignment type. */
export function alignmentMolecule(value: SequenceType | AlignmentMolecule): AlignmentMolecule | null {
  return value === 'dna' || value === 'rna' || value === 'protein' ? value : null;
}
