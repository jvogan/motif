import {
  alignmentResiduesMatch,
  classifyAlignmentResidues,
  normalizeAlignmentSequence,
  type AlignmentMolecule,
} from './alignment-semantics';

export type DiffOp = 'match' | 'mismatch' | 'insertion' | 'deletion';

export interface DiffSegment {
  op: DiffOp;
  seq1Start: number;
  seq2Start: number;
  seq1Text: string;
  seq2Text: string;
  length: number;
}

export type DiffStatus = 'ok' | 'invalid' | 'work-limit';
export type DiffMethod =
  | 'needleman-wunsch'
  | 'linear-space-needleman-wunsch'
  | 'seed-and-extend'
  | 'validation';

export interface DiffResult {
  segments: DiffSegment[];
  identity: number;
  mismatches: number;
  insertions: number;
  deletions: number;
  aligned1: string;
  aligned2: string;
  /** Explicit execution metadata; never infer a fallback from sequence size. */
  method: DiffMethod;
  algorithm: string;
  fallback: boolean;
  warnings: string[];
  status: DiffStatus;
  /** Number of compatible, non-literal residue comparisons. */
  ambiguousMatches: number;
}

/** The historical full-matrix switch point. It is now an algorithm boundary, not a silent fallback. */
export const MAX_NW_CELLS = 25_000_000;
/** Upper bound for a linear-space global alignment before the bounded seed route is used. */
export const MAX_LINEAR_SPACE_CELLS = 100_000_000;
/** Default work ceiling for one pairwise comparison. */
export const MAX_COMPARISON_CELLS = 250_000_000;

export type SequenceDiffOptions = {
  molecule?: AlignmentMolecule;
  /** Optional caller-specific work ceiling. Results never exceed it silently. */
  maxCells?: number;
};

const MATCH_SCORE = 2;
const MISMATCH_SCORE = -1;
const GAP_SCORE = -2;
const SEED_KMER_LENGTH = 12;
const MAX_SEED_INDEX_ENTRIES = 250_000;
const MAX_SEED_OCCURRENCES_PER_KMER = 32;
const MAX_SEED_SEGMENT_CELLS = 4_000_000;

function invalidResult(
  status: Exclude<DiffStatus, 'ok'>,
  message: string,
): DiffResult {
  return {
    segments: [],
    identity: 0,
    mismatches: 0,
    insertions: 0,
    deletions: 0,
    aligned1: '',
    aligned2: '',
    method: 'validation',
    algorithm: 'validation',
    fallback: false,
    warnings: [message],
    status,
    ambiguousMatches: 0,
  };
}

function scoreFor(left: string, right: string, molecule: AlignmentMolecule): number {
  return alignmentResiduesMatch(left, right, molecule) ? MATCH_SCORE : MISMATCH_SCORE;
}

function sequenceScoreRow(
  seq1: string,
  seq2: string,
  molecule: AlignmentMolecule,
): Int32Array {
  const previous = new Int32Array(seq2.length + 1);
  const current = new Int32Array(seq2.length + 1);
  for (let column = 0; column <= seq2.length; column += 1) previous[column] = column * GAP_SCORE;
  for (let row = 1; row <= seq1.length; row += 1) {
    current[0] = row * GAP_SCORE;
    for (let column = 1; column <= seq2.length; column += 1) {
      const diagonal = previous[column - 1] + scoreFor(seq1[row - 1], seq2[column - 1], molecule);
      const up = previous[column] + GAP_SCORE;
      const left = current[column - 1] + GAP_SCORE;
      current[column] = Math.max(diagonal, up, left);
    }
    previous.set(current);
  }
  return previous;
}

function needlemanWunsch(
  seq1: string,
  seq2: string,
  molecule: AlignmentMolecule,
): { aligned1: string; aligned2: string } {
  const m = seq1.length;
  const n = seq2.length;
  const cols = n + 1;
  const score = new Int32Array((m + 1) * cols);
  const index = (row: number, column: number) => row * cols + column;

  for (let row = 0; row <= m; row += 1) score[index(row, 0)] = row * GAP_SCORE;
  for (let column = 0; column <= n; column += 1) score[index(0, column)] = column * GAP_SCORE;

  for (let row = 1; row <= m; row += 1) {
    for (let column = 1; column <= n; column += 1) {
      const current = index(row, column);
      const diagonal = score[index(row - 1, column - 1)]
        + scoreFor(seq1[row - 1], seq2[column - 1], molecule);
      const up = score[index(row - 1, column)] + GAP_SCORE;
      const left = score[index(row, column - 1)] + GAP_SCORE;
      score[current] = Math.max(diagonal, up, left);
    }
  }

  const aligned1: string[] = [];
  const aligned2: string[] = [];
  let row = m;
  let column = n;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0) {
      const diagonalScore = score[index(row - 1, column - 1)]
        + scoreFor(seq1[row - 1], seq2[column - 1], molecule);
      if (score[index(row, column)] === diagonalScore) {
        aligned1.push(seq1[row - 1]);
        aligned2.push(seq2[column - 1]);
        row -= 1;
        column -= 1;
        continue;
      }
    }
    if (row > 0 && score[index(row, column)] === score[index(row - 1, column)] + GAP_SCORE) {
      aligned1.push(seq1[row - 1]);
      aligned2.push('-');
      row -= 1;
    } else {
      aligned1.push('-');
      aligned2.push(seq2[column - 1]);
      column -= 1;
    }
  }
  return { aligned1: aligned1.reverse().join(''), aligned2: aligned2.reverse().join('') };
}

/** Linear-space global alignment (Hirschberg) with the same scoring as NW. */
function linearSpaceAlignment(
  seq1: string,
  seq2: string,
  molecule: AlignmentMolecule,
): { aligned1: string; aligned2: string } {
  if (seq1.length === 0) return { aligned1: '-'.repeat(seq2.length), aligned2: seq2 };
  if (seq2.length === 0) return { aligned1: seq1, aligned2: '-'.repeat(seq1.length) };
  if (seq1.length <= 1 || seq2.length <= 1) return needlemanWunsch(seq1, seq2, molecule);

  const splitRow = Math.floor(seq1.length / 2);
  const leftScores = sequenceScoreRow(seq1.slice(0, splitRow), seq2, molecule);
  const rightScores = sequenceScoreRow(
    seq1.slice(splitRow).split('').reverse().join(''),
    seq2.split('').reverse().join(''),
    molecule,
  );
  let splitColumn = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let column = 0; column <= seq2.length; column += 1) {
    const score = leftScores[column] + rightScores[seq2.length - column];
    // Prefer the leftmost split for deterministic gap placement.
    if (score > bestScore) {
      bestScore = score;
      splitColumn = column;
    }
  }
  const left = linearSpaceAlignment(seq1.slice(0, splitRow), seq2.slice(0, splitColumn), molecule);
  const right = linearSpaceAlignment(seq1.slice(splitRow), seq2.slice(splitColumn), molecule);
  return { aligned1: left.aligned1 + right.aligned1, aligned2: left.aligned2 + right.aligned2 };
}

type SeedAnchor = { seq1Start: number; seq2Start: number; length: number };

function buildSeedIndex(sequence: string, k: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  if (sequence.length < k) return index;
  for (let position = 0; position <= sequence.length - k; position += 1) {
    if (index.size >= MAX_SEED_INDEX_ENTRIES) break;
    const kmer = sequence.slice(position, position + k);
    const positions = index.get(kmer);
    if (positions) {
      if (positions.length < MAX_SEED_OCCURRENCES_PER_KMER) positions.push(position);
    } else {
      index.set(kmer, [position]);
    }
  }
  return index;
}

/** Find monotonic exact seeds, extending each seed to the largest literal run. */
function findSeedAnchors(seq1: string, seq2: string): SeedAnchor[] {
  const k = Math.min(SEED_KMER_LENGTH, seq1.length, seq2.length);
  if (k < 4) return [];
  const index = buildSeedIndex(seq2, k);
  const anchors: SeedAnchor[] = [];
  let lastSeq1 = -1;
  let lastSeq2 = -1;
  for (let position = 0; position <= seq1.length - k; position += 1) {
    const candidates = index.get(seq1.slice(position, position + k));
    if (!candidates) continue;
    const candidate = candidates.find((candidatePosition) => candidatePosition > lastSeq2);
    if (candidate === undefined || position <= lastSeq1) continue;
    let start1 = position;
    let start2 = candidate;
    while (start1 > 0 && start2 > 0 && seq1[start1 - 1] === seq2[start2 - 1]) {
      start1 -= 1;
      start2 -= 1;
    }
    let length = k;
    while (start1 + length < seq1.length
      && start2 + length < seq2.length
      && seq1[start1 + length] === seq2[start2 + length]) length += 1;
    if (start1 <= lastSeq1 || start2 <= lastSeq2) continue;
    anchors.push({ seq1Start: start1, seq2Start: start2, length });
    lastSeq1 = start1 + length - 1;
    lastSeq2 = start2 + length - 1;
    position = lastSeq1;
  }
  return anchors;
}

function boundedSegmentAlignment(
  seq1: string,
  seq2: string,
  molecule: AlignmentMolecule,
): { aligned1: string; aligned2: string; unresolved: boolean } {
  if (seq1.length === 0) return { aligned1: '-'.repeat(seq2.length), aligned2: seq2, unresolved: false };
  if (seq2.length === 0) return { aligned1: seq1, aligned2: '-'.repeat(seq1.length), unresolved: false };
  const cells = seq1.length * seq2.length;
  if (cells <= MAX_SEED_SEGMENT_CELLS) {
    return { ...needlemanWunsch(seq1, seq2, molecule), unresolved: false };
  }
  // This is deliberately documented as unresolved diagonal extension rather
  // than presented as a global alignment. Seeds still anchor the surrounding
  // sequence, and callers receive a warning with the explicit method.
  return {
    aligned1: seq1.length >= seq2.length ? seq1 : seq1 + '-'.repeat(seq2.length - seq1.length),
    aligned2: seq2.length >= seq1.length ? seq2 : seq2 + '-'.repeat(seq1.length - seq2.length),
    unresolved: true,
  };
}

function seedAndExtend(
  seq1: string,
  seq2: string,
  molecule: AlignmentMolecule,
): { aligned1: string; aligned2: string; warnings: string[] } {
  const anchors = findSeedAnchors(seq1, seq2);
  const aligned1: string[] = [];
  const aligned2: string[] = [];
  const warnings = [
    'The comparison exceeded the full and linear-space work bands; bounded seed-and-extend was used.',
  ];
  let previous1 = 0;
  let previous2 = 0;
  for (const anchor of anchors) {
    const segment = boundedSegmentAlignment(
      seq1.slice(previous1, anchor.seq1Start),
      seq2.slice(previous2, anchor.seq2Start),
      molecule,
    );
    aligned1.push(segment.aligned1);
    aligned2.push(segment.aligned2);
    if (segment.unresolved) warnings.push('One or more unanchored segments used a bounded diagonal extension; inspect the result before treating it as an exact global alignment.');
    aligned1.push(seq1.slice(anchor.seq1Start, anchor.seq1Start + anchor.length));
    aligned2.push(seq2.slice(anchor.seq2Start, anchor.seq2Start + anchor.length));
    previous1 = anchor.seq1Start + anchor.length;
    previous2 = anchor.seq2Start + anchor.length;
  }
  const tail = boundedSegmentAlignment(seq1.slice(previous1), seq2.slice(previous2), molecule);
  aligned1.push(tail.aligned1);
  aligned2.push(tail.aligned2);
  if (tail.unresolved) warnings.push('The terminal unanchored segment used a bounded diagonal extension; inspect the result before treating it as an exact global alignment.');
  if (anchors.length === 0) warnings.push('No monotonic exact seeds were found; the bounded result is not proof of a full global optimum.');
  return { aligned1: aligned1.join(''), aligned2: aligned2.join(''), warnings };
}

function buildResult(
  aligned1: string,
  aligned2: string,
  metadata: Pick<DiffResult, 'method' | 'algorithm' | 'fallback' | 'warnings'>,
  molecule: AlignmentMolecule,
): DiffResult {
  const segments: DiffSegment[] = [];
  let matches = 0;
  let mismatches = 0;
  let insertions = 0;
  let deletions = 0;
  let ambiguousMatches = 0;
  let currentOp: DiffOp | null = null;
  let segStart1 = 0;
  let segStart2 = 0;
  let segText1 = '';
  let segText2 = '';
  let pos1 = 0;
  let pos2 = 0;

  const flush = () => {
    if (currentOp !== null && segText1.length + segText2.length > 0) {
      segments.push({
        op: currentOp,
        seq1Start: segStart1,
        seq2Start: segStart2,
        seq1Text: segText1,
        seq2Text: segText2,
        length: Math.max(segText1.length, segText2.length),
      });
    }
  };

  for (let column = 0; column < Math.max(aligned1.length, aligned2.length); column += 1) {
    const left = aligned1[column] ?? '-';
    const right = aligned2[column] ?? '-';
    let op: DiffOp;
    if (left === '-') {
      op = 'insertion';
      insertions += 1;
    } else if (right === '-') {
      op = 'deletion';
      deletions += 1;
    } else {
      const difference = classifyAlignmentResidues(left, right, molecule);
      if (difference === 'substitution') {
        op = 'mismatch';
        mismatches += 1;
      } else {
        op = 'match';
        matches += 1;
        if (difference === 'ambiguous') ambiguousMatches += 1;
      }
    }
    if (op !== currentOp) {
      flush();
      currentOp = op;
      segStart1 = pos1;
      segStart2 = pos2;
      segText1 = '';
      segText2 = '';
    }
    segText1 += left;
    segText2 += right;
    if (left !== '-') pos1 += 1;
    if (right !== '-') pos2 += 1;
  }
  flush();
  const alignmentLength = Math.max(aligned1.length, aligned2.length);
  return {
    segments,
    identity: alignmentLength > 0 ? Math.round((matches / alignmentLength) * 1_000) / 10 : 0,
    mismatches,
    insertions,
    deletions,
    aligned1,
    aligned2,
    ...metadata,
    status: 'ok',
    ambiguousMatches,
  };
}

/**
 * Compare two sequences with an explicit algorithm contract. Above 25M cells
 * the implementation uses linear-space NW (or a warned seed route), never a
 * positional comparison that could masquerade as an indel-aware alignment.
 */
export function sequenceDiff(
  seq1: string,
  seq2: string,
  options: SequenceDiffOptions = {},
): DiffResult {
  let molecule: AlignmentMolecule = options.molecule ?? 'dna';
  let s1: string;
  let s2: string;
  try {
    if (options.molecule) {
      s1 = normalizeAlignmentSequence(seq1, options.molecule, { gapped: false, field: 'sequence 1' });
      s2 = normalizeAlignmentSequence(seq2, options.molecule, { gapped: false, field: 'sequence 2' });
    } else {
      // U is unambiguously RNA; otherwise DNA is the least surprising default
      // for nucleotide-only values such as ACGT.
      if (typeof seq1 === 'string' && typeof seq2 === 'string' && /U/iu.test(`${seq1}${seq2}`)) {
        molecule = 'rna';
        s1 = normalizeAlignmentSequence(seq1, molecule, { gapped: false, field: 'sequence 1' });
        s2 = normalizeAlignmentSequence(seq2, molecule, { gapped: false, field: 'sequence 2' });
      } else {
        s1 = normalizeAlignmentSequence(seq1, 'dna', { gapped: false, field: 'sequence 1' });
        s2 = normalizeAlignmentSequence(seq2, 'dna', { gapped: false, field: 'sequence 2' });
      }
    }
  } catch (error) {
    if (options.molecule) return invalidResult('invalid', error instanceof Error ? error.message : 'Invalid sequence input.');
    try {
      molecule = 'protein';
      s1 = normalizeAlignmentSequence(seq1, molecule, { gapped: false, field: 'sequence 1' });
      s2 = normalizeAlignmentSequence(seq2, molecule, { gapped: false, field: 'sequence 2' });
    } catch (proteinError) {
      return invalidResult('invalid', proteinError instanceof Error ? proteinError.message : 'Invalid sequence input.');
    }
  }
  const cells = s1.length * s2.length;
  const maxCells = Number.isFinite(options.maxCells) && (options.maxCells ?? 0) >= 0
    ? options.maxCells!
    : MAX_COMPARISON_CELLS;
  if (cells > maxCells) {
    return invalidResult('work-limit', `Comparison requires ${cells.toLocaleString()} cells, above the ${maxCells.toLocaleString()}-cell work limit.`);
  }
  if (cells <= MAX_NW_CELLS) {
    const aligned = needlemanWunsch(s1, s2, molecule);
    return buildResult(aligned.aligned1, aligned.aligned2, {
      method: 'needleman-wunsch',
      algorithm: 'Needleman–Wunsch global alignment',
      fallback: false,
      warnings: [],
    }, molecule);
  }
  if (cells <= MAX_LINEAR_SPACE_CELLS) {
    const aligned = linearSpaceAlignment(s1, s2, molecule);
    return buildResult(aligned.aligned1, aligned.aligned2, {
      method: 'linear-space-needleman-wunsch',
      algorithm: 'Hirschberg linear-space Needleman–Wunsch global alignment',
      fallback: true,
      warnings: ['The full score matrix was not retained; linear-space Needleman–Wunsch was used above the 25M-cell matrix boundary.'],
    }, molecule);
  }
  const aligned = seedAndExtend(s1, s2, molecule);
  return buildResult(aligned.aligned1, aligned.aligned2, {
    method: 'seed-and-extend',
    algorithm: 'Bounded monotonic exact-seed-and-extend comparison',
    fallback: true,
    warnings: aligned.warnings,
  }, molecule);
}
