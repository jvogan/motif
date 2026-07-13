import type { ORF, CodonTable, Topology } from './types';
import { STANDARD_CODE } from './codon-tables';
import { reverseComplement } from './reverse-complement';

/**
 * Options for [`findORFs`]. Phase 34 P-B B3: topology added so circular
 * plasmids can find ORFs that wrap around the origin.
 */
export interface FindORFsOptions {
  /** Minimum ORF length in amino acids (default 30 = 90bp). */
  minAminoAcids?: number;
  /** Codon table (defaults to standard). */
  table?: CodonTable;
  /**
   * Sequence topology. When `'circular'`, scans a virtual buffer of length
   * `2 * seq.length` and keeps ORFs whose start position is in
   * `[0, seq.length)`. ORFs that wrap report `end > seq.length`.
   * Defaults to `'linear'`.
   */
  topology?: Topology;
}

/**
 * Regex matching characters that appear exclusively in protein sequences but
 * never in valid DNA/RNA. If the input contains any of these, treat it as a
 * protein and return early with an empty array to avoid garbage ORF results.
 */
const PROTEIN_ONLY_CHARS = /[DEFHIKLMPQRSVWYZ]/i;

/**
 * Find all ORFs in a DNA sequence across all 3 reading frames on both strands.
 *
 * Phase 34 P-B B3: when `options.topology === 'circular'`, the scanner builds
 * a virtual buffer `seq + seq` (with a max scan range of `2 * seq.length`) so
 * an ORF spanning the origin can be detected. Wrap-spanning ORFs are reported
 * with the canonical `start` in `[0, seq.length)` and an `end` that may exceed
 * `seq.length` (callers can render the wrap accordingly).
 *
 * @param seq - DNA sequence
 * @param minAminoAcids - Minimum ORF length in amino acids (default 30 = 90bp).
 *                       Backward-compatible positional argument.
 * @param table - Codon table (defaults to standard). Backward-compatible.
 * @param options - Optional topology / overrides. New in Phase 34 P-B B3.
 * @returns Array of ORFs sorted by length descending
 */
export function findORFs(
  seq: string,
  minAminoAcids = 30,
  table: CodonTable = STANDARD_CODE,
  options?: FindORFsOptions,
): ORF[] {
  // Guard: reject protein sequences before doing any nucleotide-specific work.
  if (PROTEIN_ONLY_CHARS.test(seq)) {
    return [];
  }

  // Allow overriding the positional args via the options object so callers
  // that want only the topology hint don't have to repeat the defaults.
  const effectiveMinAa = options?.minAminoAcids ?? minAminoAcids;
  const effectiveTable = options?.table ?? table;
  const topology: Topology = options?.topology ?? 'linear';

  const orfs: ORF[] = [];
  const upper = seq.toUpperCase().replace(/U/g, 'T');
  const seqLen = upper.length;

  if (seqLen < 3) {
    return orfs;
  }

  // For circular topology we scan a doubled buffer so an ORF spanning the
  // origin can be detected. We only keep ORFs whose start lies in
  // [0, seqLen) — anything starting in the wrap region is a shadow of an
  // ORF earlier in the linear sequence.
  const forwardScanBuffer = topology === 'circular' ? upper + upper : upper;
  const reverseScanBuffer =
    topology === 'circular'
      ? reverseComplement(upper) + reverseComplement(upper)
      : reverseComplement(upper);

  // Search forward strand
  for (let frame = 0; frame < 3; frame++) {
    const found = findORFsInFrame(
      forwardScanBuffer,
      frame,
      1 as const,
      effectiveTable,
      effectiveMinAa,
      topology === 'circular' ? seqLen : seqLen,
    );
    if (topology === 'circular') {
      for (const orf of found) {
        // Keep only ORFs that start within the original sequence range.
        // Skip wrap-shadow ORFs whose start is in [seqLen, 2*seqLen).
        if (orf.start < seqLen) {
          orfs.push(orf);
        }
      }
    } else {
      orfs.push(...found);
    }
  }

  // Search reverse strand
  for (let frame = 0; frame < 3; frame++) {
    const found = findORFsInFrame(
      reverseScanBuffer,
      frame,
      -1 as const,
      effectiveTable,
      effectiveMinAa,
      topology === 'circular' ? seqLen : seqLen,
    );
    // Convert positions back to forward-strand coordinates.
    for (const orf of found) {
      if (topology === 'circular') {
        // Reverse-scan buffer is 2*seqLen long; forward-strand origin sits at
        // (2*seqLen - 1) ... 0. The mapping is the same as linear but the
        // wrap-shadow filter is applied AFTER mapping so we measure the
        // forward-strand start position.
        const origStart = 2 * seqLen - orf.end;
        const origEnd = 2 * seqLen - orf.start;
        orf.start = origStart;
        orf.end = origEnd;
        if (orf.start >= 0 && orf.start < seqLen) {
          orfs.push(orf);
        }
        // else: wrap shadow — drop.
      } else {
        const origStart = seqLen - orf.end;
        const origEnd = seqLen - orf.start;
        orf.start = origStart;
        orf.end = origEnd;
        orfs.push(orf);
      }
    }
  }

  // Sort by length descending
  orfs.sort((a, b) => b.length - a.length);
  return orfs;
}

function findORFsInFrame(
  seq: string,
  frameOffset: number,
  strand: 1 | -1,
  table: CodonTable,
  minAminoAcids: number,
  /**
   * Phase 34 P-B B3: for circular topology, the seq buffer is `seq + seq`
   * but ORFs whose start is past `originalLen` are wrap shadows. This is
   * computed at the caller after this function returns, but we still pass
   * the length so this function can keep its existing logic verbatim.
   * (unused by this function — kept for future use / signature consistency)
   */
  _originalLen: number,
): ORF[] {
  const orfs: ORF[] = [];
  const stops = new Set(table.stops);
  const starts = new Set(table.starts);

  // Collect all start and stop codon positions in this frame
  const startPositions: number[] = [];
  const stopPositions: number[] = [];

  for (let i = frameOffset; i + 2 < seq.length; i += 3) {
    const codon = seq.slice(i, i + 3);
    if (starts.has(codon)) startPositions.push(i);
    if (stops.has(codon)) stopPositions.push(i);
  }

  // Starts and stops are already collected in ascending order for this frame,
  // so a monotonic stop index avoids rescanning earlier stop codons per ORF.
  let nextStopIndex = 0;
  for (const startPos of startPositions) {
    while (nextStopIndex < stopPositions.length && stopPositions[nextStopIndex] <= startPos) {
      nextStopIndex += 1;
    }

    const stopPos = stopPositions[nextStopIndex];
    if (stopPos !== undefined) {
      const bpLength = stopPos + 3 - startPos; // include stop codon
      const aaLength = Math.floor(bpLength / 3) - 1; // exclude stop
      if (aaLength >= minAminoAcids) {
        orfs.push({
          start: startPos,
          end: stopPos + 3,
          frame: ((frameOffset % 3) + 1) as 1 | 2 | 3,
          strand,
          length: bpLength,
          aminoAcids: aaLength,
          startCodon: seq.slice(startPos, startPos + 3),
          stopCodon: seq.slice(stopPos, stopPos + 3),
        });
      }
      continue;
    }

    // If no stop codon remains, treat end of sequence as implicit stop.
    {
      // Only count complete codons when the ORF runs to the terminal boundary.
      const implicitEnd = seq.length - ((seq.length - startPos) % 3);
      const bpLength = implicitEnd - startPos;
      const aaLength = bpLength / 3;
      if (aaLength >= minAminoAcids) {
        orfs.push({
          start: startPos,
          end: implicitEnd,
          frame: ((frameOffset % 3) + 1) as 1 | 2 | 3,
          strand,
          length: bpLength,
          aminoAcids: aaLength,
          startCodon: seq.slice(startPos, startPos + 3),
          stopCodon: '',
        });
      }
    }
  }

  return orfs;
}

/**
 * Find the longest ORF in a sequence.
 */
export function findLongestORF(
  seq: string,
  table: CodonTable = STANDARD_CODE,
): ORF | null {
  const orfs = findORFs(seq, 1, table);
  return orfs.length > 0 ? orfs[0] : null;
}
