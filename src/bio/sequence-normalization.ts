import type { SequenceType } from './types';

const DNA_ALPHABET = /^[ACGTNRYSWKMBDHV]+$/u;
const RNA_ALPHABET = /^[ACGUNRYSWKMBDHV]+$/u;
const PROTEIN_ALPHABET = /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/u;
const FORMATTING_WHITESPACE = new Set([' ', '\t', '\r', '\n']);

export class InvalidSequenceCharacterError extends Error {
  readonly offset: number;
  readonly character: string;
  readonly path: string;

  constructor(path: string, offset: number, character: string) {
    super(
      `${path} contains invalid character ${JSON.stringify(character)} at offset ${offset}. `
      + 'Only residue characters and spaces, tabs, CR, or LF formatting whitespace are allowed.',
    );
    this.name = 'InvalidSequenceCharacterError';
    this.path = path;
    this.offset = offset;
    this.character = character;
  }
}

export class InvalidSequenceError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path} ${message}`);
    this.name = 'InvalidSequenceError';
    this.path = path;
  }
}

function looksLikeImplicitProteinSequence(rawSequence: string): boolean {
  const trimmed = rawSequence.trim();
  if (!trimmed || /[a-z]/u.test(trimmed)) return false;
  return !/[A-Z*][\t ]+[A-Z*]/u.test(trimmed);
}

function alphabetForHint(sequenceType: unknown): RegExp | null {
  if (sequenceType === 'dna') return DNA_ALPHABET;
  if (sequenceType === 'rna') return RNA_ALPHABET;
  if (sequenceType === 'protein') return PROTEIN_ALPHABET;
  return null;
}

function removeFormattingWhitespaceAndValidateCharacters(
  value: string,
  alphabet: RegExp | null,
  path: string,
): string {
  let normalized = '';
  let offset = 0;
  for (const character of value) {
    if (FORMATTING_WHITESPACE.has(character)) {
      offset += character.length;
      continue;
    }
    const upper = character.toUpperCase();
    if (upper.length !== 1 || (alphabet !== null && !alphabet.test(upper))) {
      throw new InvalidSequenceCharacterError(path, offset, character);
    }
    normalized += upper;
    offset += character.length;
  }
  return normalized;
}

/**
 * Normalize a direct/MCP sequence input without silently deleting data.
 * Only ASCII formatting whitespace is removed. Every other character is
 * validated before callers inspect feature coordinates, and invalid-character
 * errors retain the original string offset and character.
 */
export function normalizeSequenceStrict(
  value: unknown,
  sequenceType: unknown,
  path = 'sequence',
): string {
  if (typeof value !== 'string') throw new InvalidSequenceError(path, 'must be a sequence string.');

  const hintedAlphabet = alphabetForHint(sequenceType);
  const normalized = removeFormattingWhitespaceAndValidateCharacters(value, hintedAlphabet, path);
  if (!normalized) throw new InvalidSequenceError(path, 'must contain at least one valid residue.');

  const withoutStops = normalized.replace(/\*/gu, '');
  if (sequenceType === 'dna') {
    if (!DNA_ALPHABET.test(withoutStops)) throw new InvalidSequenceError(path, 'contains residues outside the DNA alphabet.');
    return withoutStops;
  }
  if (sequenceType === 'rna') {
    if (!RNA_ALPHABET.test(withoutStops)) throw new InvalidSequenceError(path, 'contains residues outside the RNA alphabet.');
    return withoutStops;
  }
  if (sequenceType === 'protein') {
    if (!PROTEIN_ALPHABET.test(normalized)) throw new InvalidSequenceError(path, 'contains residues outside the protein alphabet.');
    return normalized;
  }
  if (normalized.includes('*')) {
    if (!PROTEIN_ALPHABET.test(normalized)) throw new InvalidSequenceError(path, 'contains residues outside the protein alphabet.');
    return normalized;
  }
  if (DNA_ALPHABET.test(withoutStops)) return withoutStops;
  if (PROTEIN_ALPHABET.test(withoutStops) && looksLikeImplicitProteinSequence(value)) return withoutStops;
  throw new InvalidSequenceError(path, 'must contain a valid DNA, RNA, or sequence-like protein value.');
}

/** The sequence-type guard used by the artifact's legacy empty-string API. */
export function isSupportedSequenceType(value: unknown): value is SequenceType {
  return value === 'dna'
    || value === 'rna'
    || value === 'protein'
    || value === 'misc'
    || value === 'unknown'
    || value === 'mixed';
}
