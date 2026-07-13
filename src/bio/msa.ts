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

import { sequenceDiff } from './sequence-diff';

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
}

export interface MSAError {
  type: 'too_large' | 'insufficient_sequences';
  message: string;
}

/** Type guard */
export function isMSAError(r: MSAResult | MSAError): r is MSAError {
  return 'type' in r && 'message' in r;
}

// ===== Per-sequence length limit =====
export const MSA_MAX_SEQ_LEN = 3000;

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
function computeIdentity(aligned: string, consensus: string): number {
  let matches = 0;
  let total = 0;
  for (let i = 0; i < aligned.length; i++) {
    // Skip gap-only columns (consensus is '-' only when every sequence is gapped
    // there) — they belong to no single sequence and should not dilute identity.
    if (consensus[i] === '-') continue;
    total++;
    // aligned[i] === '-' can never equal a non-gap consensus char, so a gap in
    // this row is correctly scored as a mismatch.
    if (aligned[i] === consensus[i]) matches++;
  }
  return total > 0 ? Math.round((matches / total) * 1000) / 10 : 0;
}

// ===== Public API =====

/**
 * Compute a multiple sequence alignment for the given sequences.
 * Returns MSAError if the input is invalid or too large.
 */
export function computeMSA(
  sequences: string[],
  names: string[],
): MSAResult | MSAError {
  if (sequences.length < 2) {
    return {
      type: 'insufficient_sequences',
      message: 'MSA requires at least 2 sequences.',
    };
  }

  const upper = sequences.map((s) => s.toUpperCase().replace(/\s/g, ''));

  // Length guard
  const maxLen = Math.max(...upper.map((s) => s.length));
  if (maxLen > MSA_MAX_SEQ_LEN) {
    return {
      type: 'too_large',
      message: `Sequences must be ≤ ${MSA_MAX_SEQ_LEN} characters for MSA (longest: ${maxLen} bp/aa).`,
    };
  }

  const n = upper.length;

  // ── 1. Find center sequence (max average pairwise identity) ──────────────
  // For up to 10 sequences do all-pairs; beyond that use median length.
  const scores = new Array<number>(n).fill(0);

  if (n <= 10) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const diff = sequenceDiff(upper[i], upper[j]);
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

  const centerIdx = scores.indexOf(Math.max(...scores));
  const center = upper[centerIdx];

  // ── 2. Pairwise-align every sequence to center ────────────────────────────
  const pairAligns: Array<{ alignedCenter: string; alignedSeq: string }> = [];

  for (let i = 0; i < n; i++) {
    if (i === centerIdx) {
      // Center aligned with itself: no gaps
      pairAligns.push({ alignedCenter: center, alignedSeq: center });
    } else {
      const diff = sequenceDiff(center, upper[i]);
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
    name: names[i],
    aligned: a,
    identity: computeIdentity(a, consensus),
  }));

  return {
    rows,
    consensus,
    conserved,
    gapOnly,
    alignmentLength: aligned[0]?.length ?? 0,
    centerIdx,
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

/**
 * Backward-compatible wrapper around computeMSA.
 * Accepts { name, sequence }[] and returns legacy MSAResult shape.
 * @deprecated Use computeMSA() instead.
 */
export function multipleAlign(
  sequences: Array<{ name: string; sequence: string }>,
): LegacyMSAResult {
  if (sequences.length === 0) {
    return {
      sequences: [],
      consensusSequence: '',
      conservationScores: [],
      identity: 0,
      gaps: 0,
      alignmentLength: 0,
      conservedColumns: 0,
    };
  }

  const seqs = sequences.map((s) => s.sequence);
  const names = sequences.map((s) => s.name);
  const result = computeMSA(seqs, names);

  if (isMSAError(result)) {
    // Return empty result on error
    return {
      sequences: [],
      consensusSequence: '',
      conservationScores: [],
      identity: 0,
      gaps: 0,
      alignmentLength: 0,
      conservedColumns: 0,
    };
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
  if (result.sequences.length === 0) return '';

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
