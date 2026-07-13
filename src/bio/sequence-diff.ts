export type DiffOp = 'match' | 'mismatch' | 'insertion' | 'deletion';

export interface DiffSegment {
  op: DiffOp;
  seq1Start: number;
  seq2Start: number;
  seq1Text: string;
  seq2Text: string;
  length: number;
}

export interface DiffResult {
  segments: DiffSegment[];
  identity: number;
  mismatches: number;
  insertions: number;
  deletions: number;
  aligned1: string;
  aligned2: string;
}

/** Memory guard: max cells for NW matrix */
const MAX_NW_CELLS = 25_000_000;

/**
 * Compare two sequences and produce a diff result.
 * Uses Needleman-Wunsch for short sequences, simple comparison for long ones.
 */
export function sequenceDiff(seq1: string, seq2: string): DiffResult {
  const s1 = seq1.toUpperCase();
  const s2 = seq2.toUpperCase();

  if (s1.length * s2.length > MAX_NW_CELLS) {
    return simpleDiff(s1, s2);
  }

  return needlemanWunsch(s1, s2);
}

/**
 * Needleman-Wunsch global alignment.
 */
function needlemanWunsch(seq1: string, seq2: string): DiffResult {
  const m = seq1.length;
  const n = seq2.length;
  const cols = n + 1;

  // Scoring
  const matchScore = 2;
  const mismatchScore = -1;
  const gapScore = -2;

  // Initialize score matrix
  const score = new Int32Array((m + 1) * cols);
  const index = (row: number, col: number) => row * cols + col;

  for (let i = 0; i <= m; i++) {
    score[index(i, 0)] = i * gapScore;
  }
  for (let j = 0; j <= n; j++) {
    score[index(0, j)] = j * gapScore;
  }

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const current = index(i, j);
      const diag = score[index(i - 1, j - 1)] + (seq1[i - 1] === seq2[j - 1] ? matchScore : mismatchScore);
      const up = score[index(i - 1, j)] + gapScore;
      const left = score[index(i, j - 1)] + gapScore;
      score[current] = Math.max(diag, up, left);
    }
  }

  // Traceback
  let aligned1 = '';
  let aligned2 = '';
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const s = seq1[i - 1] === seq2[j - 1] ? matchScore : mismatchScore;
      if (score[index(i, j)] === score[index(i - 1, j - 1)] + s) {
        aligned1 = seq1[i - 1] + aligned1;
        aligned2 = seq2[j - 1] + aligned2;
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && score[index(i, j)] === score[index(i - 1, j)] + gapScore) {
      aligned1 = seq1[i - 1] + aligned1;
      aligned2 = '-' + aligned2;
      i--;
    } else {
      aligned1 = '-' + aligned1;
      aligned2 = seq2[j - 1] + aligned2;
      j--;
    }
  }

  return buildResult(aligned1, aligned2);
}

/**
 * Simple character-by-character comparison for long sequences.
 * Handles length differences as trailing insertions/deletions.
 */
function simpleDiff(seq1: string, seq2: string): DiffResult {
  const minLen = Math.min(seq1.length, seq2.length);
  let aligned1 = seq1.slice(0, minLen);
  let aligned2 = seq2.slice(0, minLen);

  // Handle length difference
  if (seq1.length > seq2.length) {
    aligned1 += seq1.slice(minLen);
    aligned2 += '-'.repeat(seq1.length - minLen);
  } else if (seq2.length > seq1.length) {
    aligned1 += '-'.repeat(seq2.length - seq1.length);
    aligned2 += seq2.slice(minLen);
  }

  return buildResult(aligned1, aligned2);
}

/**
 * Build DiffResult from aligned sequences.
 */
function buildResult(aligned1: string, aligned2: string): DiffResult {
  const segments: DiffSegment[] = [];
  let matches = 0;
  let mismatches = 0;
  let insertions = 0;
  let deletions = 0;

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

  for (let i = 0; i < aligned1.length; i++) {
    const c1 = aligned1[i];
    const c2 = aligned2[i];

    let op: DiffOp;
    if (c1 === '-') {
      op = 'insertion';
      insertions++;
    } else if (c2 === '-') {
      op = 'deletion';
      deletions++;
    } else if (c1 === c2) {
      op = 'match';
      matches++;
    } else {
      op = 'mismatch';
      mismatches++;
    }

    if (op !== currentOp) {
      flush();
      currentOp = op;
      segStart1 = pos1;
      segStart2 = pos2;
      segText1 = '';
      segText2 = '';
    }

    segText1 += c1;
    segText2 += c2;

    if (c1 !== '-') pos1++;
    if (c2 !== '-') pos2++;
  }
  flush();

  const alignmentLength = aligned1.length;
  const identity = alignmentLength > 0 ? (matches / alignmentLength) * 100 : 0;

  return {
    segments,
    identity: Math.round(identity * 10) / 10,
    mismatches,
    insertions,
    deletions,
    aligned1,
    aligned2,
  };
}
