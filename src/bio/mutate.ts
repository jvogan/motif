// ===== Pure Mutation Functions =====
// All functions are pure — no side effects, no store access.
// Each returns a new MutationResult with updated raw, scars, and features.

import type { Feature } from './types';
import type { MutationScar } from './types';

export interface MutationResult {
  raw: string;
  scars: MutationScar[];
  features: Feature[];
}

// ---------------------------------------------------------------------------
// Helpers (not exported)
// ---------------------------------------------------------------------------

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
      return {
        ...f,
        start: Math.min(...newSubRanges.map((range) => range.start)),
        end: Math.max(...newSubRanges.map((range) => range.end)),
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
): MutationResult {
  // Guard: pos out of range — return unchanged
  if (pos < 0 || pos >= raw.length) {
    return { raw, scars: [...scars], features: [...features] };
  }

  const original = raw[pos];

  // Build the new sequence
  const newRaw = raw.slice(0, pos) + newBase + raw.slice(pos + 1);

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
): MutationResult {
  // Nothing to insert
  if (bases.length === 0) {
    return { raw, scars: [...scars], features: [...features] };
  }

  // Guard: pos out of range
  if (pos < -1 || pos > raw.length - 1) {
    return { raw, scars: [...scars], features: [...features] };
  }

  const insertIndex = pos + 1; // actual string index where insertion starts
  const delta = bases.length;

  // Build the new sequence
  const newRaw = raw.slice(0, insertIndex) + bases + raw.slice(insertIndex);

  // Shift existing scars and features
  const shiftedScars = shiftScars(scars, pos, delta);
  const shiftedFeatures = shiftFeatures(features, pos, delta);

  // Create insertion scars for each inserted base
  const now = Date.now();
  const insertionScars: MutationScar[] = Array.from(bases, (base, i) => ({
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
        return {
          ...f,
          start: Math.min(...newSubRanges.map((range) => range.start)),
          end: Math.max(...newSubRanges.map((range) => range.end)),
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
