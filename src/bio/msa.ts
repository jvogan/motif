/**
 * Multiple Sequence Alignment (MSA)
 *
 * Uses a star-alignment strategy:
 *   1. Compute pairwise NW alignments (reuses sequenceDiff under the hood)
 *   2. Choose a "center" sequence (highest average pairwise identity)
 *   3. Align all other sequences to the center
 *   4. Merge by taking the maximum-gap union at each center position
 *
 * Handles DNA, RNA, and protein sequences.
 */

import {
  alignmentResiduesMatch,
  classifyAlignmentResidues,
  normalizeAlignmentSequence,
  type AlignmentMolecule,
} from './alignment-semantics';
import { sequenceDiff, type DiffMethod } from './sequence-diff';

// ===== Public types =====

export interface MSARow {
  name: string;
  aligned: string;      // aligned sequence with gaps ('-')
  identity: number;     // % identity vs consensus (0-100)
}

export interface MSAResult {
  rows: MSARow[];
  consensus: string;      // majority-vote consensus
  conserved: boolean[];   // per-column: every sequence shares one non-gap char (a gap → not conserved, matching CLUSTAL '*')
  gapOnly: boolean[];     // per-column: every sequence has a gap
  alignmentLength: number;
  centerIdx: number;      // index of the "center" (anchor) sequence in rows
  /** Explicit comparison route metadata for browser/import parity. */
  method: string;
  algorithm: string;
  fallback: boolean;
  warnings: string[];
  ambiguities: number;
}

export interface MSAError {
  type: 'too_large' | 'insufficient_sequences' | 'invalid_input' | 'work_limit';
  message: string;
  warnings?: string[];
}

/** Type guard */
export function isMSAError<T>(r: T | MSAError): r is MSAError {
  return typeof r === 'object' && r !== null && 'type' in r && 'message' in r;
}

// ===== Per-sequence length limit =====
export const MSA_MAX_SEQ_LEN = 3000;
export const MSA_MAX_SEQUENCES = 100;
export const MSA_MAX_WORK_UNITS = 250_000_000;
export const MSA_MAX_FORMAT_WIDTH = 10_000;
export const MSA_MAX_FORMAT_NAME_LENGTH = 256;
export const MSA_MAX_FORMAT_ROWS = MSA_MAX_SEQUENCES;
export const MSA_MAX_FORMAT_ALIGNMENT_LENGTH = 50_000;
export const MSA_MAX_FORMAT_WORK_UNITS = 2_000_000;
export const MSA_MAX_FORMAT_ORIGINAL_LENGTH = MSA_MAX_FORMAT_ALIGNMENT_LENGTH;

export type MsaWorkRoute = 'all-pairs' | 'heuristic-star';

export type ComputeMSAOptions = {
  molecule?: AlignmentMolecule;
  maxWorkUnits?: number;
};

function msaError(type: MSAError['type'], message: string, warnings?: string[]): MSAError {
  return { type, message, ...(warnings?.length ? { warnings } : {}) };
}

function inferMolecule(sequences: readonly string[]): AlignmentMolecule | null {
  const dna = sequences.every((sequence) => /^[ACGTRYSWKMBDHVN?]+$/u.test(sequence));
  if (dna) return 'dna';
  const rna = sequences.every((sequence) => /^[ACGURYSWKMBDHVN?]+$/u.test(sequence));
  if (rna) return 'rna';
  const protein = sequences.every((sequence) => /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*?]+$/u.test(sequence));
  return protein ? 'protein' : null;
}

export function estimateMsaWork(
  lengths: readonly number[],
  route?: MsaWorkRoute,
): number {
  if (!Array.isArray(lengths) || lengths.length > MSA_MAX_SEQUENCES) return Number.POSITIVE_INFINITY;
  const selectedRoute = route ?? (lengths.length <= 10 ? 'all-pairs' : 'heuristic-star');
  if (selectedRoute !== 'all-pairs' && selectedRoute !== 'heuristic-star') return Number.POSITIVE_INFINITY;
  let totalLength = 0;
  let pairwise = 0;
  let maxLength = 0;
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0) return Number.POSITIVE_INFINITY;
    if (length > maxLength) maxLength = length;
    if (selectedRoute === 'all-pairs') {
      if (length > 0 && totalLength > Number.MAX_SAFE_INTEGER / length) return Number.POSITIVE_INFINITY;
      const pairwiseIncrement = totalLength * length;
      if (!Number.isSafeInteger(pairwiseIncrement)
        || pairwise > Number.MAX_SAFE_INTEGER - pairwiseIncrement) {
        return Number.POSITIVE_INFINITY;
      }
      pairwise += pairwiseIncrement;
    }
    if (totalLength > Number.MAX_SAFE_INTEGER - length) return Number.POSITIVE_INFINITY;
    totalLength += length;
  }
  const centerLength = selectedRoute === 'heuristic-star'
    ? [...lengths].sort((left, right) => left - right)[Math.floor(lengths.length / 2)] ?? 0
    : maxLength;
  const nonCenterLength = totalLength - centerLength;
  if (centerLength > 0 && nonCenterLength > Number.MAX_SAFE_INTEGER / centerLength) return Number.POSITIVE_INFINITY;
  const centerPass = centerLength * nonCenterLength;
  if (!Number.isSafeInteger(centerPass) || pairwise > Number.MAX_SAFE_INTEGER - centerPass) {
    return Number.POSITIVE_INFINITY;
  }
  return (selectedRoute === 'all-pairs' ? pairwise : 0) + Math.max(0, centerPass);
}

function diffMethods(values: readonly DiffMethod[]): string {
  const methods = Array.from(new Set(values));
  if (methods.length === 0) return 'none';
  return methods.join(' + ');
}

// ===== Internal helpers =====

/**
 * For an aligned sequence (with '-'), compute how many gaps appear
 * BEFORE the p-th character of the original (gap-free) sequence.
 * Result has length origLen + 1 (last entry = trailing gaps).
 */
function getGapSlots(alignedSeq: string, origLen: number): number[] {
  const slots = new Array<number>(origLen + 1).fill(0);
  let charIdx = 0;
  let gapCount = 0;

  for (let i = 0; i < alignedSeq.length; i++) {
    if (alignedSeq[i] === '-') {
      gapCount++;
    } else {
      slots[charIdx] = gapCount;
      gapCount = 0;
      charIdx++;
    }
  }
  // Trailing gaps (after last original char)
  slots[origLen] = gapCount;
  return slots;
}

/**
 * Re-encode an aligned pairwise sequence to fit the merged gap slots.
 *
 * pairGapSlots:   gaps-before-each-center-char in THIS pairwise alignment
 * mergedGapSlots: gaps-before-each-center-char in the MERGED alignment
 *
 * Extra columns (in merged but not in pair) become '-'.
 */
function expandSeqToMerged(
  alignedSeq: string,
  pairGapSlots: number[],
  mergedGapSlots: number[],
): string {
  const centerLen = pairGapSlots.length - 1; // excludes trailing slot
  let result = '';
  let i = 0; // cursor into alignedSeq

  for (let p = 0; p <= centerLen; p++) {
    const origGaps = pairGapSlots[p];
    const mergedGaps = mergedGapSlots[p];

    // Consume origGaps characters from the pairwise aligned seq
    // (these are the insertion columns relative to center)
    for (let g = 0; g < origGaps; g++) {
      result += i < alignedSeq.length ? alignedSeq[i] : '-';
      i++;
    }

    // Insert extra '-' for columns only in merged alignment
    const extra = mergedGaps - origGaps;
    if (extra > 0) result += '-'.repeat(extra);

    // Consume the column corresponding to center char p (unless trailing slot)
    if (p < centerLen) {
      result += i < alignedSeq.length ? alignedSeq[i] : '-';
      i++;
    }
  }

  return result;
}

/**
 * Expand the center sequence itself using the merged gap slots.
 */
function expandCenter(center: string, mergedGapSlots: number[]): string {
  let result = '';
  for (let p = 0; p < center.length; p++) {
    result += '-'.repeat(mergedGapSlots[p]);
    result += center[p];
  }
  result += '-'.repeat(mergedGapSlots[center.length]);
  return result;
}

/**
 * Majority-vote consensus from a set of aligned sequences.
 */
function buildConsensus(
  aligned: string[],
): { consensus: string; conserved: boolean[]; gapOnly: boolean[] } {
  if (aligned.length === 0) return { consensus: '', conserved: [], gapOnly: [] };
  const len = aligned[0].length;
  let consensus = '';
  const conserved: boolean[] = [];
  const gapOnly: boolean[] = [];

  for (let col = 0; col < len; col++) {
    const chars = aligned.map((s) => s[col] ?? '-');
    const nonGap = chars.filter((c) => c !== '-');

    if (nonGap.length === 0) {
      consensus += '-';
      conserved.push(false);
      gapOnly.push(true);
    } else {
      // Majority vote
      const freq: Record<string, number> = {};
      for (const c of nonGap) freq[c] = (freq[c] ?? 0) + 1;
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      consensus += sorted[0][0];
      // Fully conserved means EVERY sequence carries the same residue here — so a
      // column where one row is gapped (an indel) is NOT conserved, even if the
      // remaining non-gap chars agree. This matches the CLUSTAL '*' convention and
      // keeps the conservation track / "% conserved" stat from over-reporting on
      // alignments that contain insertions or deletions.
      conserved.push(nonGap.length === chars.length && nonGap.every((c) => c === sorted[0][0]));
      gapOnly.push(false);
    }
  }

  return { consensus, conserved, gapOnly };
}

/**
 * Percent identity of an aligned sequence vs consensus.
 *
 * Counted over every column that has a consensus residue (i.e. all columns
 * except gap-only ones, where every sequence is gapped). A gap in THIS row
 * opposite a real consensus residue counts as a mismatch — so a deletion
 * lowers the reported identity instead of being silently excluded. This keeps
 * the per-row "% identity" honest for sequences with indels (a row missing a
 * stretch of bases no longer reads as 100% identical to the consensus).
 */
function computeIdentityWithSemantics(
  aligned: string,
  consensus: string,
  molecule: AlignmentMolecule,
): { identity: number; ambiguities: number } {
  let matches = 0;
  let total = 0;
  let ambiguities = 0;
  for (let i = 0; i < aligned.length; i += 1) {
    if (consensus[i] === '-') continue;
    total += 1;
    if (aligned[i] === '-') continue;
    const residue = classifyAlignmentResidues(aligned[i], consensus[i], molecule);
    if (residue === 'match') {
      matches += 1;
    } else if (residue === 'ambiguous' || alignmentResiduesMatch(aligned[i], consensus[i], molecule)) {
      matches += 1;
      ambiguities += 1;
    }
  }
  return {
    identity: total > 0 ? Math.round((matches / total) * 1000) / 10 : 0,
    ambiguities,
  };
}

// ===== Public API =====

/**
 * Compute a multiple sequence alignment for the given sequences.
 * Returns MSAError if the input is invalid or too large.
 */
export function computeMSA(
  sequences: string[],
  names: string[],
  options: ComputeMSAOptions = {},
): MSAResult | MSAError {
  if (!Array.isArray(sequences) || !Array.isArray(names)) {
    return msaError('invalid_input', 'MSA sequences and names must both be arrays.');
  }
  if (sequences.length > MSA_MAX_SEQUENCES) {
    return msaError('too_large', `MSA supports at most ${MSA_MAX_SEQUENCES} sequences.`);
  }
  if (sequences.length < 2) {
    return msaError('insufficient_sequences', 'MSA requires at least 2 sequences.');
  }

  if (names.length !== sequences.length) {
    return msaError('invalid_input', `MSA requires one unique name for each sequence (got ${names.length} names for ${sequences.length} sequences).`);
  }

  const seenNames = new Set<string>();
  for (let index = 0; index < names.length; index += 1) {
    if (typeof names[index] !== 'string' || !names[index].trim()) {
      return msaError('invalid_input', `Sequence name ${index + 1} must be a non-empty string.`);
    }
    const key = names[index].trim().toLowerCase();
    if (seenNames.has(key)) return msaError('invalid_input', `Sequence names must be unique; “${names[index]}” appears more than once.`);
    seenNames.add(key);
  }

  let upper: string[];
  try {
    upper = sequences.map((sequence, index) => normalizeAlignmentSequence(
      sequence,
      options.molecule ?? 'dna',
      { gapped: false, field: `Sequence ${index + 1}` },
    ));
  } catch (error) {
    // If no molecule was supplied, infer a protein alphabet before rejecting a
    // non-DNA sequence; browser callers still pass their declared type.
    if (options.molecule) return msaError('invalid_input', error instanceof Error ? error.message : 'Invalid sequence input.');
    if (sequences.some((sequence) => typeof sequence !== 'string')) {
      return msaError('invalid_input', 'Every MSA sequence must be a string.');
    }
    const candidate = sequences.map((sequence) => sequence.toUpperCase().replace(/[ \t\r\n]/g, ''));
    const inferred = inferMolecule(candidate);
    if (!inferred) return msaError('invalid_input', error instanceof Error ? error.message : 'Sequences contain symbols outside the supported alignment alphabets.');
    try {
      upper = candidate.map((sequence, index) => normalizeAlignmentSequence(
        sequence,
        inferred,
        { gapped: false, field: `Sequence ${index + 1}` },
      ));
    } catch (retryError) {
      return msaError('invalid_input', retryError instanceof Error ? retryError.message : 'Invalid sequence input.');
    }
  }
  const molecule = options.molecule ?? inferMolecule(upper);
  if (!molecule) return msaError('invalid_input', 'Sequences contain symbols outside the supported DNA, RNA, and protein alignment alphabets.');
  if (upper.some((sequence) => sequence.length === 0)) {
    return msaError('invalid_input', 'Every MSA sequence must contain at least one residue.');
  }

  // Length guard
  let maxLen = 0;
  for (const sequence of upper) {
    if (sequence.length > maxLen) maxLen = sequence.length;
  }
  if (maxLen > MSA_MAX_SEQ_LEN) {
    return msaError('too_large', `Sequences must be ≤ ${MSA_MAX_SEQ_LEN} characters for MSA (longest: ${maxLen} bp/aa).`);
  }

  const route: MsaWorkRoute = upper.length <= 10 ? 'all-pairs' : 'heuristic-star';
  const requestedMaxWorkUnits = options.maxWorkUnits ?? MSA_MAX_WORK_UNITS;
  if (typeof requestedMaxWorkUnits !== 'number' || Number.isNaN(requestedMaxWorkUnits) || requestedMaxWorkUnits < 0) {
    return msaError('invalid_input', 'MSA maxWorkUnits must be a non-negative number.');
  }
  // A caller-provided budget can only lower the hard ceiling; Infinity is
  // clamped rather than becoming an escape hatch for the comparison guard.
  const maxWorkUnits = Math.min(requestedMaxWorkUnits, MSA_MAX_WORK_UNITS);
  const estimatedWork = estimateMsaWork(upper.map((sequence) => sequence.length), route);
  if (estimatedWork > maxWorkUnits) {
    return msaError('work_limit', `MSA requires ${estimatedWork.toLocaleString()} comparison cells, above the ${maxWorkUnits.toLocaleString()}-cell work limit.`);
  }

  const n = upper.length;

  // ── 1. Find center sequence (max average pairwise identity) ──────────────
  // For up to 10 sequences do all-pairs; beyond that use median length.
  const scores = new Array<number>(n).fill(0);
  const methods: DiffMethod[] = [];
  const warnings: string[] = [];
  let ambiguities = 0;

  if (n <= 10) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const diff = sequenceDiff(upper[i], upper[j], { molecule });
        if (diff.status !== 'ok') return msaError(diff.status === 'work-limit' ? 'work_limit' : 'invalid_input', diff.warnings[0] ?? 'Pairwise comparison failed.');
        scores[i] += diff.identity;
        scores[j] += diff.identity;
      }
    }
  } else {
    // Approximate: pick sequence closest to median length
    const sorted = [...upper.map((s, i) => ({ len: s.length, i }))].sort(
      (a, b) => a.len - b.len,
    );
    scores[sorted[Math.floor(n / 2)].i] = Infinity;
  }

  let centerIdx = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < scores.length; index += 1) {
    if (scores[index] > bestScore) {
      bestScore = scores[index];
      centerIdx = index;
    }
  }
  const center = upper[centerIdx];

  // ── 2. Pairwise-align every sequence to center ────────────────────────────
  const pairAligns: Array<{ alignedCenter: string; alignedSeq: string }> = [];

  for (let i = 0; i < n; i++) {
    if (i === centerIdx) {
      // Center aligned with itself: no gaps
      pairAligns.push({ alignedCenter: center, alignedSeq: center });
    } else {
      const diff = sequenceDiff(center, upper[i], { molecule });
      if (diff.status !== 'ok') return msaError(diff.status === 'work-limit' ? 'work_limit' : 'invalid_input', diff.warnings[0] ?? 'Pairwise comparison failed.');
      methods.push(diff.method);
      ambiguities += diff.ambiguousMatches;
      warnings.push(...diff.warnings);
      pairAligns.push({ alignedCenter: diff.aligned1, alignedSeq: diff.aligned2 });
    }
  }

  // ── 3. Compute gap slots per pairwise alignment ───────────────────────────
  const allGapSlots = pairAligns.map((p) =>
    getGapSlots(p.alignedCenter, center.length),
  );

  // ── 4. Merged gap slots: column-wise maximum ─────────────────────────────
  const mergedSlots = new Array<number>(center.length + 1).fill(0);
  for (const slots of allGapSlots) {
    for (let p = 0; p <= center.length; p++) {
      if (slots[p] > mergedSlots[p]) mergedSlots[p] = slots[p];
    }
  }

  // ── 5. Reconstruct aligned sequences ─────────────────────────────────────
  const aligned: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i === centerIdx) {
      aligned.push(expandCenter(center, mergedSlots));
    } else {
      aligned.push(
        expandSeqToMerged(pairAligns[i].alignedSeq, allGapSlots[i], mergedSlots),
      );
    }
  }

  // ── 6. Consensus + conservation ──────────────────────────────────────────
  const { consensus, conserved, gapOnly } = buildConsensus(aligned);

  const rows: MSARow[] = aligned.map((a, i) => ({
    name: names[i].trim(),
    aligned: a,
    identity: computeIdentityWithSemantics(a, consensus, molecule).identity,
  }));

  const uniqueWarnings = Array.from(new Set(warnings));

  return {
    rows,
    consensus,
    conserved,
    gapOnly,
    alignmentLength: aligned[0]?.length ?? 0,
    centerIdx,
    method: 'star',
    algorithm: diffMethods(methods),
    fallback: methods.some((method) => method !== 'needleman-wunsch'),
    warnings: uniqueWarnings,
    ambiguities,
  };
}

// ===== Backward-compat shims for CLI (cli/commands/align.ts) =====

/** @deprecated Use MSARow instead */
export interface AlignedSequence {
  name: string;
  aligned: string;
  original: string;
}

/** @deprecated Use MSAResult directly (new shape) */
export interface LegacyMSAResult {
  sequences: AlignedSequence[];
  consensusSequence: string;
  conservationScores: number[];
  identity: number;
  gaps: number;
  alignmentLength: number;
  conservedColumns: number;
}

function validateLegacyMSAResult(result: unknown, width: unknown): asserts result is LegacyMSAResult {
  if (typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1 || width > MSA_MAX_FORMAT_WIDTH) {
    throw new RangeError(`MSA format width must be a safe integer from 1 to ${MSA_MAX_FORMAT_WIDTH}.`);
  }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new TypeError('MSA format result must be an object.');
  }
  const candidate = result as Partial<LegacyMSAResult>;
  if (!Array.isArray(candidate.sequences) || candidate.sequences.length === 0) {
    throw new TypeError('MSA format result must contain at least one sequence row.');
  }
  if (candidate.sequences.length > MSA_MAX_FORMAT_ROWS) {
    throw new RangeError(`MSA format result cannot contain more than ${MSA_MAX_FORMAT_ROWS} sequence rows.`);
  }
  if (!Number.isSafeInteger(candidate.alignmentLength) || (candidate.alignmentLength as number) < 0) {
    throw new TypeError('MSA format alignmentLength must be a non-negative safe integer.');
  }
  if ((candidate.alignmentLength as number) < 1 || (candidate.alignmentLength as number) > MSA_MAX_FORMAT_ALIGNMENT_LENGTH) {
    throw new RangeError(`MSA format alignmentLength must be from 1 to ${MSA_MAX_FORMAT_ALIGNMENT_LENGTH}.`);
  }
  if ((candidate.sequences.length as number) > MSA_MAX_FORMAT_WORK_UNITS / (candidate.alignmentLength as number)) {
    throw new RangeError(`MSA format result exceeds the ${MSA_MAX_FORMAT_WORK_UNITS.toLocaleString()}-cell work limit.`);
  }
  if (!Array.isArray(candidate.conservationScores) || candidate.conservationScores.length !== candidate.alignmentLength) {
    throw new TypeError('MSA format conservationScores must match alignmentLength.');
  }
  if (!Number.isFinite(candidate.identity) || (candidate.identity as number) < 0 || (candidate.identity as number) > 100) {
    throw new TypeError('MSA format identity must be a percentage from 0 to 100.');
  }
  if (!Number.isSafeInteger(candidate.gaps) || (candidate.gaps as number) < 0) {
    throw new TypeError('MSA format gaps must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(candidate.conservedColumns) || (candidate.conservedColumns as number) < 0 || (candidate.conservedColumns as number) > candidate.alignmentLength) {
    throw new TypeError('MSA format conservedColumns must be bounded by alignmentLength.');
  }
  let expectedGaps = 0;
  for (const [index, row] of candidate.sequences.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new TypeError(`MSA sequence row ${index + 1} must be an object.`);
    const sequence = row as Partial<AlignedSequence>;
    if (typeof sequence.name !== 'string' || sequence.name.trim().length === 0 || sequence.name.length > MSA_MAX_FORMAT_NAME_LENGTH) {
      throw new TypeError(`MSA sequence row ${index + 1} name must be a bounded non-empty string.`);
    }
    if (typeof sequence.aligned !== 'string' || sequence.aligned.length !== candidate.alignmentLength) {
      throw new TypeError(`MSA sequence row ${index + 1} aligned length must equal alignmentLength.`);
    }
    if (typeof sequence.original !== 'string' || sequence.original.length > MSA_MAX_FORMAT_ORIGINAL_LENGTH) {
      throw new TypeError(`MSA sequence row ${index + 1} original must be a bounded string.`);
    }
    expectedGaps += [...sequence.aligned].filter((character) => character === '-').length;
  }
  for (const [index, score] of candidate.conservationScores.entries()) {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new TypeError(`MSA conservation score ${index + 1} must be a number from 0 to 1.`);
    }
  }
  if (candidate.gaps !== expectedGaps) throw new TypeError('MSA format gaps does not match the aligned rows.');
  const expectedConserved = candidate.conservationScores.filter((score) => score === 1).length;
  if (candidate.conservedColumns !== expectedConserved) throw new TypeError('MSA format conservedColumns does not match conservationScores.');
}

/**
 * Backward-compatible wrapper around computeMSA.
 * Accepts { name, sequence }[] and returns legacy MSAResult shape.
 * @deprecated Use computeMSA() instead.
 */
export function multipleAlign(
  sequences: Array<{ name: string; sequence: string }>,
): LegacyMSAResult | MSAError {
  if (!Array.isArray(sequences) || sequences.length < 2) {
    return msaError('insufficient_sequences', 'MSA requires at least 2 sequences; an empty result is not a valid alignment.');
  }

  const seqs = sequences.map((s) => s.sequence);
  const names = sequences.map((s) => s.name);
  const result = computeMSA(seqs, names);

  if (isMSAError(result)) {
    return result;
  }

  const alignedSeqs: AlignedSequence[] = result.rows.map((row, i) => ({
    name: row.name,
    aligned: row.aligned,
    original: sequences[i].sequence.toUpperCase().replace(/\s/g, ''),
  }));

  const totalGaps = result.rows.reduce(
    (sum, r) => sum + (r.aligned.match(/-/g)?.length ?? 0),
    0,
  );

  const conservationScores = result.conserved.map((c, i) => {
    if (result.gapOnly[i]) return 0;
    return c ? 1 : 0.5;
  });

  const avgIdentity =
    result.rows.reduce((s, r) => s + r.identity, 0) / result.rows.length;

  const conservedCols = result.conserved.filter((c, i) => c && !result.gapOnly[i]).length;

  return {
    sequences: alignedSeqs,
    consensusSequence: result.consensus,
    conservationScores,
    identity: Math.round(avgIdentity * 10) / 10,
    gaps: totalGaps,
    alignmentLength: result.alignmentLength,
    conservedColumns: conservedCols,
  };
}

/**
 * Format an MSA (legacy shape) in CLUSTAL-like format.
 * @deprecated Use computeMSA() and format the result directly.
 */
export function formatMSA(result: LegacyMSAResult, options?: { width?: number }): string {
  const width = options?.width ?? 60;
  validateLegacyMSAResult(result, width);

  const lines: string[] = ['CLUSTAL-like multiple sequence alignment\n'];
  const alignLen = result.alignmentLength;

  const maxNameLen = Math.max(...result.sequences.map((s) => s.name.length), 9);

  for (let offset = 0; offset < alignLen; offset += width) {
    for (const seq of result.sequences) {
      const block = seq.aligned.slice(offset, offset + width);
      const namePad = seq.name.padEnd(maxNameLen);
      const end = offset + block.length;
      lines.push(`${namePad} ${block} ${end}`);
    }

    const scores = result.conservationScores.slice(offset, offset + width);
    const conservation = scores
      .map((s) => {
        if (s === 1) return '*';
        if (s >= 0.8) return ':';
        if (s >= 0.5) return '.';
        return ' ';
      })
      .join('');
    lines.push(' '.repeat(maxNameLen + 1) + conservation);
    lines.push('');
  }

  lines.push(`Alignment length:  ${result.alignmentLength}`);
  lines.push(`Identity:          ${result.identity.toFixed(1)}%`);
  lines.push(`Conserved columns: ${result.conservedColumns}`);
  lines.push(`Total gaps:        ${result.gaps}`);

  return lines.join('\n');
}
