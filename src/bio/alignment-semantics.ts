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

/**
 * Residue comparisons run once per cell pair in pairwise statistics, so
 * single ASCII-character pairs are memoized per molecule. Each table holds
 * 128 x 128 entries indexed by `(left << 7) | right`; -1 marks an entry that
 * has not been computed yet. Entries are always filled from the uncached
 * implementation, so cached and uncached results cannot diverge. Non-ASCII or
 * multi-character input bypasses the tables.
 */
const ASCII_PAIR_TABLE_SIZE = 128 * 128;

function emptyPairTables(): Record<AlignmentMolecule, Int8Array> {
  return {
    dna: new Int8Array(ASCII_PAIR_TABLE_SIZE).fill(-1),
    rna: new Int8Array(ASCII_PAIR_TABLE_SIZE).fill(-1),
    protein: new Int8Array(ASCII_PAIR_TABLE_SIZE).fill(-1),
  };
}

const RESIDUE_MATCH_TABLES = emptyPairTables();
const RESIDUE_CLASS_TABLES = emptyPairTables();
const RESIDUE_CLASSES: readonly AlignmentResidueDifference[] = ['match', 'ambiguous', 'substitution'];

/** Table index for a pair of single ASCII characters, or -1 when not cacheable. */
function asciiPairKey(left: string, right: string): number {
  if (left.length !== 1 || right.length !== 1) return -1;
  const leftCode = left.charCodeAt(0);
  const rightCode = right.charCodeAt(0);
  if (leftCode >= 128 || rightCode >= 128) return -1;
  return (leftCode << 7) | rightCode;
}

/** Uncached reference implementation of {@link alignmentResiduesMatch}. */
export function alignmentResiduesMatchUncached(
  left: string,
  right: string,
  molecule: AlignmentMolecule,
): boolean {
  if (left === '-' || right === '-') return false;
  const leftSet = residueSet(left, molecule);
  const rightSet = residueSet(right, molecule);
  return Array.from(leftSet).some((residue) => rightSet.includes(residue));
}

/** Compatibility identity for one pair of non-gap residues. */
export function alignmentResiduesMatch(
  left: string,
  right: string,
  molecule: AlignmentMolecule,
): boolean {
  const key = asciiPairKey(left, right);
  const table = RESIDUE_MATCH_TABLES[molecule];
  if (key < 0 || !table) return alignmentResiduesMatchUncached(left, right, molecule);
  let cached = table[key];
  if (cached < 0) {
    cached = alignmentResiduesMatchUncached(left, right, molecule) ? 1 : 0;
    table[key] = cached;
  }
  return cached === 1;
}

/** Uncached reference implementation of {@link classifyAlignmentResidues}. */
export function classifyAlignmentResiduesUncached(
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
  if (!alignmentResiduesMatchUncached(normalizedLeft, normalizedRight, molecule)) return 'substitution';
  return 'ambiguous';
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
  const key = asciiPairKey(left, right);
  const table = RESIDUE_CLASS_TABLES[molecule];
  if (key < 0 || !table) return classifyAlignmentResiduesUncached(left, right, molecule);
  let cached = table[key];
  if (cached < 0) {
    cached = RESIDUE_CLASSES.indexOf(classifyAlignmentResiduesUncached(left, right, molecule));
    table[key] = cached;
  }
  return RESIDUE_CLASSES[cached];
}

/** Convert the broad SequenceType used by artifacts to the strict alignment type. */
export function alignmentMolecule(value: SequenceType | AlignmentMolecule): AlignmentMolecule | null {
  return value === 'dna' || value === 'rna' || value === 'protein' ? value : null;
}
