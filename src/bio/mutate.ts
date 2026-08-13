// ===== Pure Mutation Functions =====
// All functions are pure — no side effects, no store access.
// Each returns a new MutationResult with updated raw, scars, and features.

import type { Feature } from './types';
import type { MutationScar } from './types';
import { FeatureCollectionInputError, validateFeatureCollection } from './feature-bounds';

export interface MutationResult {
  raw: string;
  scars: MutationScar[];
  features: Feature[];
}

/** Shared bounds for the browser-facing nucleotide insertion primitive. */
export const MAX_MUTATION_INSERTION_LENGTH = 250_000;
export const MAX_MUTATION_RESULT_LENGTH = 250_000;
export const MAX_MUTATION_OPERATION_UNITS = 1_000_000;
export type MutationMolecule = 'dna' | 'rna' | 'protein';
const VALID_DNA_INSERTION = /^[ACGTRYSWKMBDHVN]+$/iu;
const VALID_RNA_INSERTION = /^[ACGURYSWKMBDHVN]+$/iu;
const VALID_PROTEIN_INSERTION = /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/iu;
const VALID_DNA_SUBSTITUTION = /^[ACGTRYSWKMBDHVN]$/iu;
const VALID_RNA_SUBSTITUTION = /^[ACGURYSWKMBDHVN]$/iu;
const VALID_PROTEIN_SUBSTITUTION = /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]$/iu;

export interface SequenceEditCapacity {
  ok: boolean;
  currentLength: number;
  nextLength: number | null;
  message?: string;
}

/**
 * Check the resulting sequence length before constructing a length-changing
 * mutation. UI entry points use this shared preflight so an expected record
 * limit is reported as an ordinary notice instead of escaping from a pure
 * mutator call.
 */
export function preflightSequenceEdit(
  currentLength: number,
  edit: { deletedLength: number; insertedLength: number },
  maxLength = MAX_MUTATION_RESULT_LENGTH,
): SequenceEditCapacity {
  if (
    !Number.isSafeInteger(currentLength)
    || currentLength < 0
    || !Number.isSafeInteger(edit.deletedLength)
    || edit.deletedLength < 0
    || !Number.isSafeInteger(edit.insertedLength)
    || edit.insertedLength < 0
    || !Number.isSafeInteger(maxLength)
    || maxLength < 0
  ) {
    return {
      ok: false,
      currentLength,
      nextLength: null,
      message: 'The edit could not be checked because its lengths were not safe integers.',
    };
  }
  const effectiveDeletedLength = Math.min(currentLength, edit.deletedLength);
  const nextLength = currentLength - effectiveDeletedLength + edit.insertedLength;
  if (nextLength > maxLength) {
    return {
      ok: false,
      currentLength,
      nextLength,
      message: `This edit would exceed the ${maxLength.toLocaleString()}-residue record limit. Delete bases or split the record before inserting more.`,
    };
  }
  return { ok: true, currentLength, nextLength };
}

// ---------------------------------------------------------------------------
// Helpers (not exported)
// ---------------------------------------------------------------------------

function requireSafeInteger(value: number, label: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function mutationOperationUnits(
  affectedLength: number,
  scars: readonly MutationScar[],
  features: readonly Feature[],
): number {
  let units = affectedLength;
  const add = (amount: number): void => {
    if (!Number.isSafeInteger(amount) || amount < 0 || units > MAX_MUTATION_OPERATION_UNITS - amount) {
      throw new RangeError(`Mutation exceeds the ${MAX_MUTATION_OPERATION_UNITS.toLocaleString()}-unit mutation operation budget.`);
    }
    units += amount;
  };
  add(scars.length);
  add(features.length);
  for (const feature of features) add(feature.subRanges?.length ?? 0);
  if (units > MAX_MUTATION_OPERATION_UNITS) {
    throw new RangeError(`Mutation exceeds the ${MAX_MUTATION_OPERATION_UNITS.toLocaleString()}-unit mutation operation budget.`);
  }
  return units;
}

function validateMutationFeatures(
  features: unknown,
  sequenceLength: number,
  allowCircularWrap = false,
): void {
  const validation = validateFeatureCollection(features, {
    label: 'Mutation features',
    sequenceLength,
    allowCircularWrap,
  });
  if (!validation.valid) throw new FeatureCollectionInputError(validation);
}

function featureExtrema(ranges: readonly { start: number; end: number }[]): { start: number; end: number } | null {
  if (ranges.length === 0) return null;
  let start = ranges[0].start;
  let end = ranges[0].end;
  for (let index = 1; index < ranges.length; index += 1) {
    start = Math.min(start, ranges[index].start);
    end = Math.max(end, ranges[index].end);
  }
  return { start, end };
}

/**
 * Shift all scar positions by `delta` where the scar position is > editPos.
 * Returns a new array (does not mutate input).
 */
function shiftScars(
  scars: MutationScar[],
  editPos: number,
  delta: number,
): MutationScar[] {
  return scars.map((s) =>
    s.position > editPos
      ? { ...s, position: s.position + delta }
      : { ...s },
  );
}

/**
 * Shift feature start/end and subRanges by `delta` where the coordinate is > editPos.
 * Returns a new array (does not mutate input).
 */
function shiftFeatures(
  features: Feature[],
  editPos: number,
  delta: number,
): Feature[] {
  const insertIndex = editPos + 1;
  return features.map((f) => {
    const newStart = f.start > editPos ? f.start + delta : f.start;
    const newEnd = f.end > insertIndex ? f.end + delta : f.end;
    const newSubRanges = f.subRanges?.map((range) => ({
      ...range,
      start: range.start > editPos ? range.start + delta : range.start,
      end: range.end > insertIndex ? range.end + delta : range.end,
    }));
    if (newSubRanges && newSubRanges.length > 0) {
      const extrema = featureExtrema(newSubRanges)!;
      return {
        ...f,
        start: extrema.start,
        end: extrema.end,
        subRanges: newSubRanges,
      };
    }
    return {
      ...f,
      start: newStart,
      end: newEnd,
      ...(newSubRanges ? { subRanges: newSubRanges } : {}),
    };
  });
}

function transformDeletedCoordinate(
  coordinate: number,
  deleteStart: number,
  deleteEnd: number,
  deletedCount: number,
): number {
  if (coordinate >= deleteEnd) {
    return coordinate - deletedCount;
  }
  if (coordinate > deleteStart) {
    return deleteStart;
  }
  return coordinate;
}

// ---------------------------------------------------------------------------
// applySubstitution
// ---------------------------------------------------------------------------

/**
 * Replace a single base at `pos` with `newBase`.
 *
 * - Adds a substitution scar at `pos` recording the original base.
 * - If a scar already exists at that position, it is replaced.
 * - Features are unchanged (substitution does not alter coordinates).
 *
 * @param raw      Current sequence string
 * @param scars    Existing mutation scars
 * @param features Existing features
 * @param pos      0-indexed position to substitute
 * @param newBase  The replacement base character(s)
 * @returns        New MutationResult
 */
export function applySubstitution(
  raw: string,
  scars: MutationScar[],
  features: Feature[],
  pos: number,
  newBase: string,
  molecule: MutationMolecule = 'dna',
): MutationResult {
  requireSafeInteger(pos, 'pos', 0);

  // Guard: pos out of range — return unchanged
  if (pos < 0 || pos >= raw.length) {
    return { raw, scars: [...scars], features: [...features] };
  }

  const validAlphabet = molecule === 'dna'
    ? VALID_DNA_SUBSTITUTION
    : molecule === 'rna'
      ? VALID_RNA_SUBSTITUTION
      : molecule === 'protein'
        ? VALID_PROTEIN_SUBSTITUTION
        : null;
  if (typeof newBase !== 'string' || validAlphabet === null || !validAlphabet.test(newBase)) {
    throw new Error(`Substitution requires exactly one valid residue from the declared ${String(molecule)} alphabet; use insertion or deletion for length-changing edits.`);
  }
  // A substitution does not move coordinates, so a supported circular
  // origin-spanning envelope remains valid without requiring topology here.
  validateMutationFeatures(features, raw.length, true);
  mutationOperationUnits(1, scars, features);

  const original = raw[pos];
  const normalizedBase = newBase.toUpperCase();

  // Build the new sequence
  const newRaw = raw.slice(0, pos) + normalizedBase + raw.slice(pos + 1);

  // Remove any existing scar at this position, then add the new one
  const filteredScars = scars.filter((s) => s.position !== pos);
  const scar: MutationScar = {
    id: crypto.randomUUID(),
    position: pos,
    type: 'substitution',
    original,
    createdAt: Date.now(),
  };

  return {
    raw: newRaw,
    scars: [...filteredScars, scar],
    features: [...features],
  };
}

// ---------------------------------------------------------------------------
// applyInsertion
// ---------------------------------------------------------------------------

/**
 * Insert `bases` AFTER position `pos`.
 *
 * - Shifts all existing scars at positions > pos by +bases.length.
 * - Uses half-open feature boundaries: insertion at start shifts the feature,
 *   insertion strictly inside extends it, and insertion at end leaves it unchanged.
 * - Adds an insertion scar on each newly inserted base position.
 *
 * When `pos` is -1 the insertion happens at the very beginning of the
 * sequence (before index 0). When `pos` is raw.length - 1 the insertion
 * is appended at the end.
 *
 * @param raw      Current sequence string
 * @param scars    Existing mutation scars
 * @param features Existing features
 * @param pos      0-indexed position; bases are inserted AFTER this position.
 *                 Use -1 to insert before the first base.
 * @param bases    The bases to insert
 * @returns        New MutationResult
 */
export function applyInsertion(
  raw: string,
  scars: MutationScar[],
  features: Feature[],
  pos: number,
  bases: string,
  molecule: MutationMolecule = 'dna',
): MutationResult {
  if (typeof bases !== 'string') {
    throw new TypeError('Insertion bases must be a string.');
  }
  requireSafeInteger(pos, 'pos', -1);
  // Nothing to insert
  if (bases.length === 0) {
    return { raw, scars: [...scars], features: [...features] };
  }

  // Guard: pos out of range before alphabet, result-size, and work-budget
  // checks. An edit that cannot address this sequence is an intentional no-op.
  if (pos < -1 || pos > raw.length - 1) {
    return { raw, scars: [...scars], features: [...features] };
  }

  if (bases.length > MAX_MUTATION_INSERTION_LENGTH) {
    throw new RangeError(`Insertion cannot exceed ${MAX_MUTATION_INSERTION_LENGTH.toLocaleString()} residues.`);
  }
  const validAlphabet = molecule === 'dna'
    ? VALID_DNA_INSERTION
    : molecule === 'rna'
      ? VALID_RNA_INSERTION
      : molecule === 'protein'
        ? VALID_PROTEIN_INSERTION
        : null;
  if (validAlphabet === null || !validAlphabet.test(bases)) {
    throw new Error(`Insertion residues must match the declared ${String(molecule)} alphabet.`);
  }
  if (raw.length > MAX_MUTATION_RESULT_LENGTH - bases.length) {
    throw new RangeError(`Insertion would exceed the ${MAX_MUTATION_RESULT_LENGTH.toLocaleString()}-residue result limit.`);
  }
  validateMutationFeatures(features, raw.length);
  mutationOperationUnits(bases.length, scars, features);
  const normalizedBases = bases.toUpperCase();

  const insertIndex = pos + 1; // actual string index where insertion starts
  const delta = normalizedBases.length;

  // Build the new sequence
  const newRaw = raw.slice(0, insertIndex) + normalizedBases + raw.slice(insertIndex);

  // Shift existing scars and features
  const shiftedScars = shiftScars(scars, pos, delta);
  const shiftedFeatures = shiftFeatures(features, pos, delta);

  // Create insertion scars for each inserted base
  const now = Date.now();
  const insertionScars: MutationScar[] = Array.from(normalizedBases, (base, i) => ({
    id: crypto.randomUUID(),
    position: insertIndex + i,
    type: 'insertion' as const,
    inserted: base,
    createdAt: now,
  }));

  return {
    raw: newRaw,
    scars: [...shiftedScars, ...insertionScars],
    features: shiftedFeatures,
  };
}

// ---------------------------------------------------------------------------
// applyDeletion
// ---------------------------------------------------------------------------

/**
 * Remove `count` bases starting at `pos`.
 *
 * - Removes any scars in the deleted range [pos, pos + count).
 * - Shifts remaining scars at positions >= pos + count by -count.
 * - Adds a single deletion scar marker at `pos` recording the deleted bases.
 * - Shifts features similarly and filters out any that become zero-length
 *   or invalid (end <= start).
 *
 * @param raw      Current sequence string
 * @param scars    Existing mutation scars
 * @param features Existing features
 * @param pos      0-indexed start of deletion
 * @param count    Number of bases to delete
 * @returns        New MutationResult
 */
export function applyDeletion(
  raw: string,
  scars: MutationScar[],
  features: Feature[],
  pos: number,
  count: number,
): MutationResult {
  requireSafeInteger(pos, 'pos', 0);
  requireSafeInteger(count, 'count', 0);
  // Nothing to delete
  if (count <= 0) {
    return { raw, scars: [...scars], features: [...features] };
  }

  // Guard: pos out of range
  if (pos < 0 || pos >= raw.length) {
    return { raw, scars: [...scars], features: [...features] };
  }

  // Clamp count so we don't exceed sequence length
  const effectiveCount = Math.min(count, raw.length - pos);
  validateMutationFeatures(features, raw.length);
  mutationOperationUnits(effectiveCount, scars, features);
  const deletedBases = raw.slice(pos, pos + effectiveCount);

  // Build the new sequence
  const newRaw = raw.slice(0, pos) + raw.slice(pos + effectiveCount);

  // Remove scars in the deleted range, shift those after
  const updatedScars = scars
    .filter((s) => s.position < pos || s.position >= pos + effectiveCount)
    .map((s) =>
      s.position >= pos + effectiveCount
        ? { ...s, position: s.position - effectiveCount }
        : { ...s },
    );

  // Deletion scar marker
  const deletionScar: MutationScar = {
    id: crypto.randomUUID(),
    position: pos,
    type: 'deletion',
    original: deletedBases,
    createdAt: Date.now(),
  };

  // Shift features: for each coordinate, if it falls in the deleted range
  // clamp it to `pos`; if it falls after the deleted range, shift by -count.
  const endOfDeletion = pos + effectiveCount;
  const updatedFeatures = features
    .map((f) => {
      const newStart = transformDeletedCoordinate(
        f.start,
        pos,
        endOfDeletion,
        effectiveCount,
      );
      const newEnd = transformDeletedCoordinate(
        f.end,
        pos,
        endOfDeletion,
        effectiveCount,
      );
      const newSubRanges = f.subRanges
        ?.map((range) => ({
          ...range,
          start: transformDeletedCoordinate(
            range.start,
            pos,
            endOfDeletion,
            effectiveCount,
          ),
          end: transformDeletedCoordinate(
            range.end,
            pos,
            endOfDeletion,
            effectiveCount,
          ),
        }))
        .filter((range) => range.end > range.start);

      if (f.subRanges && (!newSubRanges || newSubRanges.length === 0)) return null;
      if (newSubRanges && newSubRanges.length > 0) {
        const extrema = featureExtrema(newSubRanges)!;
        return {
          ...f,
          start: extrema.start,
          end: extrema.end,
          subRanges: newSubRanges,
        };
      }

      return {
        ...f,
        start: newStart,
        end: newEnd,
        ...(newSubRanges ? { subRanges: newSubRanges } : {}),
      };
    })
    // Filter out features that became zero-length or invalid
    .filter((f): f is Feature => f !== null && f.end > f.start);

  return {
    raw: newRaw,
    scars: [...updatedScars, deletionScar],
    features: updatedFeatures,
  };
}
